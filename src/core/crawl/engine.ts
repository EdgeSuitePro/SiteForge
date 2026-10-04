import { createHash } from 'node:crypto';

import { canonicalizeUrl, isSameSite, normalizeDomain } from '../url/normalize';
import type { FetchOutcome, SafeFetcher } from './fetcher';
import { evaluateLink, scorePriority, pathPattern, type FrontierCandidate, type FrontierContext } from './frontier';
import type { CrawlLimits } from './limits';
import { PAGE_PARSER_VERSION, parsePage, type PageSummary } from './page-links';
import { fetchRobotsPolicy, robotsPolicyFromText, type RobotsPolicy } from './robots';
import { SITEMAP_MAX_BYTES, parseSitemap } from './sitemap';

/**
 * The crawl engine advances a crawl run in bounded "ticks". All state lives in the store, so a
 * tick can be interrupted at any point (timeout, deploy, crash) and the next tick resumes.
 * Exactly one worker runs a given crawl at a time — guaranteed by the job queue's dedupe key.
 */

export const ROBOTS_RAW_STORE_LIMIT = 50_000;
export const HTML_TYPES = ['text/html', 'application/xhtml+xml'] as const;
const XML_TYPES = ['application/xml', 'text/xml', 'application/rss+xml', 'text/plain'] as const;

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
export type StopReason =
  | 'exhausted'
  | 'page_limit'
  | 'time_limit'
  | 'canceled'
  | 'robots_disallowed'
  | 'start_failed'
  | 'error';

export interface RobotsSnapshotData {
  status: 'parsed' | 'not_found' | 'unavailable';
  origin: string;
  detail: string;
  delayMs: number;
  sitemaps: string[];
  raw: string | null;
}

export interface EngineRun {
  id: string;
  status: RunStatus;
  startUrl: string;
  rootDomain: string;
  canonicalOrigin: string | null;
  limits: CrawlLimits;
  robots: RobotsSnapshotData | null;
  notes: { discarded?: Record<string, number>; redirectedFrom?: string; likelyJsRendered?: boolean; sitemapUrlsFound?: number };
  cancelRequested: boolean;
  startedAt: Date | null;
  lastFetchAt: Date | null;
}

export interface EnginePage {
  id: string;
  url: string;
  depth: number;
}

export interface PageResult {
  state: 'fetched' | 'skipped' | 'failed';
  skipReason?: string;
  httpStatus?: number;
  finalUrl?: string;
  contentType?: string;
  bytes?: number;
  truncated?: boolean;
  contentHash?: string;
  fetchMs?: number;
  redirects?: string[];
  summary?: Omit<PageSummary, 'links'> & { linkCount: number };
  parserVersion?: string;
  error?: string;
  body?: Buffer;
}

export type NewPage = FrontierCandidate & { source: 'start' | 'link' | 'sitemap' };

export interface RunPatch {
  status?: RunStatus;
  stopReason?: StopReason;
  canonicalOrigin?: string;
  rootDomain?: string;
  robots?: RobotsSnapshotData;
  notes?: EngineRun['notes'];
  error?: string | null;
  startedAt?: Date;
  finishedAt?: Date;
  lastFetchAt?: Date;
  heartbeatAt?: Date;
}

export interface CrawlStore {
  loadRun(runId: string): Promise<EngineRun | null>;
  updateRun(runId: string, patch: RunPatch): Promise<void>;
  /** Pages left in `fetching` by an interrupted worker go back to the queue (or fail after retries). */
  recoverInterrupted(runId: string): Promise<void>;
  /** Insert new pages, skipping known URLs; enforces per-pattern and queue-size limits. */
  enqueue(runId: string, pages: NewPage[], limits: CrawlLimits): Promise<{ inserted: number; limited: number }>;
  /** Insert an already-fetched page (the start page). Returns its id. */
  insertFetched(runId: string, page: NewPage, result: PageResult): Promise<string>;
  nextQueued(runId: string): Promise<EnginePage | null>;
  markFetching(pageId: string): Promise<void>;
  completePage(pageId: string, result: PageResult): Promise<void>;
  isFetched(runId: string, url: string): Promise<boolean>;
  countFetched(runId: string): Promise<number>;
  /** Mark every still-queued page as skipped with the given reason. */
  skipRemaining(runId: string, reason: string): Promise<void>;
}

export interface EngineDeps {
  store: CrawlStore;
  fetcher: SafeFetcher;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export type TickResult = { status: 'continue'; delayMs: number } | { status: 'done'; runStatus: RunStatus; stopReason?: StopReason };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function describeOutcome(outcome: FetchOutcome): string {
  switch (outcome.kind) {
    case 'http_error':
      return `HTTP ${outcome.status}`;
    case 'blocked':
      return outcome.message;
    case 'network_error':
      return `Network error (${outcome.message})`;
    case 'unsupported_type':
      return `Not an HTML page (${outcome.contentType || 'unknown type'})`;
    case 'redirect_refused':
      return `Redirects off-site to ${outcome.location}`;
    case 'redirect_limit':
      return 'Too many redirects';
    case 'too_large':
      return 'Response too large';
    case 'timeout':
      return 'Timed out';
    case 'ok':
      return 'OK';
  }
}

function robotsFromSnapshot(snapshot: RobotsSnapshotData): RobotsPolicy {
  if (snapshot.status === 'unavailable') {
    return { ...robotsPolicyFromText(snapshot.origin, ''), status: 'unavailable', isAllowed: () => false };
  }
  return { ...robotsPolicyFromText(snapshot.origin, snapshot.raw ?? '', snapshot.status), detail: snapshot.detail };
}

function snapshotRobots(policy: RobotsPolicy): RobotsSnapshotData {
  return {
    status: policy.status,
    origin: policy.origin,
    detail: policy.detail,
    delayMs: policy.delayMs,
    sitemaps: policy.sitemaps,
    raw: policy.raw ? policy.raw.slice(0, ROBOTS_RAW_STORE_LIMIT) : null,
  };
}

/** Convert a fetch outcome for an HTML page into a stored result + discovered links. */
function toPageResult(outcome: FetchOutcome, fetchMs: number): { result: PageResult; summary?: PageSummary } {
  const common = { finalUrl: outcome.finalUrl, redirects: outcome.redirects, fetchMs };
  if (outcome.kind === 'ok') {
    const html = outcome.body.toString('utf8');
    const summary = parsePage(html, new URL(outcome.finalUrl));
    const { links, ...rest } = summary;
    return {
      summary,
      result: {
        ...common,
        state: 'fetched',
        httpStatus: outcome.status,
        contentType: outcome.contentType,
        bytes: outcome.bytes,
        truncated: outcome.truncated,
        contentHash: sha256(outcome.body),
        summary: { ...rest, linkCount: links.length },
        parserVersion: PAGE_PARSER_VERSION,
        body: outcome.body,
      },
    };
  }
  if (outcome.kind === 'unsupported_type') {
    return { result: { ...common, state: 'skipped', skipReason: 'not_html', httpStatus: outcome.status, contentType: outcome.contentType } };
  }
  if (outcome.kind === 'redirect_refused') {
    return { result: { ...common, state: 'skipped', skipReason: 'redirect_offsite', error: describeOutcome(outcome) } };
  }
  return {
    result: {
      ...common,
      state: 'failed',
      ...(outcome.kind === 'http_error' ? { httpStatus: outcome.status } : {}),
      error: describeOutcome(outcome),
    },
  };
}

export async function runCrawlTick(deps: EngineDeps, runId: string, budgetMs: number): Promise<TickResult> {
  const { store, fetcher } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? (() => {});
  const tickStarted = now();
  const remaining = () => budgetMs - (now() - tickStarted);

  const run = await store.loadRun(runId);
  if (!run) throw new Error(`Crawl run ${runId} not found`);
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'canceled') {
    return { status: 'done', runStatus: run.status };
  }

  const discarded: Record<string, number> = { ...(run.notes.discarded ?? {}) };
  const notes = run.notes;

  const finish = async (status: RunStatus, stopReason: StopReason, error?: string): Promise<TickResult> => {
    if (stopReason !== 'exhausted') await store.skipRemaining(runId, stopReason === 'page_limit' ? 'page_limit' : 'not_reached');
    await store.updateRun(runId, { status, stopReason, finishedAt: new Date(now()), error: error ?? null, notes: { ...notes, discarded } });
    log('crawl.finished', { runId, status, stopReason });
    return { status: 'done', runStatus: status, stopReason };
  };

  if (run.cancelRequested) return finish('canceled', 'canceled');

  const limits = run.limits;
  const startedAt = run.startedAt ?? new Date(now());
  if (run.status === 'queued') {
    await store.updateRun(runId, { status: 'running', startedAt });
    log('crawl.started', { runId, startUrl: run.startUrl });
  }
  await store.recoverInterrupted(runId);
  const deadline = startedAt.getTime() + limits.maxDurationMs;

  // -------------------------------------------------------------------------------------------
  // First tick: robots.txt, homepage (locks the canonical origin), sitemap discovery.
  // -------------------------------------------------------------------------------------------
  let robots: RobotsPolicy;
  let canonicalOrigin: URL;
  let rootDomain = run.rootDomain;
  let homepage: { summary: PageSummary | undefined; url: string } | null = null;

  if (!run.canonicalOrigin || !run.robots) {
    const startUrl = new URL(run.startUrl);
    const startRobots = await fetchRobotsPolicy(fetcher, startUrl.origin);
    if (startRobots.status === 'unavailable' && startRobots.failure === 'unreachable') {
      // DNS failure, refused connection, timeout or a blocked address: the site itself is unreachable.
      return finish('failed', 'start_failed', 'The website could not be reached. Check the address and try again.');
    }
    if (!startRobots.isAllowed(startUrl)) {
      await store.updateRun(runId, { robots: snapshotRobots(startRobots) });
      return finish('failed', 'robots_disallowed', startRobots.status === 'unavailable' ? startRobots.detail : 'robots.txt does not allow crawling this site.');
    }

    const started = now();
    const outcome = await fetcher.fetch(startUrl, {
      maxBytes: limits.maxHtmlBytes,
      onOversize: 'truncate',
      timeoutMs: limits.requestTimeoutMs,
      maxRedirects: limits.maxRedirects,
      acceptTypes: HTML_TYPES,
    });
    await store.updateRun(runId, { lastFetchAt: new Date(now()) });
    if (outcome.kind !== 'ok') {
      return finish('failed', 'start_failed', `The website could not be loaded: ${describeOutcome(outcome)}.`);
    }

    const finalUrl = canonicalizeUrl(outcome.finalUrl);
    canonicalOrigin = new URL(finalUrl.origin);
    if (normalizeDomain(finalUrl.hostname) !== rootDomain) {
      notes.redirectedFrom = run.startUrl;
      rootDomain = normalizeDomain(finalUrl.hostname);
    }
    robots = startRobots;
    if (finalUrl.origin !== startUrl.origin) {
      robots = await fetchRobotsPolicy(fetcher, finalUrl.origin);
      if (!robots.isAllowed(finalUrl)) {
        await store.updateRun(runId, { robots: snapshotRobots(robots) });
        return finish('failed', 'robots_disallowed', 'robots.txt does not allow crawling this site.');
      }
    }

    const { result, summary } = toPageResult(outcome, now() - started);
    notes.likelyJsRendered = summary?.likelyJsRendered ?? false;
    await store.insertFetched(
      runId,
      {
        url: finalUrl.href,
        patternKey: pathPattern(finalUrl),
        depth: 0,
        priority: 1000,
        discoveredFrom: null,
        linkText: null,
        source: 'start',
      },
      result,
    );
    await store.updateRun(runId, {
      canonicalOrigin: canonicalOrigin.origin,
      rootDomain,
      robots: snapshotRobots(robots),
      notes,
      heartbeatAt: new Date(now()),
    });

    homepage = { summary, url: finalUrl.href };
    log('crawl.homepage', { runId, canonicalOrigin: canonicalOrigin.origin, robots: robots.status });
  } else {
    robots = robotsFromSnapshot(run.robots);
    canonicalOrigin = new URL(run.canonicalOrigin);
  }

  const context: FrontierContext = {
    rootDomain,
    canonicalOrigin,
    includeSubdomains: limits.includeSubdomains,
    maxDepth: limits.maxDepth,
  };

  async function enqueueLinks(summary: PageSummary, fromUrl: string, depth: number) {
    const pages: NewPage[] = [];
    for (const link of summary.links) {
      const evaluated = evaluateLink(link.url, context, { depth, url: fromUrl, text: link.text, inNav: link.inNav });
      if ('candidate' in evaluated) pages.push({ ...evaluated.candidate, source: 'link' });
      else discarded[evaluated.skip] = (discarded[evaluated.skip] ?? 0) + 1;
    }
    if (pages.length) {
      const { limited } = await store.enqueue(runId, pages, limits);
      if (limited) discarded.pattern_or_queue_limit = (discarded.pattern_or_queue_limit ?? 0) + limited;
    }
  }

  if (homepage) {
    if (homepage.summary && !homepage.summary.metaRobots.nofollow) {
      await enqueueLinks(homepage.summary, homepage.url, 0);
    }
    await discoverSitemaps(context);
  }

  async function discoverSitemaps(ctx: FrontierContext) {
    if (limits.maxSitemapUrls === 0) return;
    const queue = robots.sitemaps.length ? [...robots.sitemaps] : [`${canonicalOrigin.origin}/sitemap.xml`];
    const found: NewPage[] = [];
    for (let index = 0; index < queue.length && index < 4 && remaining() > limits.requestTimeoutMs; index++) {
      const sitemapUrl = queue[index]!;
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(sitemapUrl);
      } catch {
        continue;
      }
      if (!isSameSite(parsedUrl, rootDomain, limits.includeSubdomains) || !robots.isAllowed(parsedUrl)) continue;
      const sitemap = await fetcher.fetch(parsedUrl, {
        maxBytes: SITEMAP_MAX_BYTES,
        onOversize: 'truncate',
        timeoutMs: limits.requestTimeoutMs,
        maxRedirects: limits.maxRedirects,
        acceptTypes: XML_TYPES,
        allowRedirect: (_from, to) => isSameSite(to, rootDomain, limits.includeSubdomains),
      });
      if (sitemap.kind !== 'ok') continue;
      const parsed = parseSitemap(sitemap.body.toString('utf8'), limits.maxSitemapUrls);
      if (parsed.kind === 'index') {
        queue.push(...parsed.locations.slice(0, 3));
        continue;
      }
      for (const location of parsed.locations) {
        const evaluated = evaluateLink(location, ctx, { depth: 0, url: parsedUrl.href });
        if ('candidate' in evaluated) {
          const candidateUrl = new URL(evaluated.candidate.url);
          found.push({
            ...evaluated.candidate,
            priority: Math.max(0, scorePriority(candidateUrl, '', false, 1) - 10),
            source: 'sitemap',
          });
        } else {
          discarded[evaluated.skip] = (discarded[evaluated.skip] ?? 0) + 1;
        }
      }
    }
    notes.sitemapUrlsFound = found.length;
    if (found.length) {
      const { limited } = await store.enqueue(runId, found, limits);
      if (limited) discarded.pattern_or_queue_limit = (discarded.pattern_or_queue_limit ?? 0) + limited;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Main loop: fetch queued pages in priority order, politely, within the tick budget.
  // -------------------------------------------------------------------------------------------
  let lastFetchAt = (await store.loadRun(runId))?.lastFetchAt?.getTime() ?? 0;
  const saveNotes = () => store.updateRun(runId, { notes: { ...notes, discarded }, heartbeatAt: new Date(now()) });

  for (;;) {
    if (now() >= deadline) {
      await saveNotes();
      return finish('completed', 'time_limit');
    }
    if ((await store.countFetched(runId)) >= limits.maxPages) {
      await saveNotes();
      return finish('completed', 'page_limit');
    }
    const latest = await store.loadRun(runId);
    if (latest?.cancelRequested) {
      await saveNotes();
      return finish('canceled', 'canceled');
    }

    const page = await store.nextQueued(runId);
    if (!page) {
      await saveNotes();
      return finish('completed', 'exhausted');
    }

    const pageUrl = new URL(page.url);
    if (!robots.isAllowed(pageUrl)) {
      await store.completePage(page.id, { state: 'skipped', skipReason: 'robots' });
      continue;
    }

    const waitMs = Math.max(0, lastFetchAt + robots.delayMs - now());
    // Leave room for the wait plus a full request before the tick budget runs out.
    if (remaining() < waitMs + limits.requestTimeoutMs + 1_000) {
      await saveNotes();
      return { status: 'continue', delayMs: waitMs };
    }
    if (waitMs > 0) await sleep(waitMs);

    await store.markFetching(page.id);
    const started = now();
    const outcome = await fetcher.fetch(pageUrl, {
      maxBytes: limits.maxHtmlBytes,
      onOversize: 'truncate',
      timeoutMs: limits.requestTimeoutMs,
      maxRedirects: limits.maxRedirects,
      acceptTypes: HTML_TYPES,
      allowRedirect: (_from, to) => isSameSite(to, rootDomain, limits.includeSubdomains),
    });
    lastFetchAt = now();
    await store.updateRun(runId, { lastFetchAt: new Date(lastFetchAt) });

    const { result, summary } = toPageResult(outcome, lastFetchAt - started);
    if (result.state === 'fetched' && result.finalUrl) {
      const finalCanonical = canonicalizeUrl(result.finalUrl).href;
      if (finalCanonical !== page.url && (await store.isFetched(runId, finalCanonical))) {
        await store.completePage(page.id, { ...result, state: 'skipped', skipReason: 'duplicate_redirect', body: undefined });
        continue;
      }
    }
    await store.completePage(page.id, result);
    log('crawl.page', { runId, url: page.url, state: result.state, status: result.httpStatus, ms: result.fetchMs });

    if (summary && !summary.metaRobots.nofollow) {
      await enqueueLinks(summary, page.url, page.depth);
    }
  }
}

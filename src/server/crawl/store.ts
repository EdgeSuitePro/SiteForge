import 'server-only';

import { gzipSync } from 'node:zlib';

import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import type { CrawlStore, EngineRun, NewPage, PageResult, RunPatch } from '../../core/crawl/engine';
import type { CrawlLimits } from '../../core/crawl/limits';
import type { Database } from '../db/client';
import { crawlPageBodies, crawlPages, crawlRuns } from '../db/schema';

/** Interrupted fetches are retried this many times before the page is marked failed. */
const MAX_PAGE_ATTEMPTS = 2;

function pageColumns(result: PageResult) {
  return {
    state: result.state,
    skipReason: result.skipReason ?? null,
    httpStatus: result.httpStatus ?? null,
    finalUrl: result.finalUrl ?? null,
    contentType: result.contentType?.slice(0, 200) ?? null,
    bytes: result.bytes ?? null,
    truncated: result.truncated ?? false,
    contentHash: result.contentHash ?? null,
    fetchMs: result.fetchMs ?? null,
    redirects: result.redirects ?? null,
    summary: result.summary ?? null,
    parserVersion: result.parserVersion ?? null,
    error: result.error?.slice(0, 1000) ?? null,
    fetchedAt: result.state === 'skipped' && !result.httpStatus ? null : new Date(),
  };
}

/** Drizzle-backed implementation of the crawl engine's store. */
export function createCrawlStore(db: Database, workspaceId: string): CrawlStore {
  async function saveBody(pageId: string, result: PageResult) {
    if (!result.body || result.state !== 'fetched') return;
    await db
      .insert(crawlPageBodies)
      .values({ pageId, body: gzipSync(result.body), sha256: result.contentHash ?? '' })
      .onConflictDoNothing();
  }

  return {
    async loadRun(runId) {
      const [row] = await db.select().from(crawlRuns).where(eq(crawlRuns.id, runId));
      if (!row) return null;
      const run: EngineRun = {
        id: row.id,
        status: row.status,
        startUrl: row.startUrl,
        rootDomain: row.rootDomain,
        canonicalOrigin: row.canonicalOrigin,
        limits: row.limits,
        robots: row.robots,
        notes: row.notes,
        cancelRequested: row.cancelRequested,
        startedAt: row.startedAt,
        lastFetchAt: row.lastFetchAt,
      };
      return run;
    },

    async updateRun(runId, patch: RunPatch) {
      await db.update(crawlRuns).set(patch).where(eq(crawlRuns.id, runId));
    },

    async recoverInterrupted(runId) {
      await db
        .update(crawlPages)
        .set({ state: 'failed', error: 'Fetch was interrupted repeatedly.' })
        .where(
          and(
            eq(crawlPages.crawlRunId, runId),
            eq(crawlPages.state, 'fetching'),
            sql`${crawlPages.attempts} >= ${MAX_PAGE_ATTEMPTS}`,
          ),
        );
      await db
        .update(crawlPages)
        .set({ state: 'queued' })
        .where(and(eq(crawlPages.crawlRunId, runId), eq(crawlPages.state, 'fetching')));
    },

    async enqueue(runId, pages: NewPage[], limits: CrawlLimits) {
      if (pages.length === 0) return { inserted: 0, limited: 0 };
      return db.transaction(async (tx) => {
        const [totals] = await tx.select({ total: count() }).from(crawlPages).where(eq(crawlPages.crawlRunId, runId));
        let total = totals?.total ?? 0;

        const patternKeys = [...new Set(pages.map((page) => page.patternKey))];
        const patternRows = await tx
          .select({ patternKey: crawlPages.patternKey, n: count() })
          .from(crawlPages)
          .where(and(eq(crawlPages.crawlRunId, runId), inArray(crawlPages.patternKey, patternKeys)))
          .groupBy(crawlPages.patternKey);
        const patternCounts = new Map(patternRows.map((row) => [row.patternKey, row.n]));

        const existing = new Set(
          (
            await tx
              .select({ url: crawlPages.url })
              .from(crawlPages)
              .where(and(eq(crawlPages.crawlRunId, runId), inArray(crawlPages.url, pages.map((page) => page.url))))
          ).map((row) => row.url),
        );

        let inserted = 0;
        let limited = 0;
        const ordered = [...pages].sort((a, b) => b.priority - a.priority);
        for (const page of ordered) {
          if (existing.has(page.url)) continue;
          const patternCount = patternCounts.get(page.patternKey) ?? 0;
          if (patternCount >= limits.maxPerPattern || total >= limits.maxQueued) {
            limited++;
            continue;
          }
          const result = await tx
            .insert(crawlPages)
            .values({
              crawlRunId: runId,
              workspaceId,
              url: page.url,
              patternKey: page.patternKey,
              depth: page.depth,
              priority: page.priority,
              source: page.source,
              discoveredFrom: page.discoveredFrom,
              linkText: page.linkText,
            })
            .onConflictDoNothing()
            .returning({ id: crawlPages.id });
          if (result.length) {
            existing.add(page.url);
            patternCounts.set(page.patternKey, patternCount + 1);
            total++;
            inserted++;
          }
        }
        return { inserted, limited };
      });
    },

    async insertFetched(runId, page, result) {
      const [row] = await db
        .insert(crawlPages)
        .values({
          crawlRunId: runId,
          workspaceId,
          url: page.url,
          patternKey: page.patternKey,
          depth: page.depth,
          priority: page.priority,
          source: page.source,
          discoveredFrom: page.discoveredFrom,
          linkText: page.linkText,
          attempts: 1,
          ...pageColumns(result),
        })
        .onConflictDoUpdate({ target: [crawlPages.crawlRunId, crawlPages.url], set: pageColumns(result) })
        .returning({ id: crawlPages.id });
      if (!row) throw new Error('Failed to record start page');
      await saveBody(row.id, result);
      return row.id;
    },

    async nextQueued(runId) {
      const [row] = await db
        .select({ id: crawlPages.id, url: crawlPages.url, depth: crawlPages.depth })
        .from(crawlPages)
        .where(and(eq(crawlPages.crawlRunId, runId), eq(crawlPages.state, 'queued')))
        .orderBy(desc(crawlPages.priority), asc(crawlPages.depth), asc(crawlPages.createdAt))
        .limit(1);
      return row ?? null;
    },

    async markFetching(pageId) {
      await db
        .update(crawlPages)
        .set({ state: 'fetching', attempts: sql`${crawlPages.attempts} + 1` })
        .where(eq(crawlPages.id, pageId));
    },

    async completePage(pageId, result) {
      await db.update(crawlPages).set(pageColumns(result)).where(eq(crawlPages.id, pageId));
      await saveBody(pageId, result);
    },

    async isFetched(runId, url) {
      const [row] = await db
        .select({ id: crawlPages.id })
        .from(crawlPages)
        .where(and(eq(crawlPages.crawlRunId, runId), eq(crawlPages.url, url), eq(crawlPages.state, 'fetched')))
        .limit(1);
      return Boolean(row);
    },

    async countFetched(runId) {
      const [row] = await db
        .select({ n: count() })
        .from(crawlPages)
        .where(and(eq(crawlPages.crawlRunId, runId), eq(crawlPages.state, 'fetched')));
      return row?.n ?? 0;
    },

    async skipRemaining(runId, reason) {
      await db
        .update(crawlPages)
        .set({ state: 'skipped', skipReason: reason })
        .where(and(eq(crawlPages.crawlRunId, runId), inArray(crawlPages.state, ['queued', 'fetching'])));
    },
  };
}

'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import type { CrawlProgress } from '../server/crawl/service';
import { DISCARD_LABEL, RUN_STATUS_LABEL, SKIP_REASON_LABEL, stopReasonText } from './labels';
import { StatusPill } from './status-pill';

/** JSON-serialized form of CrawlProgress (dates arrive as strings). */
type Jsonified<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;
export type CrawlProgressDto = Jsonified<CrawlProgress>;

type ActionResult = Promise<{ error?: string }>;

const POLL_MS = 2_000;
const isActive = (status: string | undefined) => status === 'queued' || status === 'running';

function runTone(status: string) {
  if (status === 'completed') return 'good' as const;
  if (status === 'failed') return 'bad' as const;
  if (isActive(status)) return 'active' as const;
  return 'neutral' as const;
}

function pageStatus(page: CrawlProgressDto['pages'][number]): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'active' } {
  switch (page.state) {
    case 'fetched':
      return { label: page.truncated ? 'Crawled (large page, truncated)' : 'Crawled', tone: 'good' };
    case 'fetching':
      return { label: 'Fetching…', tone: 'active' };
    case 'queued':
      return { label: 'Waiting', tone: 'neutral' };
    case 'failed':
      return { label: page.httpStatus ? `Error ${page.httpStatus}` : page.error ?? 'Failed', tone: 'bad' };
    default:
      return { label: SKIP_REASON_LABEL[page.skipReason ?? ''] ?? 'Skipped', tone: 'warn' };
  }
}

function displayPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

export function CrawlProgressPanel({
  prospectId,
  initial,
  analyze,
  cancel,
}: {
  prospectId: string;
  initial: CrawlProgressDto | null;
  analyze: () => ActionResult;
  cancel: () => ActionResult;
}) {
  const [progress, setProgress] = useState<CrawlProgressDto | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [expectRun, setExpectRun] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/prospects/${prospectId}/progress`, { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { progress: CrawlProgressDto | null };
      setProgress(body.progress);
      if (body.progress && isActive(body.progress.run.status)) setExpectRun(false);
    } catch {
      /* transient network error: keep polling */
    }
  }, [prospectId]);

  const polling = isActive(progress?.run.status) || expectRun;
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, refresh]);

  const run = (action: () => ActionResult, startsRun: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (result.error) setError(result.error);
      else {
        if (startsRun) setExpectRun(true);
        await refresh();
      }
    });

  const analyzeButton = (label: string) => (
    <button
      type="button"
      onClick={() => run(analyze, true)}
      disabled={pending}
      className="rounded-md bg-steel px-4 py-2 text-sm font-medium text-white hover:bg-steel-strong disabled:opacity-60"
    >
      {pending ? 'Starting…' : label}
    </button>
  );

  if (!progress) {
    return (
      <section className="mt-8 rounded-lg border border-line bg-panel p-6">
        <h2 className="font-semibold">Website analysis</h2>
        <p className="mt-1 text-sm text-ink-soft">
          SiteForge will crawl up to 25 public pages, following robots.txt and pausing between requests.
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-signal-bad">{error}</p>}
        <div className="mt-4">{analyzeButton('Analyze website')}</div>
      </section>
    );
  }

  const { run: crawl, counts, pages } = progress;
  const max = crawl.limits.maxPages;
  const active = isActive(crawl.status);
  // A finished crawl is 100% done even when the site had fewer pages than the limit.
  const percent = active ? Math.min(99, Math.round((counts.fetched / max) * 100)) : 100;
  const stopText = stopReasonText(crawl.stopReason, max);
  const discarded = Object.entries(crawl.notes.discarded ?? {}).filter(([, n]) => n > 0);

  return (
    <section className="mt-8 space-y-6">
      <div className="rounded-lg border border-line bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">Website crawl</h2>
            <StatusPill tone={runTone(crawl.status)}>
              {crawl.cancelRequested && active ? 'Canceling…' : RUN_STATUS_LABEL[crawl.status] ?? crawl.status}
            </StatusPill>
          </div>
          <div className="flex gap-2">
            {active ? (
              <button
                type="button"
                onClick={() => run(cancel, false)}
                disabled={pending || crawl.cancelRequested}
                className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft ring-1 ring-line hover:bg-canvas disabled:opacity-60"
              >
                Cancel crawl
              </button>
            ) : (
              analyzeButton('Analyze again')
            )}
          </div>
        </div>

        <div className="mt-5" aria-live="polite">
          <div className="flex justify-between text-sm">
            <span className="text-ink-soft">
              {active ? `${counts.fetched} of up to ${max} pages crawled` : `${counts.fetched} pages crawled (limit ${max})`}
            </span>
            <span className="text-muted">{percent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas ring-1 ring-line" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-steel transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Crawled', counts.fetched],
            ['Waiting', counts.queued + counts.fetching],
            ['Skipped', counts.skipped],
            ['Errors', counts.failed],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md bg-canvas px-3 py-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        {crawl.notes.likelyJsRendered && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-signal-warn">
            This site appears to build its pages with JavaScript. SiteForge reads the HTML the server sends, so some
            content may be missing from this crawl.
          </p>
        )}
        {stopText && !active && <p className="mt-4 text-sm text-ink-soft">{stopText}</p>}
        {crawl.error && <p className="mt-2 text-sm text-signal-bad">{crawl.error}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-signal-bad">{error}</p>}
      </div>

      {pages.length > 0 && (
        <div className="rounded-lg border border-line bg-panel">
          <h3 className="border-b border-line px-5 py-3 text-sm font-semibold">Pages</h3>
          <ul className="divide-y divide-line">
            {pages.map((page) => {
              const status = pageStatus(page);
              return (
                <li key={page.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{displayPath(page.url)}</p>
                    {page.title && <p className="truncate text-xs text-muted">{page.title}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {page.source === 'sitemap' && <span className="text-xs text-muted">from sitemap</span>}
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <details className="rounded-lg border border-line bg-panel px-5 py-3 text-sm">
        <summary className="cursor-pointer font-semibold">Crawl details</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted">Site crawled</dt>
          <dd className="break-all">{crawl.canonicalOrigin ?? crawl.startUrl}</dd>
          {crawl.notes.redirectedFrom && (
            <>
              <dt className="text-muted">Redirected from</dt>
              <dd className="break-all">{crawl.notes.redirectedFrom}</dd>
            </>
          )}
          <dt className="text-muted">robots.txt</dt>
          <dd>{crawl.robots?.detail ?? 'Not checked yet'}</dd>
          <dt className="text-muted">Pause between requests</dt>
          <dd>{crawl.robots ? `${crawl.robots.delayMs / 1000}s` : '—'}</dd>
          <dt className="text-muted">Sitemap pages found</dt>
          <dd>{crawl.notes.sitemapUrlsFound ?? 0}</dd>
          <dt className="text-muted">Started</dt>
          <dd>{crawl.startedAt ? new Date(crawl.startedAt).toLocaleString() : 'Not yet'}</dd>
          <dt className="text-muted">Finished</dt>
          <dd>{crawl.finishedAt ? new Date(crawl.finishedAt).toLocaleString() : '—'}</dd>
          <dt className="text-muted">Crawler</dt>
          <dd className="font-mono text-xs">
            {crawl.crawlerVersion} · run {crawl.id.slice(0, 8)}
          </dd>
        </dl>
        {discarded.length > 0 && (
          <>
            <p className="mt-4 font-medium">Links not followed</p>
            <ul className="mt-1 space-y-1 text-ink-soft">
              {discarded.map(([reason, n]) => (
                <li key={reason}>
                  {DISCARD_LABEL[reason] ?? reason}: <span className="tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  );
}

import { gunzipSync } from 'node:zlib';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSafeFetcher } from '@/core/crawl/fetcher';
import { cancelCrawl, createProspect, getLatestCrawlProgress, startCrawl } from '@/server/crawl/service';
import type { DatabaseHandle } from '@/server/db/client';
import { activityLog, crawlPageBodies, crawlPages, crawlRuns, jobs, prospects } from '@/server/db/schema';
import type { JobContext } from '@/server/jobs/handlers';
import { claimJobs, enqueueJob } from '@/server/jobs/queue';
import { runWorker } from '@/server/jobs/runner';

import { createTestDatabase } from '../support/db';
import { startFixtureServer, testFetchPolicy, text, type FixtureServer } from '../support/fixture-server';
import { createTestOperator, seedProspect } from '../support/operator';
import { sharpenerSite } from '../support/sharpener-site';

let handle: DatabaseHandle;
let server: FixtureServer;
let robotsBlocked: FixtureServer;
let virtualOffset = 0;

const clock = {
  now: () => Date.now() + virtualOffset,
  sleep: async (ms: number) => {
    virtualOffset += ms;
  },
};
const testContext = (db: DatabaseHandle['db'], budgetMs: number): JobContext => ({
  db,
  budgetMs,
  createFetcher: () => createSafeFetcher(testFetchPolicy),
  clock,
});

/** Drive the worker until the queue drains (bounded). */
async function drain(budgetMs = 120_000, iterations = 20) {
  for (let i = 0; i < iterations; i++) {
    const report = await runWorker(handle.db, {
      budgetMs,
      jobBudgetMs: budgetMs,
      waitForDueWithinMs: 0,
      contextFactory: testContext,
    });
    if (report.executed === 0 && report.failed === 0) {
      // Make continuation jobs due immediately (they were re-queued with a politeness delay).
      const pending = await handle.db.update(jobs).set({ runAfter: new Date(0) }).where(eq(jobs.status, 'queued')).returning();
      if (pending.length === 0) return;
    }
  }
}

beforeAll(async () => {
  handle = await createTestDatabase();
  const site = sharpenerSite(() => server.port);
  server = await startFixtureServer(site.routes, site.fallback);
  robotsBlocked = await startFixtureServer({ '/robots.txt': text(200, 'User-agent: *\nDisallow: /') });
});

afterAll(async () => {
  await server.close();
  await robotsBlocked.close();
  await handle.close();
});

beforeEach(() => {
  virtualOffset = 0;
});

describe('crawl pipeline (fixture sharpener site)', () => {
  it('crawls the site politely, safely and completely', async () => {
    const operator = await createTestOperator(handle.db);
    const { prospect } = await seedProspect(handle.db, operator, `http://edgeworks.test:${server.port}/`);
    expect(prospect.normalizedDomain).toBe('edgeworks.test');
    await handle.db.insert(activityLog).values({ workspaceId: operator.workspaceId, prospectId: prospect.id, kind: 'prospect.created' });
    const { run } = await startCrawl(handle.db, operator, prospect.id);
    await drain();

    const progress = await getLatestCrawlProgress(handle.db, operator.workspaceId, prospect.id);
    expect(progress?.run.id).toBe(run.id);
    expect(progress?.run).toMatchObject({ status: 'completed', stopReason: 'exhausted' });
    expect(progress?.run.canonicalOrigin).toBe(`http://www.edgeworks.test:${server.port}`);
    expect(progress?.run.robots?.status).toBe('parsed');

    const byPath = new Map(progress!.pages.map((page) => [new URL(page.url).pathname, page]));
    for (const path of ['/', '/services', '/pricing', '/about', '/contact', '/faq', '/nofollow', '/blog/page/2']) {
      expect(byPath.get(path)?.state, path).toBe('fetched');
    }
    expect(byPath.get('/')?.title).toBe('Edge Works Sharpening | Edge Works Sharpening');
    expect(byPath.get('/faq')?.source).toBe('sitemap');
    expect(byPath.get('/private/staff-notes')).toMatchObject({ state: 'skipped', skipReason: 'robots' });
    expect(byPath.get('/missing')).toMatchObject({ state: 'failed', httpStatus: 404 });
    expect(byPath.get('/offsite')).toMatchObject({ state: 'skipped', skipReason: 'redirect_offsite' });
    expect(byPath.get('/old-page')).toMatchObject({ state: 'skipped', skipReason: 'duplicate_redirect' });
    expect(byPath.has('/menu.pdf')).toBe(false);
    expect(byPath.has('/hidden-by-nofollow')).toBe(false);

    // Every URL is on the canonical www origin (apex links were rewritten).
    for (const page of progress!.pages) expect(new URL(page.url).hostname).toBe('www.edgeworks.test');

    // Calendar trap bounded by the per-pattern limit.
    const events = progress!.pages.filter((page) => page.url.includes('/events/'));
    expect(events.length).toBeLessThanOrEqual(3);

    expect(progress?.run.notes.discarded?.offsite).toBeGreaterThan(0);
    expect(progress?.run.notes.discarded?.extension).toBeGreaterThan(0);
    expect(progress?.run.notes.discarded?.pattern_or_queue_limit).toBeGreaterThan(0);

    // Raw HTML stored gzipped for later re-extraction.
    const [home] = await handle.db.select().from(crawlPages).where(and(eq(crawlPages.crawlRunId, run.id), eq(crawlPages.depth, 0)));
    const [body] = await handle.db.select().from(crawlPageBodies).where(eq(crawlPageBodies.pageId, home!.id));
    expect(gunzipSync(body!.body).toString()).toContain('Professional knife sharpening in Springfield');

    const [updated] = await handle.db.select().from(prospects).where(eq(prospects.id, prospect.id));
    expect(updated?.status).toBe('analyzed');
    const activity = await handle.db.select().from(activityLog).where(eq(activityLog.prospectId, prospect.id));
    expect(activity.map((entry) => entry.kind)).toEqual(expect.arrayContaining(['prospect.created', 'crawl.requested', 'crawl.completed']));

    // Robots disallowed path was never requested from the server.
    expect(server.hits.some((hit) => hit.includes('/private/staff-notes'))).toBe(false);
  });

  it('stops at the page limit', async () => {
    const operator = await createTestOperator(handle.db);
    const { prospect } = await seedProspect(handle.db, operator, `http://www.edgeworks.test:${server.port}`);
    await startCrawl(handle.db, operator, prospect.id, { maxPages: 3 });
    await drain();
    const progress = await getLatestCrawlProgress(handle.db, operator.workspaceId, prospect.id);
    expect(progress?.run).toMatchObject({ status: 'completed', stopReason: 'page_limit' });
    expect(progress?.counts.fetched).toBe(3);
    expect(progress?.counts.queued).toBe(0);
  });

  it('stops at the time limit', async () => {
    const operator = await createTestOperator(handle.db);
    const { prospect } = await seedProspect(handle.db, operator, `http://time.edgeworks.test:${server.port}`);
    // Use a fresh host so the apex→www rule does not apply; each fetch costs >= 1 virtual second.
    await startCrawl(handle.db, operator, prospect.id, { maxDurationMs: 10_000 });
    await drain();
    const progress = await getLatestCrawlProgress(handle.db, operator.workspaceId, prospect.id);
    expect(progress?.run.status).toBe('completed');
    expect(['time_limit', 'exhausted']).toContain(progress?.run.stopReason);
  });

  it('is restartable after a worker dies mid-fetch', async () => {
    const operator = await createTestOperator(handle.db);
    const { prospect } = await seedProspect(handle.db, operator, `http://www.edgeworks.test:${server.port}/`);
    const { run } = await startCrawl(handle.db, operator, prospect.id, { maxPages: 5 });

    // First tick: homepage + discovery only (tiny budget forces an early yield).
    await runWorker(handle.db, { budgetMs: 6_000, jobBudgetMs: 1_500, waitForDueWithinMs: 0, contextFactory: testContext });
    const [afterTick] = await handle.db.select().from(crawlRuns).where(eq(crawlRuns.id, run.id));
    expect(afterTick?.status).toBe('running');

    // Simulate a crash: a page stuck in `fetching`, and the job lease held by a dead worker.
    const [queued] = await handle.db.select().from(crawlPages).where(and(eq(crawlPages.crawlRunId, run.id), eq(crawlPages.state, 'queued'))).limit(1);
    await handle.db.update(crawlPages).set({ state: 'fetching', attempts: 1 }).where(eq(crawlPages.id, queued!.id));
    await handle.db
      .update(jobs)
      .set({ status: 'running', lockedBy: 'dead-worker', lockedUntil: new Date(Date.now() - 1_000) })
      .where(eq(jobs.dedupeKey, `crawl:${run.id}`));

    await drain();
    const progress = await getLatestCrawlProgress(handle.db, operator.workspaceId, prospect.id);
    expect(progress?.run.status).toBe('completed');
    const recovered = progress?.pages.find((page) => page.id === queued!.id);
    expect(['fetched', 'skipped', 'failed']).toContain(recovered?.state);
    expect(progress?.counts.fetching).toBe(0);
  });

  it('cancels a crawl that has not started, and one that is running', async () => {
    const operator = await createTestOperator(handle.db);
    const { prospect } = await seedProspect(handle.db, operator, `http://www.edgeworks.test:${server.port}/`);
    await startCrawl(handle.db, operator, prospect.id);
    const canceled = await cancelCrawl(handle.db, operator, prospect.id);
    expect(canceled).toMatchObject({ status: 'canceled', stopReason: 'canceled' });

    const { run } = await startCrawl(handle.db, operator, prospect.id);
    await runWorker(handle.db, { budgetMs: 6_000, jobBudgetMs: 1_500, waitForDueWithinMs: 0, contextFactory: testContext });
    await cancelCrawl(handle.db, operator, prospect.id);
    await drain();
    const [final] = await handle.db.select().from(crawlRuns).where(eq(crawlRuns.id, run.id));
    expect(final).toMatchObject({ status: 'canceled', stopReason: 'canceled' });
  });

  it('respects a robots.txt that disallows everything', async () => {
    const operator = await createTestOperator(handle.db);
    const { prospect } = await seedProspect(handle.db, operator, `http://blocked.test:${robotsBlocked.port}/`);
    await startCrawl(handle.db, operator, prospect.id);
    await drain();
    const progress = await getLatestCrawlProgress(handle.db, operator.workspaceId, prospect.id);
    expect(progress?.run).toMatchObject({ status: 'failed', stopReason: 'robots_disallowed' });
    expect(progress?.counts.fetched).toBe(0);
    expect(robotsBlocked.hits).toEqual(['GET /robots.txt']);
  });

  it('fails cleanly for unreachable and SSRF start URLs', async () => {
    const operator = await createTestOperator(handle.db);
    const unreachable = await createProspect(handle.db, operator, { websiteUrl: 'http://no-such-host.invalid-tld-xyz/' });
    const rebind = await seedProspect(handle.db, operator, `http://rebind.test:${server.port}/`);
    await startCrawl(handle.db, operator, unreachable.prospect.id);
    await startCrawl(handle.db, operator, rebind.prospect.id);
    await drain();
    for (const { prospect } of [unreachable, rebind]) {
      const progress = await getLatestCrawlProgress(handle.db, operator.workspaceId, prospect.id);
      expect(progress?.run.status).toBe('failed');
      expect(progress?.run.stopReason).toBe('start_failed');
      expect(progress?.run.error).toMatch(/could not be reached/);
      expect(progress?.counts.fetched).toBe(0);
    }
  });

  it('refuses operator input that is unsafe before anything is stored', async () => {
    const operator = await createTestOperator(handle.db);
    await expect(createProspect(handle.db, operator, { websiteUrl: 'http://169.254.169.254/' })).rejects.toThrow(/Private/);
    await expect(createProspect(handle.db, operator, { websiteUrl: 'file:///etc/passwd' })).rejects.toThrow(/http/);
  });

  it('dedupes prospects by domain and active crawls per prospect', async () => {
    const operator = await createTestOperator(handle.db);
    const first = await createProspect(handle.db, operator, { websiteUrl: `https://dupe.example/` });
    const second = await createProspect(handle.db, operator, { websiteUrl: `http://www.dupe.example/about` });
    expect(second).toMatchObject({ created: false, prospect: { id: first.prospect.id } });
    const a = await startCrawl(handle.db, operator, first.prospect.id);
    const b = await startCrawl(handle.db, operator, first.prospect.id);
    expect(b).toMatchObject({ started: false, run: { id: a.run.id } });
    await cancelCrawl(handle.db, operator, first.prospect.id);
  });
});

describe('job queue', () => {
  it('allows only one active job per dedupe key and hands expired leases to another worker', async () => {
    const first = await enqueueJob(handle.db, { kind: 'noop', payload: {}, dedupeKey: 'k1' });
    const second = await enqueueJob(handle.db, { kind: 'noop', payload: {}, dedupeKey: 'k1' });
    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const [claimedA] = await claimJobs(handle.db, 'worker-a', { kinds: ['noop'], leaseMs: 1 });
    expect(claimedA?.id).toBe(first!.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [claimedB] = await claimJobs(handle.db, 'worker-b', { kinds: ['noop'] });
    expect(claimedB).toMatchObject({ id: first!.id, lockedBy: 'worker-b', attempts: 2 });
    const none = await claimJobs(handle.db, 'worker-c', { kinds: ['noop'] });
    expect(none).toHaveLength(0);
  });
});

import 'server-only';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { runCrawlTick } from '../../core/crawl/engine';
import { createSafeFetcher, type SafeFetcher } from '../../core/crawl/fetcher';
import { recordActivity } from '../activity';
import { createCrawlStore } from '../crawl/store';
import type { Database } from '../db/client';
import { crawlRuns, prospects } from '../db/schema';
import { log } from '../log';
import type { JobRow } from './queue';

export type JobOutcome = { status: 'done' } | { status: 'continue'; delayMs: number };

export interface JobContext {
  db: Database;
  /** Milliseconds this execution may use. */
  budgetMs: number;
  createFetcher: () => SafeFetcher;
  /** Injectable clock (tests use a virtual clock so politeness delays don't slow them down). */
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> };
}

export type JobHandler = (job: JobRow, context: JobContext) => Promise<JobOutcome>;

export const CRAWL_JOB = 'crawl';
const crawlPayload = z.object({ crawlRunId: z.uuid() });

const crawlHandler: JobHandler = async (job, { db, budgetMs, createFetcher, clock }) => {
  const { crawlRunId } = crawlPayload.parse(job.payload);
  const [run] = await db.select().from(crawlRuns).where(eq(crawlRuns.id, crawlRunId));
  if (!run) return { status: 'done' };

  const fetcher = createFetcher();
  try {
    const result = await runCrawlTick(
      {
        store: createCrawlStore(db, run.workspaceId),
        fetcher,
        ...(clock ? { now: clock.now, sleep: clock.sleep } : {}),
        log: (event, fields) => log.info(event, fields),
      },
      crawlRunId,
      budgetMs,
    );
    if (result.status === 'continue') return result;

    const prospectStatus = result.runStatus === 'completed' ? 'analyzed' : result.runStatus === 'failed' ? 'failed' : 'new';
    await db.update(prospects).set({ status: prospectStatus }).where(eq(prospects.id, run.prospectId));
    await recordActivity(db, {
      workspaceId: run.workspaceId,
      prospectId: run.prospectId,
      kind: `crawl.${result.runStatus}`,
      detail: { crawlRunId, stopReason: result.stopReason ?? null },
    });
    return { status: 'done' };
  } catch (error) {
    // Unexpected engine errors: mark the run failed only when the job will not be retried.
    if (job.attempts >= job.maxAttempts) {
      await db
        .update(crawlRuns)
        .set({ status: 'failed', stopReason: 'error', error: 'The crawl stopped because of an internal error.', finishedAt: new Date() })
        .where(eq(crawlRuns.id, crawlRunId));
      await db.update(prospects).set({ status: 'failed' }).where(eq(prospects.id, run.prospectId));
    }
    throw error;
  } finally {
    await fetcher.close();
  }
};

export const jobHandlers: Record<string, JobHandler> = {
  [CRAWL_JOB]: crawlHandler,
};

export const defaultJobContextFactory = (db: Database, budgetMs: number): JobContext => ({
  db,
  budgetMs,
  createFetcher: () => createSafeFetcher(),
});

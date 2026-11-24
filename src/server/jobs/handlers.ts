import 'server-only';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { runCrawlTick } from '../../core/crawl/engine';
import type { AiProvider } from '../../core/ai/types';
import { createSafeFetcher, type SafeFetcher } from '../../core/crawl/fetcher';
import { recordActivity } from '../activity';
import { createCrawlStore } from '../crawl/store';
import { AUDIT_JOB, failAudit, runAuditJob } from '../audit/audit';
import { getAiProvider } from '../ai/provider';
import { isRetryableAiError } from '../ai/run';
import { AI_EXTRACT_JOB, failAiExtraction, failSemanticReview, runAiExtraction, runSemanticReview, SEMANTIC_AUDIT_JOB } from '../ai/stages';
import { EXTRACT_JOB, failExtraction, queueAuditForExtraction, queueExtraction, runExtraction } from '../facts/extraction';
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
  /** AI provider (Anthropic or mock). Injectable for tests. */
  ai: AiProvider;
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

    if (result.runStatus === 'completed') {
      // Next pipeline stage: extract business facts. The prospect stays `analyzing` until it finishes.
      await queueExtraction(db, { workspaceId: run.workspaceId, prospectId: run.prospectId, crawlRunId, requestedBy: run.requestedBy });
    } else {
      await db
        .update(prospects)
        .set({ status: result.runStatus === 'failed' ? 'failed' : 'new' })
        .where(eq(prospects.id, run.prospectId));
    }
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

const extractPayload = z.object({ extractionRunId: z.uuid() });

const extractHandler: JobHandler = async (job, { db, createFetcher }) => {
  const { extractionRunId } = extractPayload.parse(job.payload);
  try {
    await runExtraction(db, extractionRunId, createFetcher);
    return { status: 'done' };
  } catch (error) {
    if (job.attempts >= job.maxAttempts) await failExtraction(db, extractionRunId, 'Fact extraction stopped because of an internal error.');
    throw error;
  }
};

const auditPayload = z.object({ auditRunId: z.uuid() });

const auditHandler: JobHandler = async (job, { db }) => {
  const { auditRunId } = auditPayload.parse(job.payload);
  try {
    await runAuditJob(db, auditRunId);
    return { status: 'done' };
  } catch (error) {
    if (job.attempts >= job.maxAttempts) await failAudit(db, auditRunId, 'The audit stopped because of an internal error.');
    throw error;
  }
};

const aiExtractHandler: JobHandler = async (job, { db, ai }) => {
  const { extractionRunId } = extractPayload.parse(job.payload);
  try {
    await runAiExtraction(db, ai, extractionRunId);
  } catch (error) {
    // Retry transient provider problems; otherwise record the failure and carry on without AI facts.
    if (isRetryableAiError(error) && job.attempts < job.maxAttempts) throw error;
    await failAiExtraction(db, extractionRunId, error);
  }
  await queueAuditForExtraction(db, extractionRunId);
  return { status: 'done' };
};

const semanticHandler: JobHandler = async (job, { db, ai }) => {
  const { auditRunId } = auditPayload.parse(job.payload);
  try {
    await runSemanticReview(db, ai, auditRunId);
  } catch (error) {
    // The deterministic audit already stands on its own; record why the AI review is missing.
    if (isRetryableAiError(error) && job.attempts < job.maxAttempts) throw error;
    await failSemanticReview(db, auditRunId, error);
  }
  return { status: 'done' };
};

export const jobHandlers: Record<string, JobHandler> = {
  [CRAWL_JOB]: crawlHandler,
  [EXTRACT_JOB]: extractHandler,
  [AI_EXTRACT_JOB]: aiExtractHandler,
  [AUDIT_JOB]: auditHandler,
  [SEMANTIC_AUDIT_JOB]: semanticHandler,
};

export const defaultJobContextFactory = (db: Database, budgetMs: number): JobContext => ({
  db,
  budgetMs,
  createFetcher: () => createSafeFetcher(),
  ai: getAiProvider(),
});

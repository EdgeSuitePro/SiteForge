import 'server-only';

import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import { rowsOf } from '../db/rows';
import { jobs } from '../db/schema';
import { serverEnv } from '../env';
import { log } from '../log';
import { defaultJobContextFactory, jobHandlers, type JobContext } from './handlers';
import { claimJobs, completeJob, continueJob, DEFAULT_LEASE_MS, failJob, hasDueJobs, heartbeatJob } from './queue';

export interface WorkerOptions {
  /** Total wall-clock budget for this worker invocation. */
  budgetMs: number;
  /** Max budget handed to a single job execution (one crawl tick). */
  jobBudgetMs?: number;
  /** Wait for continuation jobs that become due within this window instead of exiting. */
  waitForDueWithinMs?: number;
  contextFactory?: (db: Database, budgetMs: number) => JobContext;
  workerId?: string;
}

export interface WorkerReport {
  workerId: string;
  executed: number;
  failed: number;
  /** True when queued work remains for a later invocation. */
  moreWork: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function nextDueInMs(db: Database): Promise<number | null> {
  const [row] = await db
    .select({ runAfter: jobs.runAfter })
    .from(jobs)
    .where(eq(jobs.status, 'queued'))
    .orderBy(jobs.runAfter)
    .limit(1);
  return row ? Math.max(0, row.runAfter.getTime() - Date.now()) : null;
}

/** Process due jobs until the budget is spent or the queue is idle. */
export async function runWorker(db: Database, options: WorkerOptions): Promise<WorkerReport> {
  const workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const started = Date.now();
  const remaining = () => options.budgetMs - (Date.now() - started);
  const jobBudget = options.jobBudgetMs ?? 50_000;
  const waitWindow = options.waitForDueWithinMs ?? 15_000;
  const contextFactory = options.contextFactory ?? defaultJobContextFactory;
  const report: WorkerReport = { workerId, executed: 0, failed: 0, moreWork: false };

  while (remaining() > 5_000) {
    const [job] = await claimJobs(db, workerId, { limit: 1, leaseMs: Math.max(DEFAULT_LEASE_MS, jobBudget + 30_000) });
    if (!job) {
      const dueIn = await nextDueInMs(db);
      if (dueIn !== null && dueIn <= waitWindow && dueIn < remaining() - 5_000) {
        await sleep(Math.max(dueIn, 200));
        continue;
      }
      break;
    }

    if (job.attempts > job.maxAttempts) {
      await failJob(db, job, new Error('Exceeded maximum attempts.'));
      report.failed++;
      continue;
    }
    const handler = jobHandlers[job.kind];
    if (!handler) {
      await failJob(db, { ...job, attempts: job.maxAttempts }, new Error(`Unknown job kind: ${job.kind}`));
      report.failed++;
      continue;
    }

    const heartbeat = setInterval(() => {
      heartbeatJob(db, job).catch((error: unknown) => log.warn('jobs.heartbeat.failed', { jobId: job.id, error }));
    }, 30_000);
    try {
      const budget = Math.min(jobBudget, remaining() - 3_000);
      const outcome = await handler(job, contextFactory(db, budget));
      if (outcome.status === 'continue') await continueJob(db, job, outcome.delayMs);
      else await completeJob(db, job);
      report.executed++;
    } catch (error) {
      const result = await failJob(db, job, error);
      report.failed++;
      log.error('jobs.failed', { jobId: job.id, kind: job.kind, attempts: job.attempts, result, error });
    } finally {
      clearInterval(heartbeat);
    }
  }

  // Only hand off for work that is due soon; anything later is picked up by the cron sweep.
  // (Counting every queued job would make invocations ping-pong on a job in retry backoff.)
  const dueSoon = await db.execute(sql`
    select 1 from siteforge.jobs
     where (status = 'queued' and run_after <= now() + interval '30 seconds')
        or (status = 'running' and locked_until < now())
     limit 1`);
  report.moreWork = rowsOf(dueSoon).length > 0;
  log.info('jobs.worker.finished', { ...report, ms: Date.now() - started });
  return report;
}

/**
 * Ask a fresh function invocation to continue processing. The target URL comes from
 * configuration only (APP_BASE_URL / VERCEL_URL / localhost) — never from request headers —
 * so the job secret can't be sent to a spoofed host.
 */
export async function requestWorkerInvocation(): Promise<void> {
  const env = serverEnv();
  const headers: Record<string, string> = { authorization: `Bearer ${env.jobSecret}` };
  if (env.vercelBypassSecret) headers['x-vercel-protection-bypass'] = env.vercelBypassSecret;
  try {
    const response = await fetch(`${env.appBaseUrl}/api/jobs/run`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) log.warn('jobs.kick.rejected', { status: response.status });
  } catch (error) {
    log.warn('jobs.kick.failed', { error });
  }
}

/** Run a worker now (inside `after()`), then hand off to a fresh invocation if work remains. */
export async function processJobsInBackground(db: Database, budgetMs: number): Promise<void> {
  const report = await runWorker(db, { budgetMs });
  if (report.moreWork) await requestWorkerInvocation();
}

export { hasDueJobs };

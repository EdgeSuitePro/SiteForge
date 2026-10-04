import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import { rowsOf } from '../db/rows';
import { jobs } from '../db/schema';

/**
 * Postgres-backed job queue.
 *
 *  - Claiming uses `FOR UPDATE SKIP LOCKED`, so concurrent workers never take the same job.
 *  - A claimed job holds a lease (`locked_until`). If a worker dies, the lease expires and the
 *    job becomes claimable again — this is what makes crawls restartable.
 *  - `dedupe_key` + a partial unique index guarantee at most one active job per key.
 */

export type JobRow = typeof jobs.$inferSelect;

export const DEFAULT_LEASE_MS = 120_000;

export interface EnqueueInput {
  kind: string;
  payload: Record<string, unknown>;
  workspaceId?: string | null;
  dedupeKey?: string;
  priority?: number;
  runAfter?: Date;
  maxAttempts?: number;
}

/** Enqueue a job. Returns null when an active job with the same dedupe key already exists. */
export async function enqueueJob(db: Database, input: EnqueueInput): Promise<JobRow | null> {
  const [row] = await db
    .insert(jobs)
    .values({
      kind: input.kind,
      payload: input.payload,
      workspaceId: input.workspaceId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      priority: input.priority ?? 0,
      runAfter: input.runAfter ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing({
      target: jobs.dedupeKey,
      where: sql`${jobs.status} in ('queued', 'running')`,
    })
    .returning();
  return row ?? null;
}

interface RawJobRow {
  id: string;
}

/** Claim up to `limit` due jobs (queued and due, or running with an expired lease). */
export async function claimJobs(
  db: Database,
  workerId: string,
  options: { limit?: number; leaseMs?: number; kinds?: readonly string[] } = {},
): Promise<JobRow[]> {
  const limit = options.limit ?? 1;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const kindFilter = options.kinds?.length
    ? sql`and kind in (${sql.join(
        options.kinds.map((kind) => sql`${kind}`),
        sql`, `,
      )})`
    : sql``;

  const result = await db.execute(sql`
    update siteforge.jobs
       set status = 'running',
           locked_by = ${workerId},
           locked_until = now() + (${leaseMs} * interval '1 millisecond'),
           attempts = attempts + 1,
           updated_at = now()
     where id in (
       select id from siteforge.jobs
        where ((status = 'queued' and run_after <= now())
            or (status = 'running' and locked_until < now()))
          ${kindFilter}
        order by priority desc, run_after asc
        limit ${limit}
        for update skip locked)
    returning id`);

  const ids = rowsOf<RawJobRow>(result).map((row) => row.id);
  if (ids.length === 0) return [];
  return db.select().from(jobs).where(inArray(jobs.id, ids));
}

/** Extend the lease while a long job is still making progress. */
export async function heartbeatJob(db: Database, job: JobRow, leaseMs = DEFAULT_LEASE_MS): Promise<void> {
  await db
    .update(jobs)
    .set({ lockedUntil: new Date(Date.now() + leaseMs) })
    .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, job.lockedBy ?? '')));
}

export async function completeJob(db: Database, job: JobRow): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'succeeded', lockedBy: null, lockedUntil: null, finishedAt: new Date(), lastError: null })
    .where(eq(jobs.id, job.id));
}

/** Re-queue the same job to continue later (e.g. the next crawl tick). Does not count as a failure. */
export async function continueJob(db: Database, job: JobRow, delayMs: number): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: 'queued',
      lockedBy: null,
      lockedUntil: null,
      attempts: 0,
      runAfter: new Date(Date.now() + Math.max(0, delayMs)),
    })
    .where(eq(jobs.id, job.id));
}

/** Record a failure: retry with exponential backoff, or fail permanently after maxAttempts. */
export async function failJob(db: Database, job: JobRow, error: unknown): Promise<'retrying' | 'failed'> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  if (job.attempts >= job.maxAttempts) {
    await db
      .update(jobs)
      .set({ status: 'failed', lockedBy: null, lockedUntil: null, lastError: message, finishedAt: new Date() })
      .where(eq(jobs.id, job.id));
    return 'failed';
  }
  const backoffMs = Math.min(5_000 * 2 ** (job.attempts - 1), 5 * 60_000);
  await db
    .update(jobs)
    .set({
      status: 'queued',
      lockedBy: null,
      lockedUntil: null,
      lastError: message,
      runAfter: new Date(Date.now() + backoffMs),
    })
    .where(eq(jobs.id, job.id));
  return 'retrying';
}

export async function cancelJobsByDedupeKey(db: Database, dedupeKey: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'canceled', lockedBy: null, lockedUntil: null, finishedAt: new Date() })
    .where(and(eq(jobs.dedupeKey, dedupeKey), eq(jobs.status, 'queued')));
}

/** Are there jobs that are due now (used to decide whether to kick a worker)? */
export async function hasDueJobs(db: Database): Promise<boolean> {
  const result = await db.execute(sql`
    select 1 as due from siteforge.jobs
     where (status = 'queued' and run_after <= now())
        or (status = 'running' and locked_until < now())
     limit 1`);
  return rowsOf(result).length > 0;
}

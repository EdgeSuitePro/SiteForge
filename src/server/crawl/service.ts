import 'server-only';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { CRAWLER_VERSION, resolveCrawlLimits, type CrawlLimits } from '../../core/crawl/limits';
import { parseOperatorUrl } from '../../core/url/normalize';
import { recordActivity } from '../activity';
import type { Operator } from '../auth/operator';
import type { Database } from '../db/client';
import { crawlPages, crawlRuns, prospects, type CrawlPageState } from '../db/schema';
import { CRAWL_JOB } from '../jobs/handlers';
import { cancelJobsByDedupeKey, enqueueJob } from '../jobs/queue';

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

export const createProspectInput = z.object({
  websiteUrl: z.string().trim().min(1, 'Enter a website URL.').max(2048),
  businessName: optionalText(200),
  city: optionalText(200),
  notes: optionalText(4000),
});

export type ProspectRecord = typeof prospects.$inferSelect;
export type CrawlRunRecord = typeof crawlRuns.$inferSelect;

export async function createProspect(
  db: Database,
  operator: Operator,
  raw: unknown,
): Promise<{ prospect: ProspectRecord; created: boolean }> {
  const input = createProspectInput.parse(raw);
  const parsed = parseOperatorUrl(input.websiteUrl);
  if (!parsed.ok) throw new ServiceError(parsed.message, 400);

  const [inserted] = await db
    .insert(prospects)
    .values({
      workspaceId: operator.workspaceId,
      websiteUrl: parsed.url.href,
      normalizedDomain: parsed.domain,
      businessNameHint: input.businessName,
      cityHint: input.city,
      notes: input.notes,
      createdBy: operator.userId,
    })
    .onConflictDoNothing({ target: [prospects.workspaceId, prospects.normalizedDomain] })
    .returning();

  if (inserted) {
    await recordActivity(db, {
      workspaceId: operator.workspaceId,
      prospectId: inserted.id,
      actorUserId: operator.userId,
      kind: 'prospect.created',
      detail: { websiteUrl: inserted.websiteUrl },
    });
    return { prospect: inserted, created: true };
  }

  const [existing] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.workspaceId, operator.workspaceId), eq(prospects.normalizedDomain, parsed.domain)));
  if (!existing) throw new ServiceError('The prospect could not be saved.', 409);
  return { prospect: existing, created: false };
}

export async function getProspect(db: Database, workspaceId: string, prospectId: string): Promise<ProspectRecord> {
  const [row] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.id, prospectId), eq(prospects.workspaceId, workspaceId)));
  if (!row) throw new ServiceError('Prospect not found.', 404);
  return row;
}

const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const;

/** Start (or return the already-active) crawl for a prospect. */
export async function startCrawl(
  db: Database,
  operator: Operator,
  prospectId: string,
  limitOverrides: Partial<CrawlLimits> = {},
): Promise<{ run: CrawlRunRecord; started: boolean }> {
  const prospect = await getProspect(db, operator.workspaceId, prospectId);
  if (prospect.status === 'archived') throw new ServiceError('This prospect is archived.', 409);

  const result = await db.transaction(async (tx) => {
    const [active] = await tx
      .select()
      .from(crawlRuns)
      .where(and(eq(crawlRuns.prospectId, prospect.id), inArray(crawlRuns.status, [...ACTIVE_RUN_STATUSES])))
      .limit(1);
    if (active) return { run: active, started: false };

    const [run] = await tx
      .insert(crawlRuns)
      .values({
        workspaceId: operator.workspaceId,
        prospectId: prospect.id,
        startUrl: prospect.websiteUrl,
        rootDomain: prospect.normalizedDomain,
        limits: resolveCrawlLimits(limitOverrides),
        crawlerVersion: CRAWLER_VERSION,
        requestedBy: operator.userId,
      })
      .returning();
    if (!run) throw new Error('Crawl run insert failed');
    await tx.update(prospects).set({ status: 'analyzing' }).where(eq(prospects.id, prospect.id));
    await enqueueJob(tx as unknown as Database, {
      kind: CRAWL_JOB,
      payload: { crawlRunId: run.id },
      workspaceId: operator.workspaceId,
      dedupeKey: `crawl:${run.id}`,
      priority: 10,
    });
    return { run, started: true };
  });

  if (result.started) {
    await recordActivity(db, {
      workspaceId: operator.workspaceId,
      prospectId: prospect.id,
      actorUserId: operator.userId,
      kind: 'crawl.requested',
      detail: { crawlRunId: result.run.id },
    });
  }
  return result;
}

/** Request cancellation. A crawl that has not started yet is canceled immediately. */
export async function cancelCrawl(db: Database, operator: Operator, prospectId: string): Promise<CrawlRunRecord | null> {
  const prospect = await getProspect(db, operator.workspaceId, prospectId);
  const [active] = await db
    .select()
    .from(crawlRuns)
    .where(and(eq(crawlRuns.prospectId, prospect.id), inArray(crawlRuns.status, [...ACTIVE_RUN_STATUSES])))
    .limit(1);
  if (!active) return null;

  if (active.status === 'queued') {
    await cancelJobsByDedupeKey(db, `crawl:${active.id}`);
    const [canceled] = await db
      .update(crawlRuns)
      .set({ status: 'canceled', stopReason: 'canceled', cancelRequested: true, finishedAt: new Date() })
      .where(and(eq(crawlRuns.id, active.id), eq(crawlRuns.status, 'queued')))
      .returning();
    if (canceled) {
      await db.update(prospects).set({ status: 'new' }).where(eq(prospects.id, prospect.id));
      await recordActivity(db, {
        workspaceId: operator.workspaceId,
        prospectId: prospect.id,
        actorUserId: operator.userId,
        kind: 'crawl.canceled',
        detail: { crawlRunId: active.id },
      });
      return canceled;
    }
  }

  const [flagged] = await db
    .update(crawlRuns)
    .set({ cancelRequested: true })
    .where(eq(crawlRuns.id, active.id))
    .returning();
  return flagged ?? null;
}

export interface CrawlProgress {
  run: Pick<
    CrawlRunRecord,
    | 'id'
    | 'status'
    | 'stopReason'
    | 'startUrl'
    | 'canonicalOrigin'
    | 'rootDomain'
    | 'limits'
    | 'crawlerVersion'
    | 'robots'
    | 'notes'
    | 'cancelRequested'
    | 'error'
    | 'startedAt'
    | 'finishedAt'
    | 'createdAt'
  >;
  counts: Record<CrawlPageState, number>;
  pages: Array<{
    id: string;
    url: string;
    state: CrawlPageState;
    skipReason: string | null;
    httpStatus: number | null;
    depth: number;
    source: string;
    title: string | null;
    error: string | null;
    truncated: boolean;
    fetchedAt: Date | null;
  }>;
}

export async function getLatestCrawlProgress(
  db: Database,
  workspaceId: string,
  prospectId: string,
): Promise<CrawlProgress | null> {
  const [run] = await db
    .select()
    .from(crawlRuns)
    .where(and(eq(crawlRuns.prospectId, prospectId), eq(crawlRuns.workspaceId, workspaceId)))
    .orderBy(desc(crawlRuns.createdAt))
    .limit(1);
  if (!run) return null;

  const countRows = await db
    .select({ state: crawlPages.state, n: sql<number>`count(*)::int` })
    .from(crawlPages)
    .where(eq(crawlPages.crawlRunId, run.id))
    .groupBy(crawlPages.state);
  const counts: Record<CrawlPageState, number> = { queued: 0, fetching: 0, fetched: 0, skipped: 0, failed: 0 };
  for (const row of countRows) counts[row.state] = Number(row.n);

  const pages = await db
    .select({
      id: crawlPages.id,
      url: crawlPages.url,
      state: crawlPages.state,
      skipReason: crawlPages.skipReason,
      httpStatus: crawlPages.httpStatus,
      depth: crawlPages.depth,
      source: crawlPages.source,
      summary: crawlPages.summary,
      error: crawlPages.error,
      truncated: crawlPages.truncated,
      fetchedAt: crawlPages.fetchedAt,
    })
    .from(crawlPages)
    .where(eq(crawlPages.crawlRunId, run.id))
    .orderBy(
      sql`case ${crawlPages.state} when 'fetching' then 0 when 'fetched' then 1 when 'failed' then 2 when 'queued' then 3 else 4 end`,
      desc(crawlPages.priority),
      crawlPages.createdAt,
    )
    .limit(300);

  return {
    run: {
      id: run.id,
      status: run.status,
      stopReason: run.stopReason,
      startUrl: run.startUrl,
      canonicalOrigin: run.canonicalOrigin,
      rootDomain: run.rootDomain,
      limits: run.limits,
      crawlerVersion: run.crawlerVersion,
      robots: run.robots,
      notes: run.notes,
      cancelRequested: run.cancelRequested,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: run.createdAt,
    },
    counts,
    pages: pages.map(({ summary, ...page }) => ({ ...page, title: summary?.title ?? null })),
  };
}

import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { buildProfile, conflictingServices, type ProfileFact, type ProfileField } from '../../core/facts/profile';
import { recordActivity } from '../activity';
import type { Operator } from '../auth/operator';
import { ServiceError, getProspect } from '../crawl/service';
import type { Database } from '../db/client';
import { businessFacts, extractionRuns, prospects, type FactReviewStatus } from '../db/schema';
import { latestExtractableCrawl, queueExtraction } from './extraction';

export type ExtractionRunRecord = typeof extractionRuns.$inferSelect;

export interface BusinessProfileView {
  run: Pick<
    ExtractionRunRecord,
    'id' | 'status' | 'crawlRunId' | 'extractorVersion' | 'factsVersion' | 'taxonomyVersion' | 'brandVersion' | 'brand' | 'stats' | 'error' | 'createdAt' | 'finishedAt'
  >;
  profile: ProfileField[];
  conflicts: string[];
  /** Run currently being processed, when it is newer than the one shown. */
  pending: Pick<ExtractionRunRecord, 'id' | 'status' | 'createdAt'> | null;
}

/** Latest completed extraction (shown) plus any newer queued/running one. */
export async function getBusinessProfile(db: Database, workspaceId: string, prospectId: string): Promise<BusinessProfileView | null> {
  const runs = await db
    .select()
    .from(extractionRuns)
    .where(and(eq(extractionRuns.prospectId, prospectId), eq(extractionRuns.workspaceId, workspaceId)))
    .orderBy(desc(extractionRuns.createdAt))
    .limit(10);
  const completed = runs.find((run) => run.status === 'completed');
  const newest = runs[0];
  const pending = newest && newest.status !== 'completed' && newest !== completed ? newest : null;
  const shown = completed ?? newest;
  if (!shown) return null;

  const rows = completed
    ? await db.select().from(businessFacts).where(eq(businessFacts.extractionRunId, completed.id))
    : [];
  const facts: ProfileFact[] = rows.map((row) => ({
    id: row.id,
    status: row.status,
    type: row.factType,
    key: row.factKey,
    value: row.value,
    display: row.display,
    method: row.method as ProfileFact['method'],
    confidence: row.confidence,
    occurrences: row.occurrences,
    pageCount: row.pageCount,
    onHomepage: row.onHomepage,
    inHeader: row.inHeader,
    evidence: row.evidence,
  }));

  return {
    run: {
      id: shown.id,
      status: shown.status,
      crawlRunId: shown.crawlRunId,
      extractorVersion: shown.extractorVersion,
      factsVersion: shown.factsVersion,
      taxonomyVersion: shown.taxonomyVersion,
      brandVersion: shown.brandVersion,
      brand: shown.brand,
      stats: shown.stats,
      error: shown.error,
      createdAt: shown.createdAt,
      finishedAt: shown.finishedAt,
    },
    profile: buildProfile(facts),
    conflicts: conflictingServices(facts),
    pending: pending ? { id: pending.id, status: pending.status, createdAt: pending.createdAt } : null,
  };
}

/** Re-run fact extraction on the latest completed crawl (no re-crawl). */
export async function startReExtraction(db: Database, operator: Operator, prospectId: string) {
  const prospect = await getProspect(db, operator.workspaceId, prospectId);
  const crawl = await latestExtractableCrawl(db, prospect.id);
  if (!crawl) throw new ServiceError('Analyze the website first.', 409);
  const [active] = await db
    .select({ id: extractionRuns.id })
    .from(extractionRuns)
    .where(and(eq(extractionRuns.prospectId, prospect.id), inArray(extractionRuns.status, ['queued', 'running'])))
    .limit(1);
  if (active) return { started: false };
  await queueExtraction(db, { workspaceId: operator.workspaceId, prospectId: prospect.id, crawlRunId: crawl.id, requestedBy: operator.userId });
  await db.update(prospects).set({ status: 'analyzing' }).where(eq(prospects.id, prospect.id));
  return { started: true };
}

export const reviewFactInput = z.object({
  factId: z.uuid(),
  status: z.enum(['unverified', 'verified', 'rejected']),
  note: z.string().trim().max(500).optional(),
});

/** Operator decision on one fact. Scoped to the operator's workspace. */
export async function reviewFact(db: Database, operator: Operator, raw: unknown) {
  const input = reviewFactInput.parse(raw);
  const status: FactReviewStatus = input.status;
  const [fact] = await db
    .update(businessFacts)
    .set({
      status,
      reviewedBy: status === 'unverified' ? null : operator.userId,
      reviewedAt: status === 'unverified' ? null : new Date(),
      reviewNote: input.note ?? null,
    })
    .where(and(eq(businessFacts.id, input.factId), eq(businessFacts.workspaceId, operator.workspaceId)))
    .returning();
  if (!fact) throw new ServiceError('Fact not found.', 404);
  await recordActivity(db, {
    workspaceId: operator.workspaceId,
    prospectId: fact.prospectId,
    actorUserId: operator.userId,
    kind: `fact.${status}`,
    detail: { factId: fact.id, type: fact.factType, key: fact.factKey },
  });
  return fact;
}

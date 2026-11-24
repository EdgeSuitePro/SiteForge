import 'server-only';

import { and, desc, eq, gt, inArray, sum } from 'drizzle-orm';

import { describeRules } from '../../core/audit/ruleset';
import { CATEGORY_INFO, SCORE_NAME } from '../../core/audit/types';
import type { Operator } from '../auth/operator';
import { ServiceError, getProspect } from '../crawl/service';
import type { Database } from '../db/client';
import { auditFindings, auditRuns, businessFacts, extractionRuns, modelRuns, prospects } from '../db/schema';
import { hasActiveAudit, latestCompletedExtraction, queueAudit } from './audit';

const REVIEW_PENDING_WINDOW_MS = 15 * 60_000;

export type AuditRunRecord = typeof auditRuns.$inferSelect;
export type AuditFindingRecord = typeof auditFindings.$inferSelect;

export interface AuditView {
  scoreName: string;
  run: AuditRunRecord;
  findings: AuditFindingRecord[];
  categoryInfo: typeof CATEGORY_INFO;
  rules: ReturnType<typeof describeRules>;
  /** True when facts were reviewed, or re-extracted, after this audit ran. */
  stale: boolean;
  pending: boolean;
  /** Provenance of the AI-assisted review, when it ran. */
  ai: {
    /** True while the semantic review is still queued or running. */
    reviewPending: boolean;
    model: string | null;
    provider: string | null;
    /** Estimated AI spend for this prospect, all time (USD). */
    totalCostUsd: number;
  };
}

export async function getAudit(db: Database, workspaceId: string, prospectId: string): Promise<AuditView | null> {
  const runs = await db
    .select()
    .from(auditRuns)
    .where(and(eq(auditRuns.prospectId, prospectId), eq(auditRuns.workspaceId, workspaceId)))
    .orderBy(desc(auditRuns.createdAt))
    .limit(10);
  const completed = runs.find((run) => run.status === 'completed');
  const pending = runs.some((run) => run.status === 'queued' || run.status === 'running');
  const shown = completed ?? runs[0];
  if (!shown) return null;

  const findings = completed
    ? await db.select().from(auditFindings).where(eq(auditFindings.auditRunId, completed.id)).orderBy(auditFindings.sortOrder)
    : [];

  let stale = false;
  if (completed) {
    const since = completed.createdAt;
    const [reviewedLater] = await db
      .select({ id: businessFacts.id })
      .from(businessFacts)
      .where(and(eq(businessFacts.extractionRunId, completed.extractionRunId), gt(businessFacts.reviewedAt, since)))
      .limit(1);
    const latestExtraction = await latestCompletedExtraction(db, prospectId);
    stale = Boolean(reviewedLater) || (latestExtraction !== null && latestExtraction.id !== completed.extractionRunId);
  }

  const [semanticRun] = completed?.semanticModelRunId
    ? await db.select({ model: modelRuns.modelServed, provider: modelRuns.provider }).from(modelRuns).where(eq(modelRuns.id, completed.semanticModelRunId))
    : [];
  const [spend] = await db.select({ total: sum(modelRuns.costUsd) }).from(modelRuns).where(eq(modelRuns.prospectId, prospectId));

  return {
    scoreName: SCORE_NAME,
    run: shown,
    findings,
    categoryInfo: CATEGORY_INFO,
    rules: describeRules(),
    stale,
    pending,
    ai: {
      // Bounded so a review whose job died never leaves the page refreshing forever.
      reviewPending:
        completed?.semanticStatus === 'pending' && Date.now() - new Date(completed.finishedAt ?? completed.createdAt).getTime() < REVIEW_PENDING_WINDOW_MS,
      model: semanticRun?.model ?? null,
      provider: semanticRun?.provider ?? null,
      totalCostUsd: Number(spend?.total ?? 0),
    },
  };
}

/** Re-run the audit on the latest completed extraction, including current fact decisions. */
export async function startReAudit(db: Database, operator: Operator, prospectId: string) {
  const prospect = await getProspect(db, operator.workspaceId, prospectId);
  const extraction = await latestCompletedExtraction(db, prospect.id);
  if (!extraction) throw new ServiceError('Analyze the website first.', 409);
  if (await hasActiveAudit(db, prospect.id)) return { started: false };
  const [activeExtraction] = await db
    .select({ id: extractionRuns.id })
    .from(extractionRuns)
    .where(and(eq(extractionRuns.prospectId, prospect.id), inArray(extractionRuns.status, ['queued', 'running'])))
    .limit(1);
  if (activeExtraction) return { started: false };
  await queueAudit(db, {
    workspaceId: operator.workspaceId,
    prospectId: prospect.id,
    extractionRunId: extraction.id,
    crawlRunId: extraction.crawlRunId,
    requestedBy: operator.userId,
  });
  await db.update(prospects).set({ status: 'analyzing' }).where(eq(prospects.id, prospect.id));
  return { started: true };
}

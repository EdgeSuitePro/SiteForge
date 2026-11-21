import 'server-only';

import { and, desc, eq, inArray, isNotNull, max, sql } from 'drizzle-orm';

import type { CrawlOutcome } from '../../core/audit/context';
import { auditWebsite } from '../../core/audit/ruleset';
import { RULESET_VERSION } from '../../core/audit/types';
import type { ProfileFact } from '../../core/facts/profile';
import { recordActivity } from '../activity';
import type { Database } from '../db/client';
import { auditFindings, auditRuns, businessFacts, crawlPages, crawlRuns, extractionRuns, pageExtractions, prospects } from '../db/schema';
import { enqueueJob } from '../jobs/queue';
import { log } from '../log';

export const AUDIT_JOB = 'audit';

export async function queueAudit(
  db: Database,
  input: { workspaceId: string; prospectId: string; extractionRunId: string; crawlRunId: string; requestedBy?: string | null },
) {
  const [run] = await db
    .insert(auditRuns)
    .values({ ...input, requestedBy: input.requestedBy ?? null, rulesetVersion: RULESET_VERSION })
    .returning();
  if (!run) throw new Error('Audit run insert failed');
  await enqueueJob(db, { kind: AUDIT_JOB, payload: { auditRunId: run.id }, workspaceId: input.workspaceId, dedupeKey: `audit:${run.id}`, priority: 4 });
  return run;
}

export function toProfileFact(row: typeof businessFacts.$inferSelect): ProfileFact {
  return {
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
  };
}

/** Apply the current ruleset to an extraction run (and its operator fact decisions). */
export async function runAuditJob(db: Database, auditRunId: string): Promise<void> {
  const [run] = await db.select().from(auditRuns).where(eq(auditRuns.id, auditRunId));
  if (!run || run.status === 'completed') return;
  await db.update(auditRuns).set({ status: 'running', startedAt: new Date(), error: null }).where(eq(auditRuns.id, run.id));

  const [crawl] = await db.select().from(crawlRuns).where(eq(crawlRuns.id, run.crawlRunId));
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, run.prospectId));
  if (!crawl || !prospect) throw new Error('Audit inputs missing');

  const pages = await db.select().from(pageExtractions).where(eq(pageExtractions.extractionRunId, run.extractionRunId));
  const outcomes = await db
    .select({
      pageId: crawlPages.id,
      url: crawlPages.url,
      state: crawlPages.state,
      httpStatus: crawlPages.httpStatus,
      skipReason: crawlPages.skipReason,
      discoveredFrom: crawlPages.discoveredFrom,
      linkText: crawlPages.linkText,
      error: crawlPages.error,
    })
    .from(crawlPages)
    .where(eq(crawlPages.crawlRunId, run.crawlRunId));
  const factRows = await db.select().from(businessFacts).where(eq(businessFacts.extractionRunId, run.extractionRunId));
  const [reviewed] = await db
    .select({ latest: max(businessFacts.reviewedAt) })
    .from(businessFacts)
    .where(and(eq(businessFacts.extractionRunId, run.extractionRunId), isNotNull(businessFacts.reviewedAt)));

  const result = auditWebsite({
    pages: pages.map((page) => ({ pageId: page.pageId, url: page.url, depth: page.depth, doc: page.document })),
    crawl: {
      canonicalOrigin: crawl.canonicalOrigin,
      outcomes: outcomes as CrawlOutcome[],
      sitemapUrlsFound: crawl.notes.sitemapUrlsFound ?? 0,
      robotsSitemaps: crawl.robots?.sitemaps.length ?? 0,
      likelyJsRendered: crawl.notes.likelyJsRendered ?? false,
      stopReason: crawl.stopReason,
    },
    facts: factRows.map(toProfileFact),
    prospect: { cityHint: prospect.cityHint },
  });

  await db.transaction(async (tx) => {
    await tx.delete(auditFindings).where(eq(auditFindings.auditRunId, run.id));
    if (result.findings.length) {
      await tx.insert(auditFindings).values(
        result.findings.map((finding, index) => ({
          auditRunId: run.id,
          workspaceId: run.workspaceId,
          prospectId: run.prospectId,
          ruleId: finding.ruleId,
          category: finding.category,
          source: finding.source,
          outcome: finding.outcome,
          severity: finding.severity,
          title: finding.title,
          detail: finding.detail,
          evidence: finding.evidence,
          whyItMatters: finding.whyItMatters,
          recommendedFix: finding.recommendedFix,
          requiresOwnerConfirmation: finding.requiresOwnerConfirmation,
          pointsPossible: finding.pointsPossible,
          pointsAwarded: finding.pointsAwarded,
          priority: finding.priority,
          sortOrder: index,
        })),
      );
    }
    await tx
      .update(auditRuns)
      .set({
        status: 'completed',
        overallScore: result.overall,
        categories: result.categories,
        caveats: result.caveats,
        factsReviewedThrough: reviewed?.latest ?? null,
        finishedAt: new Date(),
      })
      .where(eq(auditRuns.id, run.id));
    await tx.update(prospects).set({ status: 'analyzed' }).where(eq(prospects.id, run.prospectId));
  });

  await recordActivity(db, {
    workspaceId: run.workspaceId,
    prospectId: run.prospectId,
    kind: 'audit.completed',
    detail: { auditRunId: run.id, rulesetVersion: run.rulesetVersion, overall: result.overall },
  });
  log.info('audit.completed', { auditRunId: run.id, overall: result.overall, findings: result.findings.length });
}

export async function failAudit(db: Database, auditRunId: string, message: string) {
  const [run] = await db.update(auditRuns).set({ status: 'failed', error: message, finishedAt: new Date() }).where(eq(auditRuns.id, auditRunId)).returning();
  if (run) await db.update(prospects).set({ status: 'failed' }).where(eq(prospects.id, run.prospectId));
}

export async function latestCompletedExtraction(db: Database, prospectId: string) {
  const [run] = await db
    .select()
    .from(extractionRuns)
    .where(and(eq(extractionRuns.prospectId, prospectId), eq(extractionRuns.status, 'completed')))
    .orderBy(desc(extractionRuns.createdAt))
    .limit(1);
  return run ?? null;
}

export async function hasActiveAudit(db: Database, prospectId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditRuns)
    .where(and(eq(auditRuns.prospectId, prospectId), inArray(auditRuns.status, ['queued', 'running'])));
  return (row?.n ?? 0) > 0;
}

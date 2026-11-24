import 'server-only';

import { and, eq } from 'drizzle-orm';

import { scoreFindings } from '../../core/audit/scoring';
import type { Finding } from '../../core/audit/types';
import { aiFactsFrom } from '../../core/ai/fact-extract';
import {
  buildFactExtractUser,
  FACT_EXTRACT_PROMPT_ID,
  FACT_EXTRACT_PROMPT_VERSION,
  FACT_EXTRACT_SYSTEM,
  factExtractSchema,
} from '../../core/ai/prompts/fact-extract';
import {
  buildSemanticUser,
  SEMANTIC_PROMPT_ID,
  SEMANTIC_PROMPT_VERSION,
  SEMANTIC_SYSTEM,
  semanticAuditSchema,
} from '../../core/ai/prompts/semantic-audit';
import { applySemanticCap, semanticFindings } from '../../core/ai/semantic';
import type { AiProvider } from '../../core/ai/types';
import { packPages } from '../../core/ai/untrusted';
import { recordActivity } from '../activity';
import type { Database } from '../db/client';
import { auditFindings, auditRuns, businessFacts, extractionRuns, type AiStageStatus } from '../db/schema';
import { log } from '../log';
import { loadAuditPages, PACK_LIMITS } from './pages';
import { AiBudgetExceededError, runAiTask } from './run';

export const AI_EXTRACT_JOB = 'ai_extract';
export const SEMANTIC_AUDIT_JOB = 'semantic_audit';

const userMessage = (error: unknown) => {
  if (error instanceof AiBudgetExceededError) return error.message;
  if (error instanceof Error && error.name === 'AiRefusalError') return 'The AI model declined to review this content.';
  if (error instanceof Error && error.name === 'AiOutputError') return 'The AI response could not be used.';
  if (error instanceof Error && error.name === 'AiUnavailableError') return error.message;
  return 'The AI step failed.';
};

// ------------------------------------------------------------------------------------------------
// AI-assisted fact extraction (fast tier)
// ------------------------------------------------------------------------------------------------

/**
 * Adds facts the deterministic extractors missed. Only facts with a verified quote are stored,
 * and facts already found deterministically (same type + key) are left untouched.
 */
export async function runAiExtraction(db: Database, provider: AiProvider, extractionRunId: string): Promise<void> {
  const [run] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, extractionRunId));
  if (!run || run.aiStatus !== 'pending') return;

  const pages = packPages(await loadAuditPages(db, run.id), PACK_LIMITS.extract);
  if (pages.length === 0) {
    await db.update(extractionRuns).set({ aiStatus: 'skipped', aiError: 'No pages to read.' }).where(eq(extractionRuns.id, run.id));
    return;
  }

  const result = await runAiTask(db, provider, {
    task: 'facts.ai_extract',
    prompt: { id: FACT_EXTRACT_PROMPT_ID, version: FACT_EXTRACT_PROMPT_VERSION, system: FACT_EXTRACT_SYSTEM, user: buildFactExtractUser(pages), schema: factExtractSchema },
    workspaceId: run.workspaceId,
    prospectId: run.prospectId,
    related: { extractionRunId: run.id },
  });

  const { facts, rejected } = aiFactsFrom(result.data, pages);
  let added = 0;
  let duplicates = 0;
  for (const fact of facts) {
    const inserted = await db
      .insert(businessFacts)
      .values({
        workspaceId: run.workspaceId,
        prospectId: run.prospectId,
        extractionRunId: run.id,
        factType: fact.type,
        factKey: fact.key,
        value: fact.value,
        display: fact.display,
        method: fact.method,
        confidence: fact.confidence,
        occurrences: fact.occurrences,
        pageCount: fact.pageCount,
        onHomepage: fact.onHomepage,
        inHeader: fact.inHeader,
        evidence: fact.evidence,
        modelRunId: result.modelRunId,
      })
      .onConflictDoNothing()
      .returning({ id: businessFacts.id });
    if (inserted.length) added++;
    else duplicates++;
  }

  const status: AiStageStatus = provider.name === 'mock' ? 'mock' : 'completed';
  await db
    .update(extractionRuns)
    .set({ aiStatus: status, aiError: null, aiModelRunId: result.modelRunId, aiStats: { added, rejected, duplicates } })
    .where(eq(extractionRuns.id, run.id));
  log.info('ai.extract.completed', { extractionRunId: run.id, added, rejected, duplicates, provider: provider.name });
}

export async function failAiExtraction(db: Database, extractionRunId: string, error: unknown): Promise<void> {
  const status: AiStageStatus = error instanceof AiBudgetExceededError ? 'skipped' : 'failed';
  await db.update(extractionRuns).set({ aiStatus: status, aiError: userMessage(error) }).where(eq(extractionRuns.id, extractionRunId));
}

// ------------------------------------------------------------------------------------------------
// Semantic audit (strong tier)
// ------------------------------------------------------------------------------------------------

function rowToFinding(row: typeof auditFindings.$inferSelect): Finding {
  return {
    ruleId: row.ruleId,
    category: row.category,
    source: row.source,
    outcome: row.outcome,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    evidence: row.evidence,
    whyItMatters: row.whyItMatters,
    recommendedFix: row.recommendedFix,
    requiresOwnerConfirmation: row.requiresOwnerConfirmation,
    pointsPossible: row.pointsPossible,
    pointsAwarded: row.pointsAwarded,
    priority: row.priority,
  };
}

/** Run the rubric, store semantic findings (capped), and recompute the audit's scores. */
export async function runSemanticReview(db: Database, provider: AiProvider, auditRunId: string): Promise<void> {
  const [audit] = await db.select().from(auditRuns).where(eq(auditRuns.id, auditRunId));
  if (!audit || audit.status !== 'completed' || audit.semanticStatus !== 'pending') return;

  const pages = packPages(await loadAuditPages(db, audit.extractionRunId), PACK_LIMITS.semantic);
  if (pages.length === 0) {
    await db.update(auditRuns).set({ semanticStatus: 'skipped', semanticError: 'No pages to review.' }).where(eq(auditRuns.id, audit.id));
    return;
  }
  const [name] = await db
    .select({ display: businessFacts.display })
    .from(businessFacts)
    .where(and(eq(businessFacts.extractionRunId, audit.extractionRunId), eq(businessFacts.factType, 'business_name')))
    .limit(1);

  const result = await runAiTask(db, provider, {
    task: 'audit.semantic',
    prompt: {
      id: SEMANTIC_PROMPT_ID,
      version: SEMANTIC_PROMPT_VERSION,
      system: SEMANTIC_SYSTEM,
      user: buildSemanticUser({ pages, businessName: name?.display ?? null }),
      schema: semanticAuditSchema,
    },
    workspaceId: audit.workspaceId,
    prospectId: audit.prospectId,
    related: { auditRunId: audit.id, extractionRunId: audit.extractionRunId },
  });

  const scored = provider.name !== 'mock';
  const mapped = semanticFindings(result.data, pages, { scored });

  await db.transaction(async (tx) => {
    const existing = await tx.select().from(auditFindings).where(eq(auditFindings.auditRunId, audit.id));
    const deterministic = existing.filter((row) => row.source === 'deterministic').map(rowToFinding);
    const combined = applySemanticCap([...deterministic, ...mapped.findings]);
    const semantic = combined.filter((finding) => finding.source === 'semantic');
    const { overall, categories } = scoreFindings(combined);

    await tx.delete(auditFindings).where(and(eq(auditFindings.auditRunId, audit.id), eq(auditFindings.source, 'semantic')));
    if (semantic.length) {
      const offset = existing.length;
      await tx.insert(auditFindings).values(
        semantic.map((finding, index) => ({
          auditRunId: audit.id,
          workspaceId: audit.workspaceId,
          prospectId: audit.prospectId,
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
          sortOrder: offset + index,
          modelRunId: result.modelRunId,
        })),
      );
    }
    await tx
      .update(auditRuns)
      .set({
        overallScore: overall,
        categories,
        semanticStatus: scored ? 'completed' : 'mock',
        semanticError: null,
        semanticModelRunId: result.modelRunId,
        semanticPromptVersion: SEMANTIC_PROMPT_VERSION,
        semanticNotes: {
          citationsRejected: mapped.citationsRejected,
          instructionsFoundInContent: mapped.instructionsFoundInContent,
          provider: result.provider,
          model: result.model,
        },
      })
      .where(eq(auditRuns.id, audit.id));
  });

  await recordActivity(db, {
    workspaceId: audit.workspaceId,
    prospectId: audit.prospectId,
    kind: 'audit.semantic_completed',
    detail: { auditRunId: audit.id, provider: result.provider, model: result.model, citationsRejected: mapped.citationsRejected },
  });
}

export async function failSemanticReview(db: Database, auditRunId: string, error: unknown): Promise<void> {
  const status: AiStageStatus = error instanceof AiBudgetExceededError ? 'skipped' : 'failed';
  await db.update(auditRuns).set({ semanticStatus: status, semanticError: userMessage(error) }).where(eq(auditRuns.id, auditRunId));
}

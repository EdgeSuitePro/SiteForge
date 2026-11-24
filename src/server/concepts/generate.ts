import 'server-only';

import { createHash } from 'node:crypto';

import { and, desc, eq, gt } from 'drizzle-orm';

import { buildConceptBrief, buildConceptUser, CONCEPT_PROMPT_ID, CONCEPT_PROMPT_VERSION, CONCEPT_SYSTEM, conceptOutputSchema } from '../../core/ai/prompts/concept';
import type { AiProvider } from '../../core/ai/types';
import { buildCatalog } from '../../core/concepts/catalog';
import { availableCtas, checkConcept, siteShingles } from '../../core/concepts/claims';
import { draftConcept } from '../../core/concepts/draft';
import { normalizeConcept, type ConceptContent } from '../../core/concepts/schema';
import { designTokens, renderConcept } from '../../core/render';
import { recordActivity } from '../activity';
import { AiBudgetExceededError, runAiTask } from '../ai/run';
import { toProfileFact } from '../audit/audit';
import type { Database } from '../db/client';
import { auditFindings, businessFacts, concepts, extractionRuns, pageExtractions, prospects } from '../db/schema';
import { log } from '../log';

export const CONCEPT_JOB = 'generate_concept';

/** Titles of the audit's most important problems: what each concept should visibly fix. */
async function auditFocus(db: Database, auditRunId: string): Promise<string[]> {
  const rows = await db
    .select({ title: auditFindings.title, outcome: auditFindings.outcome, possible: auditFindings.pointsPossible, priority: auditFindings.priority, category: auditFindings.category })
    .from(auditFindings)
    .where(and(eq(auditFindings.auditRunId, auditRunId), gt(auditFindings.pointsPossible, 0)))
    .orderBy(desc(auditFindings.priority));
  return rows.filter((row) => row.outcome === 'fail' || row.outcome === 'partial').map((row) => row.title).slice(0, 8);
}

const failureNote = (error: unknown) =>
  error instanceof AiBudgetExceededError
    ? error.message
    : error instanceof Error && error.name === 'AiRefusalError'
      ? 'The AI model declined this request.'
      : error instanceof Error && (error.name === 'AiOutputError' || error.name === 'ZodError')
        ? 'The AI response could not be used.'
        : error instanceof Error && error.name === 'AiUnavailableError'
          ? error.message
          : 'The AI step failed.';

export function hashHtml(html: string): string {
  return createHash('sha256').update(html).digest('hex');
}

/**
 * Generate one concept: fact catalog → copy (strong-tier model, or the mock's fact-only draft) →
 * claim check → design tokens → render hash. If the AI step fails for a non-transient reason, a
 * deterministic fact-only draft is used instead and the reason is recorded.
 */
export async function runConceptJob(db: Database, provider: AiProvider, conceptId: string, options: { retryable: (error: unknown) => boolean }): Promise<void> {
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, conceptId));
  if (!concept || concept.status === 'completed' || concept.status === 'failed') return;
  await db.update(concepts).set({ status: 'running', startedAt: new Date(), error: null }).where(eq(concepts.id, concept.id));

  const [extraction] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, concept.extractionRunId));
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, concept.prospectId));
  if (!extraction || !prospect) throw new Error('Concept inputs missing');

  const facts = (await db.select().from(businessFacts).where(eq(businessFacts.extractionRunId, extraction.id))).map(toProfileFact);
  const catalog = buildCatalog(facts);
  const focus = await auditFocus(db, concept.auditRunId);
  const pages = await db.select({ document: pageExtractions.document }).from(pageExtractions).where(eq(pageExtractions.extractionRunId, extraction.id));
  const shingles = siteShingles(pages.map((page) => page.document.blocks.map((block) => block.text).join('\n')));

  let raw: unknown;
  let draft: ConceptContent;
  let modelRunId: string | null = null;
  let providerName: string = provider.name;
  let note: string | null = null;
  try {
    const brief = buildConceptBrief(concept.strategy, availableCtas(catalog), focus);
    const result = await runAiTask(db, provider, {
      task: 'concepts.generate',
      prompt: { id: CONCEPT_PROMPT_ID, version: CONCEPT_PROMPT_VERSION, system: CONCEPT_SYSTEM, user: buildConceptUser(brief, catalog), schema: conceptOutputSchema },
      workspaceId: concept.workspaceId,
      prospectId: concept.prospectId,
      related: { conceptId: concept.id, auditRunId: concept.auditRunId },
    });
    raw = result.data;
    modelRunId = result.modelRunId;
    draft = normalizeConcept(result.data);
  } catch (error) {
    if (options.retryable(error)) throw error;
    // Fall back to the deterministic, fact-only draft so the operator still has something to show.
    note = `AI copy unavailable (${failureNote(error)}) — showing a fact-only draft.`;
    log.warn('concepts.ai_fallback', { conceptId: concept.id, error });
    draft = draftConcept(concept.strategy, catalog, focus);
    raw = null;
    providerName = 'draft';
  }

  const { content, report } = checkConcept(draft, catalog, { strategy: concept.strategy, siteShingles: shingles });
  const tokens = designTokens(concept.strategy, extraction.brand ?? null);
  const { html } = renderConcept({ strategy: concept.strategy, content, catalog, tokens, domain: prospect.normalizedDomain });

  await db
    .update(concepts)
    .set({
      status: 'completed',
      content,
      rawContent: raw ?? null,
      claimReport: report,
      factCatalog: catalog,
      designTokens: tokens,
      provider: providerName,
      modelRunId,
      renderHash: hashHtml(html),
      error: note,
      finishedAt: new Date(),
    })
    .where(eq(concepts.id, concept.id));

  await recordActivity(db, {
    workspaceId: concept.workspaceId,
    prospectId: concept.prospectId,
    kind: 'concept.completed',
    detail: { conceptId: concept.id, strategy: concept.strategy, provider: providerName, violations: report.violations.length, placeholders: report.placeholders },
  });
  log.info('concepts.completed', { conceptId: concept.id, strategy: concept.strategy, provider: providerName, violations: report.violations.length });
}

export async function failConcept(db: Database, conceptId: string, error: unknown): Promise<void> {
  await db
    .update(concepts)
    .set({ status: 'failed', error: error instanceof Error ? error.message.slice(0, 500) : 'Concept generation failed.', finishedAt: new Date() })
    .where(eq(concepts.id, conceptId));
}

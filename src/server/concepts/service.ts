import 'server-only';

import { and, desc, eq, inArray, max } from 'drizzle-orm';

import { CONCEPT_PROMPT_VERSION } from '../../core/ai/prompts/concept';
import { CLAIM_CHECK_VERSION } from '../../core/concepts/claims';
import { CONCEPT_SCHEMA_VERSION, type StrategyId } from '../../core/concepts/schema';
import { STRATEGY_DEFINITIONS, STRATEGY_ORDER } from '../../core/concepts/strategies';
import { RENDERER_VERSION } from '../../core/render';
import { recordActivity } from '../activity';
import type { Operator } from '../auth/operator';
import { getProspect, ServiceError } from '../crawl/service';
import type { Database } from '../db/client';
import { auditRuns, concepts } from '../db/schema';
import { enqueueJob } from '../jobs/queue';
import { CONCEPT_JOB } from './generate';

export type ConceptRecord = typeof concepts.$inferSelect;

export interface ConceptsView {
  generation: number;
  concepts: ConceptRecord[];
  pending: boolean;
  /** The audit these concepts were generated from is no longer the latest one. */
  outdated: boolean;
  previousGenerations: number;
  canGenerate: boolean;
}

async function latestCompletedAudit(db: Database, prospectId: string) {
  const [audit] = await db
    .select()
    .from(auditRuns)
    .where(and(eq(auditRuns.prospectId, prospectId), eq(auditRuns.status, 'completed')))
    .orderBy(desc(auditRuns.createdAt))
    .limit(1);
  return audit ?? null;
}

export async function getConcepts(db: Database, workspaceId: string, prospectId: string): Promise<ConceptsView | null> {
  const audit = await latestCompletedAudit(db, prospectId);
  const [latest] = await db
    .select({ generation: max(concepts.generation) })
    .from(concepts)
    .where(and(eq(concepts.prospectId, prospectId), eq(concepts.workspaceId, workspaceId)));
  const generation = latest?.generation ?? 0;
  if (!generation) {
    return { generation: 0, concepts: [], pending: false, outdated: false, previousGenerations: 0, canGenerate: Boolean(audit) };
  }
  const rows = await db
    .select()
    .from(concepts)
    .where(and(eq(concepts.prospectId, prospectId), eq(concepts.workspaceId, workspaceId), eq(concepts.generation, generation)));
  rows.sort((a, b) => STRATEGY_ORDER.indexOf(a.strategy) - STRATEGY_ORDER.indexOf(b.strategy));
  const pending = rows.some((row) => row.status === 'queued' || row.status === 'running');
  return {
    generation,
    concepts: rows,
    pending,
    outdated: Boolean(audit && rows[0] && rows[0].auditRunId !== audit.id),
    previousGenerations: generation - 1,
    canGenerate: Boolean(audit) && !pending,
  };
}

/** Queue one concept per strategy, from the latest completed audit. */
export async function startConceptGeneration(db: Database, operator: Operator, prospectId: string): Promise<{ generation: number }> {
  const prospect = await getProspect(db, operator.workspaceId, prospectId);
  const audit = await latestCompletedAudit(db, prospect.id);
  if (!audit) throw new ServiceError('Analyze the website before generating concepts.', 409);
  const active = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(and(eq(concepts.prospectId, prospect.id), inArray(concepts.status, ['queued', 'running'])))
    .limit(1);
  if (active.length) throw new ServiceError('Concepts are already being generated.', 409);

  const [latest] = await db.select({ generation: max(concepts.generation) }).from(concepts).where(eq(concepts.prospectId, prospect.id));
  const generation = (latest?.generation ?? 0) + 1;
  const rows = await db
    .insert(concepts)
    .values(
      STRATEGY_ORDER.map((strategy: StrategyId) => ({
        workspaceId: prospect.workspaceId,
        prospectId: prospect.id,
        auditRunId: audit.id,
        extractionRunId: audit.extractionRunId,
        generation,
        strategy,
        schemaVersion: CONCEPT_SCHEMA_VERSION,
        rendererVersion: RENDERER_VERSION,
        claimCheckVersion: CLAIM_CHECK_VERSION,
        promptVersion: CONCEPT_PROMPT_VERSION,
        requestedBy: operator.userId,
      })),
    )
    .returning({ id: concepts.id, strategy: concepts.strategy });
  for (const row of rows) {
    await enqueueJob(db, { kind: CONCEPT_JOB, payload: { conceptId: row.id }, workspaceId: prospect.workspaceId, dedupeKey: `concept:${row.id}`, priority: 2, maxAttempts: 3 });
  }
  await recordActivity(db, {
    workspaceId: prospect.workspaceId,
    prospectId: prospect.id,
    actorUserId: operator.userId,
    kind: 'concepts.requested',
    detail: { generation, auditRunId: audit.id, strategies: rows.map((row) => row.strategy) },
  });
  return { generation };
}

/** A completed concept the operator may preview, with the prospect's domain for the banner. */
export async function getConceptForPreview(db: Database, workspaceId: string, conceptId: string) {
  const [concept] = await db.select().from(concepts).where(and(eq(concepts.id, conceptId), eq(concepts.workspaceId, workspaceId)));
  if (!concept || concept.status !== 'completed' || !concept.content || !concept.factCatalog || !concept.designTokens) return null;
  const prospect = await getProspect(db, workspaceId, concept.prospectId);
  return { concept: { ...concept, content: concept.content, factCatalog: concept.factCatalog, designTokens: concept.designTokens }, prospect };
}

export const strategyLabel = (strategy: StrategyId) => {
  const definition = STRATEGY_DEFINITIONS[strategy];
  return `Concept ${definition.letter} — ${definition.name}`;
};

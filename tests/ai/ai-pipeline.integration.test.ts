import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MockProvider } from '@/core/ai/mock';
import { FACT_EXTRACT_PROMPT_ID } from '@/core/ai/prompts/fact-extract';
import { RUBRIC, SEMANTIC_PROMPT_ID } from '@/core/ai/prompts/semantic-audit';
import { AiUnavailableError, type AiProvider, type StructuredRequest, type StructuredResponse } from '@/core/ai/types';
import { UNTRUSTED_TAG, type PackedPage } from '@/core/ai/untrusted';
import { createSafeFetcher } from '@/core/crawl/fetcher';
import { getAudit } from '@/server/audit/service';
import { startCrawl } from '@/server/crawl/service';
import type { DatabaseHandle } from '@/server/db/client';
import { auditRuns, businessFacts, extractionRuns, jobs, modelRuns } from '@/server/db/schema';
import type { JobContext } from '@/server/jobs/handlers';
import { runWorker } from '@/server/jobs/runner';

import { createTestDatabase } from '../support/db';
import { startFixtureServer, testFetchPolicy, type FixtureServer } from '../support/fixture-server';
import { createTestOperator, seedProspect } from '../support/operator';
import { sharpenerSite } from '../support/sharpener-site';

let handle: DatabaseHandle;
let server: FixtureServer;
let virtual = 0;

const pagesOf = (user: string): PackedPage[] => {
  const start = user.indexOf(`<${UNTRUSTED_TAG}>`) + UNTRUSTED_TAG.length + 2;
  return (JSON.parse(user.slice(start, user.lastIndexOf(`</${UNTRUSTED_TAG}>`))) as { pages: PackedPage[] }).pages;
};
const refOf = (pages: PackedPage[], path: string) => pages.find((page) => new URL(page.url).pathname === path)!.ref;

/** A stand-in for a real model: deterministic answers, some grounded and some invented. */
class ScriptedProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  calls: string[] = [];
  constructor(private readonly behaviour: 'good' | 'down' = 'good') {}

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    this.calls.push(request.promptId);
    if (this.behaviour === 'down') throw new AiUnavailableError('Provider overloaded', false);
    const pages = pagesOf(request.user);
    let output: unknown;
    if (request.promptId === FACT_EXTRACT_PROMPT_ID) {
      output = {
        facts: [
          { kind: 'owner_name', taxonomyKey: 'other', label: 'Family', page: refOf(pages, '/about'), quote: 'Family-run sharpening shop.' }, // label must appear in quote → kept
          { kind: 'service_area', taxonomyKey: 'other', label: '', page: refOf(pages, '/'), quote: 'Professional knife sharpening in Springfield.' },
          { kind: 'price', taxonomyKey: 'other', label: 'Cleaver', page: refOf(pages, '/pricing'), quote: 'Cleavers $15 each' }, // invented
          { kind: 'turnaround', taxonomyKey: 'other', label: 'Same day', page: refOf(pages, '/faq'), quote: 'Same-day turnaround guaranteed.' }, // invented
        ],
      };
    } else if (request.promptId === SEMANTIC_PROMPT_ID) {
      output = {
        answers: RUBRIC.map((question) => {
          if (question.id === 'purpose_obvious')
            return { id: question.id, rating: 'yes', explanation: 'The homepage says it.', citations: [{ page: 'p1', quote: 'Professional knife sharpening in Springfield.' }], suggestedFix: '' };
          if (question.id === 'establishes_trust')
            return { id: question.id, rating: 'yes', explanation: 'Award winning.', citations: [{ page: 'p1', quote: 'Voted best sharpener in the state three years running.' }], suggestedFix: '' };
          if (question.id === 'questions_answered')
            return { id: question.id, rating: 'no', explanation: 'Turnaround and packaging are not explained.', citations: [], suggestedFix: 'Add an FAQ answer about turnaround.' };
          return { id: question.id, rating: 'cannot_assess', explanation: 'Not enough text.', citations: [], suggestedFix: '' };
        }),
        opportunities: [
          { title: 'Garden tool sharpening', rationale: 'Listed but not promoted.', citations: [{ page: refOf(pages, '/services'), quote: 'Garden tools' }] },
          { title: 'Axe restoration', rationale: 'Invented.', citations: [{ page: 'p1', quote: 'We restore antique axes.' }] },
        ],
        instructionsFoundInContent: false,
      };
    } else throw new Error(request.promptId);
    return {
      data: request.schema.parse(output),
      usage: { inputTokens: 10_000, outputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      servedModel: request.model,
      stopReason: 'end_turn',
      latencyMs: 5,
    };
  }
}

async function runPipeline(ai: AiProvider) {
  const context = (db: DatabaseHandle['db'], budgetMs: number): JobContext => ({
    db,
    budgetMs,
    ai,
    createFetcher: () => createSafeFetcher(testFetchPolicy),
    clock: { now: () => Date.now() + virtual, sleep: async (ms) => void (virtual += ms) },
  });
  for (let i = 0; i < 30; i++) {
    const report = await runWorker(handle.db, { budgetMs: 120_000, jobBudgetMs: 120_000, waitForDueWithinMs: 0, contextFactory: context });
    if (report.executed === 0 && report.failed === 0) {
      const pending = await handle.db.update(jobs).set({ runAfter: new Date(0) }).where(eq(jobs.status, 'queued')).returning();
      if (pending.length === 0) return;
    }
  }
}

async function analyze(ai: AiProvider, before?: (prospectId: string) => Promise<void>) {
  const operator = await createTestOperator(handle.db);
  const { prospect } = await seedProspect(handle.db, operator, `http://www.edgeworks.test:${server.port}/`);
  await before?.(prospect.id);
  await startCrawl(handle.db, operator, prospect.id);
  await runPipeline(ai);
  const audit = await getAudit(handle.db, operator.workspaceId, prospect.id);
  const [extraction] = await handle.db.select().from(extractionRuns).where(eq(extractionRuns.prospectId, prospect.id));
  const runs = await handle.db.select().from(modelRuns).where(eq(modelRuns.prospectId, prospect.id));
  return { prospect, audit: audit!, extraction: extraction!, runs };
}

beforeAll(async () => {
  handle = await createTestDatabase();
  const site = sharpenerSite(() => server.port);
  server = await startFixtureServer(site.routes, site.fallback);
});

afterAll(async () => {
  await server.close();
  await handle.close();
});

describe('AI stages in the pipeline', () => {
  it('mock provider: labelled as mock, never scored, recorded at zero cost', async () => {
    const { audit, extraction, runs } = await analyze(new MockProvider());
    expect(extraction.aiStatus).toBe('mock');
    expect(audit.run.status).toBe('completed');
    expect(audit.run.semanticStatus).toBe('mock');
    const semantic = audit.findings.filter((finding) => finding.source === 'semantic');
    expect(semantic.length).toBeGreaterThan(0);
    expect(semantic.every((finding) => finding.pointsPossible === 0 && finding.pointsAwarded === 0)).toBe(true);
    expect(runs.map((run) => run.task).sort()).toEqual(['audit.semantic', 'facts.ai_extract']);
    expect(runs.every((run) => run.status === 'succeeded' && run.costUsd === 0 && run.provider === 'mock')).toBe(true);
  });

  it('real provider: keeps only verified quotes, caps semantic weight, records cost', async () => {
    const ai = new ScriptedProvider();
    const { prospect, audit, extraction, runs } = await analyze(ai);
    expect(ai.calls).toEqual([FACT_EXTRACT_PROMPT_ID, SEMANTIC_PROMPT_ID]);

    expect(extraction.aiStatus).toBe('completed');
    expect(extraction.aiStats).toMatchObject({ rejected: 2 });
    const aiFacts = await handle.db
      .select()
      .from(businessFacts)
      .where(and(eq(businessFacts.prospectId, prospect.id), eq(businessFacts.method, 'ai_extracted')));
    const types = aiFacts.map((fact) => fact.factType);
    expect(types).not.toContain('price');
    expect(types).not.toContain('turnaround');
    expect(aiFacts.every((fact) => fact.modelRunId && fact.evidence[0]?.locator === 'ai quote (verified)')).toBe(true);

    expect(audit.run.semanticStatus).toBe('completed');
    expect(audit.run.semanticNotes).toMatchObject({ citationsRejected: 2, instructionsFoundInContent: false });
    const byRule = new Map(audit.findings.map((finding) => [finding.ruleId, finding]));
    expect(byRule.get('semantic.purpose_obvious')).toMatchObject({ outcome: 'pass', source: 'semantic' });
    expect(byRule.get('semantic.purpose_obvious')!.evidence[0]?.snippet).toContain('Springfield');
    expect(byRule.get('semantic.establishes_trust')?.outcome).toBe('unknown'); // invented award quote discarded
    expect(byRule.get('semantic.questions_answered')?.outcome).toBe('fail');
    const opportunities = audit.findings.filter((finding) => finding.ruleId.startsWith('semantic.opportunity'));
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ requiresOwnerConfirmation: true, pointsPossible: 0 });
    expect(opportunities[0]!.title).toMatch(/^Potential opportunity — requires owner confirmation/);

    // Semantic points never exceed 40% of a category.
    for (const category of audit.run.categories!) {
      const inCategory = audit.findings.filter((finding) => finding.category === category.category);
      const semanticPossible = inCategory.filter((finding) => finding.source === 'semantic').reduce((total, finding) => total + finding.pointsPossible, 0);
      const allPossible = inCategory.reduce((total, finding) => total + finding.pointsPossible, 0);
      if (allPossible > 0) expect(semanticPossible / allPossible, category.category).toBeLessThanOrEqual(0.4 + 1e-6);
    }

    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === 'succeeded' && (run.costUsd ?? 0) > 0 && run.promptVersion && run.inputHash.length === 64)).toBe(true);
    expect(runs.find((run) => run.task === 'facts.ai_extract')?.modelRequested).toBe('claude-haiku-5-5');
    expect(runs.find((run) => run.task === 'audit.semantic')?.modelRequested).toBe('claude-sonnet-5-5');
  });

  it('skips AI once the per-prospect budget is spent; the deterministic audit still completes', async () => {
    const ai = new ScriptedProvider();
    const operator = await createTestOperator(handle.db);
    const { audit, extraction, runs } = await analyze(ai, async (prospectId) => {
      await handle.db.insert(modelRuns).values({
        workspaceId: operator.workspaceId,
        prospectId,
        task: 'audit.semantic',
        provider: 'anthropic',
        tier: 'strong',
        modelRequested: 'claude-sonnet-5-5',
        promptId: SEMANTIC_PROMPT_ID,
        promptVersion: 'semantic-audit@1',
        effort: 'medium',
        inputHash: 'x'.repeat(64),
        pricesVersion: 'test',
        status: 'succeeded',
        costUsd: 5,
        related: {},
      });
    });
    expect(ai.calls).toEqual([]);
    expect(extraction.aiStatus).toBe('skipped');
    expect(audit.run).toMatchObject({ status: 'completed', semanticStatus: 'skipped' });
    expect(audit.run.overallScore).toEqual(expect.any(Number));
    expect(audit.findings.every((finding) => finding.source === 'deterministic')).toBe(true);
    expect(runs.filter((run) => run.status === 'skipped_budget')).toHaveLength(2);
  });

  it('degrades gracefully when the provider fails', async () => {
    const { audit, extraction, runs } = await analyze(new ScriptedProvider('down'));
    expect(extraction).toMatchObject({ aiStatus: 'failed', aiError: 'Provider overloaded' });
    expect(audit.run).toMatchObject({ status: 'completed', semanticStatus: 'failed' });
    expect(audit.run.overallScore).toEqual(expect.any(Number));
    expect(runs.every((run) => run.status === 'failed')).toBe(true);
    const [row] = await handle.db.select().from(auditRuns).where(eq(auditRuns.id, audit.run.id));
    expect(row?.semanticError).toBe('Provider overloaded');
  });
});

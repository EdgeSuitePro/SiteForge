import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MockProvider } from '@/core/ai/mock';
import { BRIEF_TAG, CONCEPT_PROMPT_ID, type ConceptBrief } from '@/core/ai/prompts/concept';
import { AiUnavailableError, type AiProvider, type StructuredRequest, type StructuredResponse } from '@/core/ai/types';
import { UNTRUSTED_TAG } from '@/core/ai/untrusted';
import { createSafeFetcher } from '@/core/crawl/fetcher';
import { renderConcept } from '@/core/render';
import { startCrawl } from '@/server/crawl/service';
import { getConcepts, startConceptGeneration } from '@/server/concepts/service';
import type { DatabaseHandle } from '@/server/db/client';
import { jobs, modelRuns } from '@/server/db/schema';
import type { JobContext } from '@/server/jobs/handlers';
import { runWorker } from '@/server/jobs/runner';

import { createTestDatabase } from '../support/db';
import { startFixtureServer, testFetchPolicy, type FixtureServer } from '../support/fixture-server';
import { createTestOperator, seedProspect } from '../support/operator';
import { sharpenerSite } from '../support/sharpener-site';

let handle: DatabaseHandle;
let server: FixtureServer;
let virtual = 0;

/** Delegates everything to the mock, except concept copy, which it fabricates on purpose. */
class FabricatingProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  private readonly mock = new MockProvider();
  constructor(private readonly mode: 'fabricate' | 'down') {}

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    if (request.promptId !== CONCEPT_PROMPT_ID) return this.mock.generateStructured(request);
    if (this.mode === 'down') throw new AiUnavailableError('Provider overloaded', false);
    const brief = JSON.parse(request.user.slice(request.user.indexOf(`<${BRIEF_TAG}>`) + BRIEF_TAG.length + 2, request.user.indexOf(`</${BRIEF_TAG}>`))) as ConceptBrief;
    const facts = JSON.parse(request.user.slice(request.user.indexOf(`<${UNTRUSTED_TAG}>`) + UNTRUSTED_TAG.length + 2, request.user.lastIndexOf(`</${UNTRUSTED_TAG}>`))).facts as { ref: string; type: string }[];
    const service = facts.find((fact) => fact.type === 'service')!.ref;
    const output = {
      hero: {
        eyebrow: 'Since 1987',
        headline: 'The best knife sharpening in Springfield',
        subheadline: 'Same-day service, guaranteed. Over 20 years of experience.',
        primaryCta: 'call',
        secondaryCta: 'mail_in',
      },
      sections: [
        { kind: 'services', heading: 'What we sharpen', intro: 'Kitchen knives and more.', items: [{ ref: service, blurb: 'Everyday knives.' }, { ref: 'f999', blurb: 'x' }] },
        { kind: 'trust', heading: 'Reviews', body: '“Best sharpener in town!” — Mary P. We take care of every edge.', refs: [] },
        { kind: 'process', heading: 'How it works', intro: 'Mail-in kits from $15.', steps: [{ title: 'Drop off', body: 'Bring them in.' }, { title: 'Pick up', body: 'Collect them sharp.' }] },
        { kind: 'service_area', heading: 'Where', body: 'Serving Springfield and Peoria.', refs: [] },
        { kind: 'contact', heading: 'Contact', body: 'Call us.' },
        { kind: 'cta_band', heading: 'Ready?', body: 'Book now.', cta: 'book' },
        { kind: 'about', heading: 'About', body: 'Certified master sharpener.', refs: [] },
      ],
      seo: { title: '#1 sharpener', metaDescription: 'Award-winning.' },
      rationale: `Fabricated on purpose for ${brief.strategy}.`,
    };
    return { data: request.schema.parse(output), usage: { inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 }, servedModel: request.model, stopReason: 'end_turn', latencyMs: 5 };
  }
}

async function drain(ai: AiProvider) {
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

async function analyzedProspect(ai: AiProvider) {
  const operator = await createTestOperator(handle.db);
  const { prospect } = await seedProspect(handle.db, operator, `http://www.edgeworks.test:${server.port}/`);
  await startCrawl(handle.db, operator, prospect.id);
  await drain(ai);
  return { operator, prospect };
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

describe('concept generation', () => {
  it('refuses before the site has been analyzed', async () => {
    const operator = await createTestOperator(handle.db);
    const { prospect } = await seedProspect(handle.db, operator, `http://www.edgeworks.test:${server.port}/`);
    await expect(startConceptGeneration(handle.db, operator, prospect.id)).rejects.toThrow(/Analyze the website/);
  });

  it('generates three grounded concepts (mock provider) and keeps them for later', async () => {
    const ai = new MockProvider();
    const { operator, prospect } = await analyzedProspect(ai);
    expect(await startConceptGeneration(handle.db, operator, prospect.id)).toEqual({ generation: 1 });
    await expect(startConceptGeneration(handle.db, operator, prospect.id)).rejects.toThrow(/already being generated/);
    await drain(ai);

    const view = await getConcepts(handle.db, operator.workspaceId, prospect.id);
    expect(view?.concepts.map((concept) => [concept.strategy, concept.status, concept.provider])).toEqual([
      ['local_growth', 'completed', 'mock'],
      ['craftsman', 'completed', 'mock'],
      ['fastest_path', 'completed', 'mock'],
    ]);
    for (const concept of view!.concepts) {
      expect(concept.claimReport?.violations).toEqual([]);
      expect(concept.renderHash).toMatch(/^[0-9a-f]{64}$/);
      expect(concept.factCatalog!.facts.length).toBeGreaterThan(3);
      const { html } = renderConcept({ strategy: concept.strategy, content: concept.content!, catalog: concept.factCatalog!, tokens: concept.designTokens!, domain: prospect.normalizedDomain });
      expect(html).toContain('Nothing on edgeworks.test has been changed');
      expect(html).not.toMatch(/serrated knives/i); // the site says it does not sharpen these
    }
    // Brand colour from the site's CSS (#9c3d12) is carried into the design tokens.
    expect(view!.concepts[0]!.designTokens?.brandSource).toBe('extracted');

    // A second generation keeps the first.
    await startConceptGeneration(handle.db, operator, prospect.id);
    await drain(ai);
    const again = await getConcepts(handle.db, operator.workspaceId, prospect.id);
    expect(again).toMatchObject({ generation: 2, previousGenerations: 1, pending: false });
  });

  it('catches every fabricated claim from a model and replaces it with operator placeholders', async () => {
    const ai = new FabricatingProvider('fabricate');
    const { operator, prospect } = await analyzedProspect(ai);
    await startConceptGeneration(handle.db, operator, prospect.id);
    await drain(ai);

    const view = await getConcepts(handle.db, operator.workspaceId, prospect.id);
    const fastest = view!.concepts.find((concept) => concept.strategy === 'fastest_path')!;
    const kinds = new Set(fastest.claimReport!.violations.map((violation) => violation.kind));
    for (const kind of ['year', 'superlative', 'turnaround', 'guarantee', 'experience', 'testimonial', 'price', 'place', 'credential']) {
      expect(kinds, kind).toContain(kind);
    }
    const issues = fastest.claimReport!.structural.map((issue) => issue.issue).join('\n');
    expect(issues).toMatch(/f999/);
    expect(issues).toMatch(/mail_in/);
    expect(issues).toMatch(/about section is not part of the Fastest Path/);

    const { html: page } = renderConcept({ strategy: fastest.strategy, content: fastest.content!, catalog: fastest.factCatalog!, tokens: fastest.designTokens!, domain: 'x', placeholders: 'hide' });
    const html = page.replace(/<style>[\s\S]*?<\/style>/, ''); // CSS colours like #111827 are not claims
    for (const fabricated of ['1987', 'best', 'Same-day', 'guaranteed', '20 years', 'Mary P', '$15', 'Peoria', 'Certified', '#1', 'Award']) {
      expect(html, fabricated).not.toContain(fabricated);
    }
    expect(fastest.content!.seo.title).not.toContain('#1');
    expect(fastest.rawContent).toBeTruthy(); // original kept for review
    const [run] = await handle.db.select().from(modelRuns).where(eq(modelRuns.id, fastest.modelRunId!));
    expect(run).toMatchObject({ task: 'concepts.generate', modelRequested: 'claude-sonnet-5-5', status: 'succeeded' });
  });

  it('falls back to a labelled fact-only draft when the model is unavailable', async () => {
    const ai = new FabricatingProvider('down');
    const { operator, prospect } = await analyzedProspect(ai);
    await startConceptGeneration(handle.db, operator, prospect.id);
    await drain(ai);
    const view = await getConcepts(handle.db, operator.workspaceId, prospect.id);
    for (const concept of view!.concepts) {
      expect(concept).toMatchObject({ status: 'completed', provider: 'draft' });
      expect(concept.error).toMatch(/AI copy unavailable \(Provider overloaded\)/);
      expect(concept.claimReport!.violations).toEqual([]);
    }
  });
});

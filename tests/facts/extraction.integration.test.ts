import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSafeFetcher } from '@/core/crawl/fetcher';
import { startCrawl } from '@/server/crawl/service';
import type { DatabaseHandle } from '@/server/db/client';
import { businessFacts, extractionRuns, jobs, pageExtractions, prospects } from '@/server/db/schema';
import { getBusinessProfile, reviewFact, startReExtraction } from '@/server/facts/service';
import type { JobContext } from '@/server/jobs/handlers';
import { runWorker } from '@/server/jobs/runner';

import { createTestDatabase } from '../support/db';
import { startFixtureServer, testFetchPolicy, type FixtureServer } from '../support/fixture-server';
import { createTestOperator, seedProspect } from '../support/operator';
import { sharpenerSite } from '../support/sharpener-site';

let handle: DatabaseHandle;
let server: FixtureServer;
let virtual = 0;
const context = (db: DatabaseHandle['db'], budgetMs: number): JobContext => ({
  db,
  budgetMs,
  createFetcher: () => createSafeFetcher(testFetchPolicy),
  clock: { now: () => Date.now() + virtual, sleep: async (ms) => void (virtual += ms) },
});

async function drain() {
  for (let i = 0; i < 20; i++) {
    const report = await runWorker(handle.db, { budgetMs: 120_000, jobBudgetMs: 120_000, waitForDueWithinMs: 0, contextFactory: context });
    if (report.executed === 0 && report.failed === 0) {
      const pending = await handle.db.update(jobs).set({ runAfter: new Date(0) }).where(eq(jobs.status, 'queued')).returning();
      if (pending.length === 0) return;
    }
  }
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

describe('crawl → extract pipeline', () => {
  it('extracts an evidence-backed business profile after a crawl', async () => {
    const operator = await createTestOperator(handle.db);
    const { prospect } = await seedProspect(handle.db, operator, `http://www.edgeworks.test:${server.port}/`);
    await startCrawl(handle.db, operator, prospect.id);
    await drain();

    const view = await getBusinessProfile(handle.db, operator.workspaceId, prospect.id);
    expect(view?.run).toMatchObject({ status: 'completed', extractorVersion: 'extract@1', factsVersion: 'facts@1', taxonomyVersion: 'sharpening-taxonomy@2' });
    const field = (name: string) => view!.profile.find((entry) => entry.field === name)!;

    expect(field('phone').primary).toMatchObject({ display: '(217) 555-0188', inHeader: true });
    expect(field('phone').primary!.evidence[0]).toMatchObject({ locator: 'link tel (header)' });
    expect(field('address').primary?.display).toBe('400 Elm St, Springfield, IL 62701');
    expect(field('business_name').primary?.display).toBe('Edge Works Sharpening');
    expect(field('services').values.map((fact) => fact.key)).toEqual(expect.arrayContaining(['kitchen_knives', 'scissors', 'garden_tools']));
    expect(field('not_offered').values.map((fact) => fact.key)).toEqual(['serrated_knives']);
    expect(field('pricing').values.some((fact) => fact.value.amount === 8)).toBe(true);
    // Never invented: nothing on the fixture site states these.
    for (const name of ['email', 'hours', 'turnaround', 'owner', 'booking', 'years']) expect(field(name).primary, name).toBeNull();

    expect(view?.run.brand?.brandColors[0]).toBe('#9c3d12');
    expect(view?.run.brand?.fonts).toContain('Lora');
    expect(view?.run.stats?.stylesheetsFetched).toBe(1);

    const pagesStored = await handle.db.select().from(pageExtractions).where(eq(pageExtractions.extractionRunId, view!.run.id));
    expect(pagesStored.length).toBe(view?.run.stats?.pages);
    expect(pagesStored[0]?.document).not.toHaveProperty('inlineCss');

    const [after] = await handle.db.select().from(prospects).where(eq(prospects.id, prospect.id));
    expect(after?.status).toBe('analyzed');
  });

  it('keeps operator decisions when facts are re-extracted, and isolates workspaces', async () => {
    const operator = await createTestOperator(handle.db);
    const { prospect } = await seedProspect(handle.db, operator, `http://www.edgeworks.test:${server.port}/`);
    await startCrawl(handle.db, operator, prospect.id);
    await drain();

    const first = await getBusinessProfile(handle.db, operator.workspaceId, prospect.id);
    const phone = first!.profile.find((entry) => entry.field === 'phone')!.primary!;
    const garden = first!.profile.find((entry) => entry.field === 'services')!.values.find((fact) => fact.key === 'garden_tools')!;
    await reviewFact(handle.db, operator, { factId: phone.id, status: 'verified' });
    await reviewFact(handle.db, operator, { factId: garden.id, status: 'rejected', note: 'Owner says no longer offered' });

    const outsider = await createTestOperator(handle.db);
    await expect(reviewFact(handle.db, outsider, { factId: phone.id, status: 'rejected' })).rejects.toThrow(/not found/i);

    expect(await startReExtraction(handle.db, operator, prospect.id)).toEqual({ started: true });
    await drain();

    const second = await getBusinessProfile(handle.db, operator.workspaceId, prospect.id);
    expect(second!.run.id).not.toBe(first!.run.id);
    const facts = await handle.db.select().from(businessFacts).where(eq(businessFacts.extractionRunId, second!.run.id));
    expect(facts.find((fact) => fact.factType === 'phone')?.status).toBe('verified');
    const carried = facts.find((fact) => fact.factKey === 'garden_tools');
    expect(carried).toMatchObject({ status: 'rejected', reviewNote: 'Owner says no longer offered' });
    // Rejected facts drop out of the profile.
    expect(second!.profile.find((entry) => entry.field === 'services')!.values.map((fact) => fact.key)).not.toContain('garden_tools');

    const runs = await handle.db.select().from(extractionRuns).where(and(eq(extractionRuns.prospectId, prospect.id), eq(extractionRuns.status, 'completed')));
    expect(runs).toHaveLength(2);
  });
});

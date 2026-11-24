import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MockProvider } from '@/core/ai/mock';
import { createSafeFetcher } from '@/core/crawl/fetcher';
import { getAudit, startReAudit } from '@/server/audit/service';
import { startCrawl } from '@/server/crawl/service';
import type { DatabaseHandle } from '@/server/db/client';
import { jobs, prospects } from '@/server/db/schema';
import { getBusinessProfile, reviewFact } from '@/server/facts/service';
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
  ai: new MockProvider(),
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

describe('crawl → extract → audit pipeline', () => {
  it('produces a transparent, evidence-backed audit and marks the prospect analyzed', async () => {
    const operator = await createTestOperator(handle.db);
    const { prospect } = await seedProspect(handle.db, operator, `http://www.edgeworks.test:${server.port}/`);
    await startCrawl(handle.db, operator, prospect.id);
    await drain();

    const audit = await getAudit(handle.db, operator.workspaceId, prospect.id);
    expect(audit?.run).toMatchObject({ status: 'completed', rulesetVersion: 'esp-audit@1' });
    expect(audit?.run.overallScore).toEqual(expect.any(Number));
    expect(audit?.stale).toBe(false);

    const byRule = new Map(audit!.findings.map((finding) => [finding.ruleId, finding]));
    expect(byRule.get('visibility.https')).toMatchObject({ outcome: 'fail', severity: 'high' }); // fixture runs on http
    expect(byRule.get('conversion.phone_prominent')?.outcome).toBe('pass');
    expect(byRule.get('local.location_stated')?.outcome).toBe('pass');
    expect(byRule.get('experience.broken_links')?.detail).toContain('/missing (linked from /pricing)');
    expect(byRule.get('revenue.commercial')).toMatchObject({ requiresOwnerConfirmation: true, pointsPossible: 0 });

    // Category scores add up from the stored findings.
    for (const category of audit!.run.categories!) {
      const findings = audit!.findings.filter((finding) => finding.category === category.category && !['not_applicable', 'unknown'].includes(finding.outcome));
      const possible = findings.reduce((total, finding) => total + finding.pointsPossible, 0);
      expect(category.possible, category.category).toBe(possible);
    }
    // Problems are stored first.
    expect(audit!.findings[0]!.outcome).not.toBe('pass');

    const [after] = await handle.db.select().from(prospects).where(eq(prospects.id, prospect.id));
    expect(after?.status).toBe('analyzed');
  });

  it('marks the audit stale after an operator rejects a fact, and a re-audit applies the decision', async () => {
    const operator = await createTestOperator(handle.db);
    const { prospect } = await seedProspect(handle.db, operator, `http://www.edgeworks.test:${server.port}/`);
    await startCrawl(handle.db, operator, prospect.id);
    await drain();

    const before = await getAudit(handle.db, operator.workspaceId, prospect.id);
    expect(new Map(before!.findings.map((finding) => [finding.ruleId, finding])).get('conversion.phone_found')?.outcome).toBe('pass');

    const profile = await getBusinessProfile(handle.db, operator.workspaceId, prospect.id);
    const phone = profile!.profile.find((field) => field.field === 'phone')!.primary!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await reviewFact(handle.db, operator, { factId: phone.id, status: 'rejected' });

    expect((await getAudit(handle.db, operator.workspaceId, prospect.id))?.stale).toBe(true);
    expect(await startReAudit(handle.db, operator, prospect.id)).toEqual({ started: true });
    await drain();

    const after = await getAudit(handle.db, operator.workspaceId, prospect.id);
    expect(after!.run.id).not.toBe(before!.run.id);
    expect(after!.stale).toBe(false);
    expect(new Map(after!.findings.map((finding) => [finding.ruleId, finding])).get('conversion.phone_found')?.outcome).toBe('fail');
    expect(after!.run.overallScore!).toBeLessThan(before!.run.overallScore!);
  });
});

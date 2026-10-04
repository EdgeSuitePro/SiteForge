/**
 * DEV ONLY: populate the LOCAL embedded database with a completed crawl of the bundled fixture
 * sharpener site, so the UI can be explored without network access.
 *
 *   pnpm db:seed-demo
 *
 * The fixture site runs in-process on 127.0.0.1. Crawling it uses the TEST fetch policy inside this
 * script only — the application's production SSRF policy is unchanged and still refuses loopback.
 * Refuses to run against anything but a local PGlite database.
 */
import { and, eq } from 'drizzle-orm';

import { createSafeFetcher } from '../src/core/crawl/fetcher';
import { devUserIdForEmail } from '../src/server/auth/dev-identity';
import { openDatabase } from '../src/server/db/client';
import { workspaceMembers, workspaces } from '../src/server/db/schema';
import { parseServerEnv } from '../src/server/env';
import { startCrawl } from '../src/server/crawl/service';
import { runWorker } from '../src/server/jobs/runner';
import { startFixtureServer, testFetchPolicy } from '../tests/support/fixture-server';
import { seedProspect } from '../tests/support/operator';
import { sharpenerSite } from '../tests/support/sharpener-site';

async function main() {
  const env = parseServerEnv(process.env);
  if (env.database.kind !== 'pglite' || env.isDeployed || env.auth.mode !== 'dev') {
    throw new Error('db:seed-demo only runs against the local embedded database in dev auth mode.');
  }
  const handle = openDatabase(env.database);
  await handle.migrate();
  const db = handle.db;

  const email = env.auth.devOperatorEmail.toLowerCase();
  const userId = devUserIdForEmail(email);
  await db.insert(workspaces).values({ slug: 'local', name: 'EdgeSuite Pro (local)' }).onConflictDoNothing({ target: workspaces.slug });
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, 'local'));
  if (!workspace) throw new Error('workspace missing');
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, userId)));
  if (!member) await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, email, role: 'owner' });
  const operator = { userId, email, workspaceId: workspace.id, workspaceName: workspace.name, role: 'owner' as const };

  let port = 0;
  const site = sharpenerSite(() => port);
  const server = await startFixtureServer(site.routes, site.fallback);
  port = server.port;
  let virtual = 0;
  try {
    const { prospect } = await seedProspect(db, operator, `http://edgeworks.test:${port}/`);
    await startCrawl(db, operator, prospect.id);
    for (let i = 0; i < 10; i++) {
      const report = await runWorker(db, {
        budgetMs: 60_000,
        jobBudgetMs: 60_000,
        waitForDueWithinMs: 0,
        contextFactory: (database, budgetMs) => ({
          db: database,
          budgetMs,
          createFetcher: () => createSafeFetcher(testFetchPolicy),
          clock: { now: () => Date.now() + virtual, sleep: async (ms) => void (virtual += ms) },
        }),
      });
      if (!report.moreWork && report.executed === 0) break;
    }
    console.log(`Seeded demo prospect ${prospect.id} (fixture site crawled in-process).`);
  } finally {
    await server.close();
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

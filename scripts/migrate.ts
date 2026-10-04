/**
 * Apply committed migrations to the configured database.
 *
 *   pnpm db:migrate                  # local PGlite (.data/pglite) when DATABASE_URL is unset
 *   DATABASE_URL=... pnpm db:migrate # a SiteForge Postgres/Supabase project — explicit only
 *
 * The forbidden-database guard in src/server/env.ts applies here too.
 */
import { parseServerEnv } from '../src/server/env';
import { openDatabase } from '../src/server/db/client';

async function main() {
  const env = parseServerEnv(process.env);
  const target = env.database;
  const label = target.kind === 'pglite' ? `local PGlite at ${target.dataDir}` : `Postgres host ${new URL(target.url).hostname}`;
  console.log(`Applying migrations to ${label} ...`);
  const handle = openDatabase(target);
  try {
    await handle.migrate();
    console.log('Migrations applied.');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

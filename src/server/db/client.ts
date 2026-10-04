import 'server-only';

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { serverEnv, type DatabaseTarget } from '../env';
import { log } from '../log';
import * as schema from './schema';

/** Driver-agnostic Drizzle handle: identical query API on PGlite and Postgres/Supabase. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  kind: DatabaseTarget['kind'];
  /** Apply committed migrations from db/migrations. */
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'db', 'migrations');
export const MIGRATIONS_CONFIG = {
  migrationsFolder: MIGRATIONS_FOLDER,
  migrationsSchema: 'siteforge_meta',
  migrationsTable: '__drizzle_migrations',
} as const;

/**
 * Open a database handle for a target. `dataDir: 'memory://'` gives an in-memory PGlite (tests).
 * Exported for scripts and tests; application code should use `getDb()`.
 */
export function openDatabase(target: DatabaseTarget): DatabaseHandle {
  if (target.kind === 'pglite') {
    if (!target.dataDir.startsWith('memory://')) mkdirSync(target.dataDir, { recursive: true });
    const client = new PGlite(target.dataDir);
    const db = drizzlePglite(client, { schema }) as unknown as Database;
    return {
      db,
      kind: 'pglite',
      migrate: () => migratePglite(drizzlePglite(client, { schema }), MIGRATIONS_CONFIG),
      close: () => client.close(),
    };
  }

  // Supabase-compatible settings: `prepare: false` works with the transaction-mode pooler.
  const client = postgres(target.url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
  const pgDb = drizzlePostgres(client, { schema });
  return {
    db: pgDb as unknown as Database,
    kind: 'postgres',
    migrate: () => migratePostgres(pgDb, MIGRATIONS_CONFIG),
    close: () => client.end({ timeout: 5 }),
  };
}

const globalForDb = globalThis as unknown as { __siteforgeDb?: Promise<DatabaseHandle> };

async function initDefault(): Promise<DatabaseHandle> {
  const env = serverEnv();
  const handle = openDatabase(env.database);
  if (handle.kind === 'pglite') {
    // Local embedded database: keep the schema current automatically. Remote databases are
    // only ever migrated by the explicit `pnpm db:migrate` command.
    await handle.migrate();
    log.info('db.local.ready', { dataDir: env.database.kind === 'pglite' ? env.database.dataDir : undefined });
  }
  return handle;
}

/** Process-wide database handle (cached across Next.js dev hot reloads). */
export async function getDb(): Promise<Database> {
  globalForDb.__siteforgeDb ??= initDefault().catch((error: unknown) => {
    globalForDb.__siteforgeDb = undefined;
    throw error;
  });
  return (await globalForDb.__siteforgeDb).db;
}

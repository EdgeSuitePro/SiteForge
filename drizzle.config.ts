import { defineConfig } from 'drizzle-kit';

/**
 * `pnpm db:generate` diffs src/server/db/schema.ts against the committed migration snapshots
 * and writes a new SQL migration to db/migrations. It never connects to a database.
 * Applying migrations is a separate, explicit step: `pnpm db:migrate`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './db/migrations',
  schemaFilter: ['siteforge'],
  migrations: {
    schema: 'siteforge_meta',
    table: '__drizzle_migrations',
  },
  strict: true,
  verbose: true,
});

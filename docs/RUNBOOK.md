# SiteForge runbook

## Local

```bash
pnpm install && pnpm dev
```

The embedded database lives in `.data/pglite` and is migrated automatically on first use.
`pnpm db:reset-local` deletes it.

## Connecting the SiteForge Supabase project (when it exists)

1. Create a **dedicated** Supabase project for SiteForge (never reuse a Chef KnifeWorks project).
2. Add the Chef KnifeWorks project ref to `SITEFORGE_FORBIDDEN_DB_HOSTS` as an extra guard.
3. Set `DATABASE_URL` to the project's Postgres connection string.
4. Run `pnpm db:migrate` explicitly. Migrations are never applied automatically to remote databases.

## Vercel (not deployed yet)

Planned project: `siteforge` on the EdgeSuite Pro Pro team, operator app at `siteforge.edgesuitepro.com`,
previews at `*.preview.edgesuitepro.com`. No DNS changes are made without explicit approval; exact
records will be prepared in the preview-domain phase. Required variables on Vercel: `DATABASE_URL`,
`SITEFORGE_AUTH_MODE=supabase`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SESSION_SECRET`, `JOB_SECRET`,
`CRON_SECRET` (the app refuses to start without them).

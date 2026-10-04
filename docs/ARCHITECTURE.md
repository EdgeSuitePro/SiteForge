# SiteForge architecture

SiteForge is a standalone EdgeSuite Pro application. It does not share a database, code, auth, or
deployment with Chef KnifeWorks (the first ESP tenant), which serves only as reference material.

## Stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict, `noUncheckedIndexedAccess`) |
| App | Next.js App Router on Vercel, Node runtime only |
| Validation | Zod (inputs, env, AI outputs, concept documents, ESP contract) |
| Database | PostgreSQL — embedded PGlite locally/tests, dedicated Supabase project in dev/prod |
| Data access | Drizzle ORM, SQL migrations in `db/migrations` |
| Auth | Local dev login now; Supabase Auth once the SiteForge Supabase project exists |
| Parsing / fetching | cheerio, undici with connect-time IP validation, robots-parser (Phase 1) |
| AI | Provider abstraction; Anthropic default, mock provider without credentials (Phase 4) |
| Tests | Vitest (+ PGlite), local fixture HTTP server, Playwright smoke tests |

## Pipeline

```
Add prospect → Analyze
  → crawl (jobs: crawl_tick …)           Phase 1
  → extract facts (deterministic)        Phase 2
  → deterministic audit + scoring        Phase 3
  → AI extraction + semantic audit       Phase 4
  → concepts: strategy JSON → claim check → deterministic renderers → private previews   Phase 5
```

Each stage is a row in the `jobs` table. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, run within
a time budget, persist progress, and enqueue the next stage. Work is kicked off with `after()` and a
Vercel Cron sweep recovers anything stalled, so crawls are restartable and never block a UI request.

## Database portability

The schema must work unchanged on PGlite and Supabase:

- all tables in the `siteforge` schema (not exposed by Supabase's REST API);
- migration bookkeeping in `siteforge_meta`;
- RLS enabled on every table with no policies — only the server's direct connection has access;
- text + CHECK constraints instead of enums; `gen_random_uuid()` defaults; `timestamptz`; `jsonb`;
- user ids are plain `uuid` (Supabase `auth.users.id`) with no cross-schema foreign key;
- `updated_at` maintained by the application, not triggers.

Moving to Supabase is: create the project → set `DATABASE_URL` → `pnpm db:migrate`.

## Provenance and versioning

Every derived artefact records what produced it: crawl run, page, extractor version, ruleset version,
prompt id@version, model, and renderer version. Scoring rules and prompts are versioned code.

## Planned additions (by phase)

- Phase 1: `crawl_runs`, `crawl_pages`, `jobs` tables; crawler; progress UI.
- Phase 2: `business_facts`.
- Phase 3: `audit_runs`, `audit_findings`.
- Phase 4: `model_runs`.
- Phase 5: `concepts`, `share_links`; preview host (`*.preview.edgesuitepro.com`).
- Later: `esp_handoffs` (see ESP_INTEGRATION.md).

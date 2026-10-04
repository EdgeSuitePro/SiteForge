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

## Crawler and jobs (Phase 1 — implemented)

```
Analyze (server action) ──insert crawl_run + job──► jobs table
        │ after()
        ▼
  runWorker (≤240s) ── claim (SKIP LOCKED, lease) ──► crawl handler ──► runCrawlTick (≤50s)
        │                                                              │ state in crawl_runs/crawl_pages
        │ work due soon? ── POST /api/jobs/run (JOB_SECRET) ──► fresh invocation
        ▼
  Vercel Cron /api/jobs/sweep (every minute) ── resumes expired leases / missed hand-offs
  Progress poll /api/prospects/:id/progress ── also kicks a worker if work is due (local dev safety net)
```

- **Engine** (`src/core/crawl/engine.ts`): framework-free; talks to a `CrawlStore` interface. Each tick
  resumes from the database, so a killed invocation loses at most the page in flight (which is re-queued,
  then failed after 2 interrupted attempts).
- **First tick**: robots.txt → homepage (follows redirects and locks the canonical origin; www/apex and
  http/https variants are unified) → robots.txt of the final origin → sitemap discovery.
- **Ordering**: navigation + sharpening-business keywords (services, pricing, about, contact, FAQ, hours,
  mail-in, drop-off, booking…) first; blog archives and pagination last.
- **Limits** (`crawl_runs.limits`, versioned with `crawler@1`): 25 pages (max 60), depth 4, 2 MB HTML,
  10 s/request, 6 min total, ≥1 s between requests (or robots `Crawl-delay`, max 10 s), 500 queued
  URLs, 3 URLs per path pattern (calendar/pagination traps), 5 redirects.
- **Storage**: page metadata in `crawl_pages`; gzipped raw HTML in `crawl_page_bodies` so Phase 2
  extractors can be re-run without re-crawling.
- **Outcomes recorded per page**: crawled, error (HTTP status — later used for broken-link findings),
  skipped with a reason (robots, not HTML, off-site redirect, duplicate redirect, limits).

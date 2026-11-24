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
  → AI fact extraction (fast tier)       Phase 4   job: ai_extract
  → deterministic audit + scoring        Phase 3   job: audit
  → AI semantic review (strong tier)     Phase 4   job: semantic_audit (rescoring, capped)
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
- Phase 5: `concepts` (implemented). `share_links` and the separate preview host are deferred until prospect-facing sharing (see below).
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

## Business facts (Phase 2 — implemented)

```
crawl completed ──► extract job ──► parse stored HTML (extract@1)
                                   ├─► deterministic fact extractors (facts@1, sharpening-taxonomy@1)
                                   ├─► brand analysis (brand@1; ≤6 stylesheets via the SSRF-safe fetcher)
                                   └─► extraction_runs / page_extractions / business_facts
```

- **Facts only from the site.** Every fact stores its method (`structured_data`, `markup`, `text_pattern`),
  confidence, occurrence counts, prominence (homepage/header) and up to 5 evidence items
  (page URL, verbatim snippet, locator). Missing information is shown as **Not found** — never inferred.
- **Extractors** (`src/core/facts/extractors`): identity (name, logo), contact (phone, email, socials,
  booking providers, contact methods), location (address, city/state, service-area statements, hours),
  offering (services via the taxonomy, prices, turnaround), trust (reviews, FAQ, owner, years claims,
  schema.org types).
- **Negation**: "we do not sharpen serrated knives" becomes `service_not_offered`; sites that both claim
  and disclaim a service are flagged as conflicts.
- **Guards against invented claims**: navigation-only mentions are ignored; customer quotes are low
  confidence; turnaround phrases need independent supporting context; order numbers/dates are not phones;
  share links and site-builder profiles are not the business's social accounts.
- **Operator review**: verify / reject / undo per fact; decisions carry forward to later extraction runs
  for the same fact. Rejected facts leave the profile.
- **Re-extraction** re-reads stored HTML without re-crawling (e.g. after an extractor version bump).
- `page_extractions` stores each page's parsed structure (headings, meta, links, images, forms, JSON-LD,
  text blocks) as the input for Phase 3 audit rules.

## AI analysis (Phase 4 — implemented)

- **Provider abstraction** (`src/core/ai/types.ts`): `AiProvider.generateStructured()` with a Zod schema.
  `AnthropicProvider` uses the official SDK (`beta.messages.parse` + `betaZodOutputFormat`, cached
  system prompt, typed error mapping). `MockProvider` makes no calls and is labelled as mock everywhere.
  The provider is chosen by `SITEFORGE_AI_PROVIDER` (auto → Anthropic only when a key is configured).
- **Model router** (`src/core/ai/router.ts`): tasks map to tiers — fast `claude-haiku-5-5` (fact
  extraction), strong `claude-sonnet-5-5` (semantic audit), premium `claude-opus-5-5` (reserved for
  concepts). Each tier can be overridden by env. Strong/premium requests opt into server-side model
  fallback.
- **Pipeline**: `extract → ai_extract → audit → semantic_audit`. AI stages never block the pipeline:
  on refusal, invalid output, budget exhaustion or provider outage they record `failed`/`skipped` and
  the deterministic results stand. Transient errors are retried by the job queue.
- **Grounding**: every AI fact or rubric answer must cite a quote that is found verbatim in the stored
  page text (`src/core/ai/citations.ts`); unverified quotes are discarded and counted. Ratings are
  turned into points in code, and semantic points are capped at 40% of each category
  (`src/core/ai/semantic.ts`). AI facts carry method `ai_extracted` and never override
  deterministic facts.
- **Accounting**: every call (including failures and budget skips) is a `model_runs` row: task, tier,
  requested/served model, prompt id@version, input hash, tokens, estimated cost (`prices@…`), latency.
  A per-prospect rolling-24h budget is enforced before any non-mock call.

## Concepts and previews (Phase 5 — implemented)

```
facts (non-rejected; low-confidence only if verified) ──► frozen fact catalog (refs f1…fn)
audit problems ─────────────────────────────────────────► concept brief (strategy, CTAs available, focus)
            strong-tier model (concept-gen@1) or mock/fallback fact-only draft
                                 │  concept document: copy + fact refs + CTA intents (never HTML)
                                 ▼
            normalize (clamp lengths) ──► claim check (claim-check@1) ──► design tokens (WCAG AA)
                                 ▼
            deterministic renderer (render@1): local_growth | craftsman | fastest_path
```

- **Three strategies** (`src/core/concepts/strategies.ts`) with their own required/excluded sections and
  three genuinely different renderers (`src/core/render/templates/*`): information order, layout,
  typography and calls to action all differ; brand colour is shared.
- **Facts are inserted by the renderer**, not typed by the model: service names, prices, phone, email,
  address, hours, service areas. The model writes copy and references facts by `ref`.
- **Claim checker** (`src/core/concepts/claims.ts`): prices, numbers, years, experience, turnaround,
  guarantees, credentials/awards, superlatives, ratings/counts, testimonials/quotations, place names,
  services (including ones the site says it does *not* offer), contact details, and 10-word verbatim
  copies of the current site. An unsupported sentence becomes a visible operator note; metadata falls
  back to safe defaults. Invalid fact refs, unavailable CTAs and excluded sections are repaired. Every
  change is recorded in the concept's `claim_report`.
- **Missing information** is written as `{{missing: …}}` by the copywriter and rendered as an operator
  note ("✎ Missing: real customer reviews"), never as business information.
- **AI failure never blocks the demo**: a non-transient model failure (refusal, invalid output, budget,
  outage) falls back to the deterministic fact-only draft, labelled as such.
- **Storage** (`concepts`): checked content, raw model output, claim report, frozen fact catalog, design
  tokens, schema/renderer/claim-check/prompt versions, model run, render hash. HTML is not stored;
  rendering is reproducible. Each "Generate" creates a new generation; earlier ones are kept.
- **Delivery** (V1, operator-only): `/preview/concept/[id]` requires an operator session in the same
  workspace. `?mode=clean` hides operator notes. Compare view (`/prospects/[id]/compare`) shows the
  previews in sandboxed iframes (desktop/mobile, all three side by side on mobile). Presentation
  (`/prospects/[id]/present`) shows score, findings with evidence, before/after, concepts and
  opportunities, with a "your website has not been modified" banner.
- **"Book" CTAs** without an existing booking system point at an EdgeSuite Pro reservation block —
  the integration point for ESP, clearly marked as not active in the preview.
- **Deferred:** prospect-facing share links (hashed tokens, expiry, revocation, view log) and serving
  previews from a separate origin (`*.preview.edgesuitepro.com` or a second Vercel domain). The preview
  route is host-agnostic, so this is routing + a token table, not a redesign. Logo use (off by default)
  and multi-page concepts are also deferred.

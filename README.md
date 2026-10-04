# EdgeSuite Pro SiteForge

SiteForge is EdgeSuite Pro's prospecting and website-improvement system for professional sharpeners.

Enter the public website of a sharpening business and SiteForge:

1. crawls the site responsibly (robots.txt, rate limits, SSRF-safe),
2. extracts verifiable business facts with source evidence,
3. audits visibility, clarity, trust, conversion, customer experience and local relevance,
4. scores the site transparently (the *ESP Website Opportunity Score* — not an industry SEO score),
5. generates three strategically different website concepts as private, noindex working previews.

> "Don't tell a sharpener their website could be better. Show them."

SiteForge never invents services, prices, testimonials, credentials or other facts, and it never
modifies the prospect's existing website.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold: Next.js + TypeScript, Drizzle + PGlite, migrations, dev login, CI | ✅ |
| 1 | Hardened crawler, background jobs, prospects + crawl progress UI | ✅ |
| 2–6 | Facts, deterministic audit, AI analysis, concepts + previews, acceptance | planned |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local development

Requirements: Node 22+, pnpm 10.

```bash
pnpm install
pnpm dev            # http://localhost:3000 — embedded database, one-click dev login
```

No external services are needed. With no environment variables set, SiteForge uses an embedded
PGlite database in `.data/pglite` (created and migrated automatically) and a local-only login.

```bash
pnpm check          # typecheck + lint + tests + production build
pnpm test           # unit + database tests (in-memory PGlite)
pnpm db:generate    # after editing src/server/db/schema.ts — writes a SQL migration
pnpm db:migrate     # apply migrations to the configured database (explicit, never automatic remotely)
pnpm db:reset-local # delete the local embedded database
pnpm db:seed-demo   # crawl the bundled fixture sharpener site into the LOCAL database (no network needed)
```

Configuration is documented in [.env.example](.env.example).

## Safety rails (enforced in code)

- The dev login and embedded database are refused on any Vercel deployment.
- `DATABASE_URL` is refused if it matches a known non-SiteForge database (see `SITEFORGE_FORBIDDEN_DB_HOSTS`).
- Remote databases are only migrated by the explicit `pnpm db:migrate` command.
- The whole app is `noindex`; crawled content is never rendered as HTML in the operator UI.

## Repository layout

```
app/                 Next.js routes (operator UI, API routes, later: previews)
proxy.ts             session gate + per-request CSP nonce
src/core/            framework-free domain logic (crawler, extraction, audit, renderers) — unit tested
src/server/          env, logging, database, auth, repositories, jobs
db/migrations/       committed SQL migrations (PostgreSQL / Supabase compatible)
tests/               database tests, fixtures, test support
docs/                architecture, security, ESP integration, runbook
```

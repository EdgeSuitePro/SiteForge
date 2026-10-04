# SiteForge security model

## Principles

1. **Crawled websites are untrusted input.** Their text is data, never instructions — for the operator
   UI, for renderers, and for AI models.
2. **Nothing SiteForge generates is published.** Previews are private, unlisted, and `noindex`.
3. **SiteForge never touches non-SiteForge systems.** Its own database, its own auth, its own deployment.

## Implemented (Phase 0)

- Zod-validated environment with hard refusals: no embedded DB or dev login on Vercel; required secrets
  on Vercel; a forbidden-database list checked against `DATABASE_URL` host and pooler username.
- Operator session gate in `proxy.ts`; workspace membership re-checked server-side.
- Signed (HMAC-SHA256), httpOnly, SameSite=Lax session cookie with 12h expiry; constant-time comparison.
- Per-request nonce CSP (`strict-dynamic`), `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, HSTS, restrictive `Permissions-Policy`, and `X-Robots-Tag: noindex`.
- `robots.txt` disallows everything.
- Lint bans `dangerouslySetInnerHTML` in the operator UI.
- Structured logs redact keys that look like secrets, tokens, cookies, or API keys.
- Database: RLS enabled with no policies on every table.

## Phase 1 (crawler)

See the crawler section once implemented: scheme/port allowlist, private/reserved IP blocking for IPv4
and IPv6 (including IPv4-mapped), connect-time IP validation (DNS rebinding), manual per-hop redirect
validation, response size caps enforced while streaming, timeouts, content-type allowlist,
crawl-trap detection, robots.txt compliance.

## Later phases

- AI: crawl content isolated in a delimited untrusted-data block; no tools; schema-constrained output;
  citations verified against stored page text.
- Previews: separate origin, strict CSP with no scripts, sandboxed iframes, hashed share tokens.

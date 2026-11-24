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

## Phase 1 (crawler) — implemented

- **Operator input**: http/https only; ports 80/443; no embedded credentials; no IP literals in private,
  loopback, link-local, CGNAT, documentation, multicast or reserved ranges (decimal/hex/octal IPv4 forms
  are normalized first); no `localhost`/`.local`/`.internal`-style names; length-capped.
- **Every redirect hop** is re-validated; redirects are followed manually, never by the HTTP client.
- **Connect-time DNS validation**: the socket's own `lookup` resolves the host and refuses to connect if
  *any* address is non-public (IPv4 and IPv6, incl. IPv4-mapped, NAT64, 6to4, Teredo, ULA). The address
  validated is the address connected to, which defeats DNS rebinding.
- **Bounded responses**: decompressed-byte caps enforced while streaming (gzip/brotli bombs), declared
  length checks, header/body/overall timeouts, content-type allowlist, unknown encodings rejected.
- **Crawl traps**: query strings dropped (except page-identity params), per-path-pattern caps, depth,
  queue size, URL length, total page and time limits; admin/cart/account/search paths never fetched.
- **robots.txt** obeyed (our token `EdgeSuiteProSiteForge`, then `*`); 5xx treated as disallow-all;
  unreachable sites reported as unreachable. `<meta name="robots" content="nofollow">` is honoured.
- **Hostile HTML**: a `<base href>` pointing at another host is ignored for link resolution; crawled text is
  never rendered as HTML (React escaping only; `dangerouslySetInnerHTML` banned by lint).
- **Worker self-invocation** uses only the configured base URL (`APP_BASE_URL`/`VERCEL_URL`), never the
  request `Host` header, so `JOB_SECRET` cannot be sent to a spoofed host. Job and cron endpoints use
  constant-time bearer-secret checks.
- No outbound proxy support by design: a proxy would resolve DNS itself and bypass connect-time validation.

## Phase 4 (AI) — implemented

- Crawled text reaches the model only inside an `<untrusted_website_content>` JSON envelope; the
  delimiter is neutralised inside the data and invisible/control characters are stripped. The system
  prompt states that the content is data and that instructions in it must be ignored and reported.
- The model is given **no tools** and must answer in a fixed JSON schema, re-validated server-side.
- Nothing the model says is trusted on its own: quotes are verified verbatim against stored page text,
  prices must appear in their quote, owner names must appear in theirs, uncited positive answers are
  discarded, and opportunities need a verified quote and stay "requires owner confirmation".
- If the model reports instructions in the content, the audit shows a notice; the content is never acted on.
- API keys come only from the environment (never committed); `SITEFORGE_AI_PROVIDER=anthropic` without a
  key fails at startup. Logs never include prompts or page content.
- Cost control: per-prospect rolling-24h budget (`SITEFORGE_AI_BUDGET_USD`), capped input size, and
  every call recorded in `model_runs`.

## Later phases

- Previews: separate origin, strict CSP with no scripts, sandboxed iframes, hashed share tokens.

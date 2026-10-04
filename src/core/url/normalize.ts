import { checkUrlShape, type UrlCheck } from './safety';

/**
 * Query parameters that identify distinct pages on common small-business platforms and are
 * therefore kept. Every other query parameter is dropped to avoid crawl traps (sorting, filters,
 * session ids, tracking parameters, calendars).
 */
export const PAGE_IDENTITY_QUERY_PARAMS = ['page_id', 'p'] as const;

/** Lower-cased host without a leading `www.` — the unit of "same business site". */
export function normalizeDomain(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

/**
 * Canonical form used for de-duplication: no fragment, lower-case host, no default port,
 * only page-identity query params (sorted), collapsed slashes, no trailing slash except root.
 */
export function canonicalizeUrl(input: URL | string): URL {
  const url = new URL(typeof input === 'string' ? input : input.href);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }
  const kept = new URLSearchParams();
  for (const key of PAGE_IDENTITY_QUERY_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') kept.set(key, value);
  }
  url.search = kept.toString();
  let path = url.pathname.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  url.pathname = path || '/';
  return url;
}

export type OperatorUrlResult =
  | { ok: true; url: URL; domain: string }
  | { ok: false; message: string };

/** Parse a website URL typed by an operator ("example.com", "https://www.example.com/about"). */
export function parseOperatorUrl(raw: string): OperatorUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: 'Enter a website URL.' };
  if (/\s/.test(trimmed)) return { ok: false, message: 'Website URLs cannot contain spaces.' };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, message: 'That does not look like a website address.' };
  }
  const check: UrlCheck = checkUrlShape(url);
  if (!check.ok) return { ok: false, message: check.message };
  const canonical = canonicalizeUrl(url);
  return { ok: true, url: canonical, domain: normalizeDomain(canonical.hostname) };
}

/** Same business site: identical normalized domain (www and apex are the same site). */
export function isSameSite(url: URL, rootDomain: string, includeSubdomains = false): boolean {
  const domain = normalizeDomain(url.hostname);
  return domain === rootDomain || (includeSubdomains && domain.endsWith(`.${rootDomain}`));
}

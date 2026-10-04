import robotsParser from 'robots-parser';

import { ROBOTS_USER_AGENT_TOKEN, type FetchOutcome, type SafeFetcher } from './fetcher';

/**
 * robots.txt policy (follows the conventions of RFC 9309 and major search engines):
 *  - 2xx            → parse and obey.
 *  - 4xx            → no restrictions ("no robots.txt").
 *  - 5xx / network  → treat the whole site as disallowed; the crawl reports it instead of guessing.
 *  - Crawl-delay    → honoured, clamped to [MIN_DELAY_MS, MAX_DELAY_MS].
 */

export const ROBOTS_MAX_BYTES = 500 * 1024;
export const MIN_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 10_000;

export type RobotsStatus = 'parsed' | 'not_found' | 'unavailable';

export interface RobotsPolicy {
  status: RobotsStatus;
  /** Origin the policy applies to, e.g. https://www.example.com */
  origin: string;
  isAllowed(url: URL): boolean;
  delayMs: number;
  sitemaps: string[];
  /** Raw robots.txt text (capped) for the crawl record. */
  raw: string | null;
  detail: string;
  /** For `unavailable`: did the server answer with an error, or was the site unreachable? */
  failure?: 'server_error' | 'unreachable';
}

export function robotsPolicyFromText(origin: string, text: string, status: RobotsStatus = 'parsed'): RobotsPolicy {
  const robotsUrl = `${origin}/robots.txt`;
  const robots = robotsParser(robotsUrl, text);
  const crawlDelaySec = robots.getCrawlDelay(ROBOTS_USER_AGENT_TOKEN);
  const delayMs =
    typeof crawlDelaySec === 'number' && Number.isFinite(crawlDelaySec)
      ? Math.min(Math.max(crawlDelaySec * 1000, MIN_DELAY_MS), MAX_DELAY_MS)
      : MIN_DELAY_MS;
  return {
    status,
    origin,
    // robots-parser returns undefined for URLs outside the origin: treat as not allowed.
    isAllowed: (url) => robots.isAllowed(url.href, ROBOTS_USER_AGENT_TOKEN) === true,
    delayMs,
    sitemaps: robots
      .getSitemaps()
      .filter((entry) => /^https?:\/\//i.test(entry))
      .slice(0, 10),
    raw: text,
    detail: 'robots.txt found and applied.',
  };
}

export function robotsPolicyFromOutcome(origin: string, outcome: FetchOutcome): RobotsPolicy {
  if (outcome.kind === 'ok') {
    return robotsPolicyFromText(origin, outcome.body.toString('utf8'));
  }
  if (outcome.kind === 'http_error' && outcome.status >= 400 && outcome.status < 500) {
    return {
      ...robotsPolicyFromText(origin, '', 'not_found'),
      raw: null,
      detail: `No robots.txt (HTTP ${outcome.status}); no restrictions apply.`,
    };
  }
  if (outcome.kind === 'unsupported_type') {
    // e.g. an HTML "not found" page served with 200 — no usable rules.
    return { ...robotsPolicyFromText(origin, '', 'not_found'), raw: null, detail: 'robots.txt is not plain text; treated as absent.' };
  }
  const reason =
    outcome.kind === 'http_error' ? `HTTP ${outcome.status}` : outcome.kind.replace(/_/g, ' ');
  return {
    status: 'unavailable',
    origin,
    isAllowed: () => false,
    delayMs: MAX_DELAY_MS,
    sitemaps: [],
    raw: null,
    detail: `robots.txt could not be retrieved (${reason}); the site is treated as disallowed.`,
    failure: outcome.kind === 'http_error' ? 'server_error' : 'unreachable',
  };
}

export async function fetchRobotsPolicy(fetcher: SafeFetcher, origin: string, signal?: AbortSignal): Promise<RobotsPolicy> {
  const outcome = await fetcher.fetch(`${origin}/robots.txt`, {
    maxBytes: ROBOTS_MAX_BYTES,
    onOversize: 'truncate',
    timeoutMs: 10_000,
    maxRedirects: 5,
    acceptTypes: ['text/plain'],
    ...(signal ? { signal } : {}),
  });
  return robotsPolicyFromOutcome(origin, outcome);
}

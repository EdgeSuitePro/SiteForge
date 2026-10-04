import { describe, expect, it } from 'vitest';

import { MAX_DELAY_MS, MIN_DELAY_MS, robotsPolicyFromOutcome, robotsPolicyFromText } from './robots';

const origin = 'https://www.example.com';
const base = { requestedUrl: `${origin}/robots.txt`, finalUrl: `${origin}/robots.txt`, redirects: [] };

describe('robots policy', () => {
  it('applies rules for our user-agent group over the wildcard group', () => {
    const policy = robotsPolicyFromText(
      origin,
      [
        'User-agent: *',
        'Disallow: /',
        '',
        'User-agent: EdgeSuiteProSiteForge',
        'Disallow: /private',
        'Crawl-delay: 3',
        'Sitemap: https://www.example.com/sitemap.xml',
      ].join('\n'),
    );
    expect(policy.isAllowed(new URL(`${origin}/services`))).toBe(true);
    expect(policy.isAllowed(new URL(`${origin}/private/x`))).toBe(false);
    expect(policy.delayMs).toBe(3_000);
    expect(policy.sitemaps).toEqual(['https://www.example.com/sitemap.xml']);
  });

  it('obeys a wildcard disallow-all', () => {
    const policy = robotsPolicyFromText(origin, 'User-agent: *\nDisallow: /');
    expect(policy.isAllowed(new URL(`${origin}/`))).toBe(false);
  });

  it('clamps crawl-delay', () => {
    expect(robotsPolicyFromText(origin, 'User-agent: *\nCrawl-delay: 0').delayMs).toBe(MIN_DELAY_MS);
    expect(robotsPolicyFromText(origin, 'User-agent: *\nCrawl-delay: 3600').delayMs).toBe(MAX_DELAY_MS);
  });

  it('never allows URLs on another origin', () => {
    expect(robotsPolicyFromText(origin, '').isAllowed(new URL('https://other.example.com/'))).toBe(false);
  });

  it('treats 4xx as no restrictions', () => {
    const policy = robotsPolicyFromOutcome(origin, { ...base, kind: 'http_error', status: 404, headers: {} });
    expect(policy.status).toBe('not_found');
    expect(policy.isAllowed(new URL(`${origin}/anything`))).toBe(true);
  });

  it('treats 5xx and network failures as disallow-all', () => {
    for (const outcome of [
      { ...base, kind: 'http_error' as const, status: 503, headers: {} },
      { ...base, kind: 'timeout' as const },
      { ...base, kind: 'network_error' as const, message: 'ECONNRESET' },
    ]) {
      const policy = robotsPolicyFromOutcome(origin, outcome);
      expect(policy.status).toBe('unavailable');
      expect(policy.isAllowed(new URL(`${origin}/`))).toBe(false);
      expect(policy.failure).toBe(outcome.kind === 'http_error' ? 'server_error' : 'unreachable');
    }
  });
});

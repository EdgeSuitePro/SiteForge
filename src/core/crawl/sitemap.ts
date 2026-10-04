/**
 * Minimal, bounded sitemap reading: extracts <loc> URLs from a sitemap or sitemap index.
 * Uses a regex over capped text (no XML entity expansion, no DTDs → no XXE).
 */

export const SITEMAP_MAX_BYTES = 2 * 1024 * 1024;

export interface ParsedSitemap {
  kind: 'urlset' | 'index' | 'unknown';
  locations: string[];
}

const decode = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();

export function parseSitemap(xml: string, limit: number): ParsedSitemap {
  const kind = /<sitemapindex[\s>]/i.test(xml) ? 'index' : /<urlset[\s>]/i.test(xml) ? 'urlset' : 'unknown';
  const locations: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/loc>/gi)) {
    const value = decode(match[1] ?? '');
    if (/^https?:\/\//i.test(value)) locations.push(value);
    if (locations.length >= limit) break;
  }
  return { kind, locations };
}

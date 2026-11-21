import type { SafeFetcher } from '../crawl/fetcher';

export const STYLESHEET_MAX_BYTES = 1_000_000;
export const MAX_STYLESHEETS = 6;

/** Framework/CDN sheets that say nothing about the business's brand. */
const SKIP = /bootstrap(\.min)?\.css|font-?awesome|fontawesome|jquery[-.]ui|animate(\.min)?\.css|normalize(\.min)?\.css|slick(-theme)?\.css|swiper|aos(\.min)?\.css|fonts\.googleapis\.com|use\.typekit\.net|wp-includes|wp-block-library|dashicons/i;

/**
 * Fetch up to MAX_STYLESHEETS stylesheets referenced by crawled pages, most-referenced first.
 * Uses the SSRF-hardened fetcher (CDN hosts are allowed; private addresses never are).
 */
export async function fetchStylesheets(fetcher: SafeFetcher, hrefs: string[], timeoutMs = 8_000): Promise<Array<{ href: string; css: string }>> {
  const counts = new Map<string, number>();
  for (const href of hrefs) if (!SKIP.test(href)) counts.set(href, (counts.get(href) ?? 0) + 1);
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([href]) => href).slice(0, MAX_STYLESHEETS);

  const sheets: Array<{ href: string; css: string }> = [];
  for (const href of ordered) {
    const outcome = await fetcher.fetch(href, {
      maxBytes: STYLESHEET_MAX_BYTES,
      onOversize: 'truncate',
      timeoutMs,
      maxRedirects: 3,
      acceptTypes: ['text/css', 'text/plain'],
    });
    if (outcome.kind === 'ok') sheets.push({ href, css: outcome.body.toString('utf8') });
  }
  return sheets;
}

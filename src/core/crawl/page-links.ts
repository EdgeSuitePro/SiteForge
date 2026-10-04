import { load } from 'cheerio';

/**
 * Minimal page parsing needed to drive the crawl (links, robots meta, canonical, basic stats).
 * Full business-fact extraction is a separate, versioned extractor (Phase 2) that re-reads the
 * stored HTML, so this stays small and fast.
 */

export const PAGE_PARSER_VERSION = 'page-links@1';

export interface DiscoveredLink {
  url: string;
  text: string;
  inNav: boolean;
}

export interface PageSummary {
  title: string | null;
  h1: string | null;
  lang: string | null;
  canonical: string | null;
  metaRobots: { noindex: boolean; nofollow: boolean };
  wordCount: number;
  likelyJsRendered: boolean;
  links: DiscoveredLink[];
}

const MAX_LINKS_PER_PAGE = 400;
const clean = (value: string | undefined | null) => (value ?? '').replace(/\s+/g, ' ').trim();

export function parsePage(html: string, pageUrl: URL): PageSummary {
  const $ = load(html);

  let base = pageUrl;
  const baseHref = $('base[href]').attr('href');
  if (baseHref) {
    try {
      const candidate = new URL(baseHref, pageUrl);
      // Only honour <base> on the same host; a hostile base must not redirect discovery.
      if (candidate.host === pageUrl.host) base = candidate;
    } catch {
      /* ignore malformed base */
    }
  }

  const robotsContent = $('meta[name="robots" i], meta[name="edgesuiteprositeforge" i]')
    .map((_, element) => ($(element).attr('content') ?? '').toLowerCase())
    .get()
    .join(',');

  let canonical: string | null = null;
  const canonicalHref = $('link[rel~="canonical" i]').first().attr('href');
  if (canonicalHref) {
    try {
      canonical = new URL(canonicalHref, base).href;
    } catch {
      canonical = null;
    }
  }

  const links: DiscoveredLink[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_, element) => {
    if (links.length >= MAX_LINKS_PER_PAGE) return false;
    const href = ($(element).attr('href') ?? '').trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|sms|javascript|data):/i.test(href)) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    url.hash = '';
    if (seen.has(url.href)) return;
    seen.add(url.href);
    links.push({
      url: url.href,
      text: clean($(element).text()).slice(0, 120),
      inNav: $(element).closest('nav, header, [role="navigation"]').length > 0,
    });
  });

  // Visible-ish text for statistics only (scripts/styles removed).
  const body = $('body').clone();
  body.find('script, style, noscript, template, svg').remove();
  const text = clean(body.text());
  const wordCount = text ? text.split(' ').length : 0;
  const scriptCount = $('script').length;
  const appShell = $('#root, #__next, #app, #__nuxt, [data-reactroot]').length > 0;

  return {
    title: clean($('title').first().text()).slice(0, 300) || null,
    h1: clean($('h1').first().text()).slice(0, 300) || null,
    lang: $('html').attr('lang')?.slice(0, 20) ?? null,
    canonical,
    metaRobots: { noindex: /\b(noindex|none)\b/.test(robotsContent), nofollow: /\b(nofollow|none)\b/.test(robotsContent) },
    wordCount,
    likelyJsRendered: wordCount < 60 && (appShell || scriptCount >= 3),
    links,
  };
}

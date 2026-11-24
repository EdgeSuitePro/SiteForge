import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/**
 * Parses one crawled HTML page into a structured, bounded `PageDocument` that every fact
 * extractor and (later) every audit rule reads from. Crawled HTML is untrusted: everything here
 * is size-capped, nothing is executed, and only visible text is kept as text blocks.
 *
 * Bump EXTRACTOR_VERSION whenever output changes; extraction runs record it for provenance.
 */
export const EXTRACTOR_VERSION = 'extract@1';

export type Region = 'header' | 'nav' | 'main' | 'footer' | 'aside' | 'body';

export interface TextBlock {
  /** Position in document order (stable within an extractor version). */
  index: number;
  tag: string;
  region: Region;
  text: string;
}

export type LinkKind = 'internal' | 'external' | 'tel' | 'mailto' | 'sms' | 'other';

export interface PageLink {
  href: string;
  text: string;
  kind: LinkKind;
  region: Region;
}

export interface PageImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  region: Region;
  logoScore: number;
}

export interface PageForm {
  action: string | null;
  method: string;
  fieldTypes: string[];
  fieldNames: string[];
  hasEmail: boolean;
  hasPhone: boolean;
  hasTextarea: boolean;
  region: Region;
}

export interface PageDocument {
  url: string;
  lang: string | null;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  viewport: string | null;
  robotsMeta: string | null;
  themeColor: string | null;
  og: { title: string | null; description: string | null; siteName: string | null; image: string | null };
  headings: Array<{ level: number; text: string; region: Region }>;
  blocks: TextBlock[];
  links: PageLink[];
  images: PageImage[];
  forms: PageForm[];
  iframes: Array<{ src: string; title: string | null }>;
  scriptHosts: string[];
  jsonLd: unknown[];
  jsonLdErrors: number;
  stylesheets: string[];
  inlineCss: string;
  googleFonts: string[];
  icons: string[];
  wordCount: number;
}

const LIMITS = {
  blocks: 600,
  blockChars: 2_000,
  links: 600,
  images: 250,
  forms: 20,
  iframes: 30,
  jsonLdItems: 20,
  jsonLdBytes: 200_000,
  inlineCss: 500_000,
  stylesheets: 15,
};

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol',
  'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'button', 'label',
  'caption', 'summary', 'details',
]);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'select', 'option', 'head', 'math']);
const REGION_TAGS: Record<string, Region> = { header: 'header', nav: 'nav', footer: 'footer', aside: 'aside', main: 'main' };
const REGION_ROLES: Record<string, Region> = { banner: 'header', navigation: 'nav', contentinfo: 'footer', complementary: 'aside', main: 'main' };
const FOOTER_HINT = /(^|[\s_-])(site[-_]?)?footer($|[\s_-])|SITE_FOOTER/i;
const HEADER_HINT = /(^|[\s_-])(site[-_]?)?header($|[\s_-])|SITE_HEADER|masthead/i;

export const clean = (value: string | null | undefined): string => (value ?? '').replace(/[\s \u200b-\u200d\ufeff]+/g, ' ').trim();
const cleanOrNull = (value: string | null | undefined): string | null => clean(value) || null;

function isHidden(element: Element): boolean {
  const attribs = element.attribs ?? {};
  if ('hidden' in attribs) return true;
  if ((attribs['aria-hidden'] ?? '').toLowerCase() === 'true') return true;
  const style = (attribs.style ?? '').replace(/\s+/g, '').toLowerCase();
  return style.includes('display:none') || style.includes('visibility:hidden');
}

function regionOf(element: Element, inherited: Region): Region {
  const byTag = REGION_TAGS[element.name];
  if (byTag) return byTag;
  const role = (element.attribs?.role ?? '').toLowerCase();
  if (REGION_ROLES[role]) return REGION_ROLES[role];
  const hint = `${element.attribs?.id ?? ''} ${element.attribs?.class ?? ''}`;
  if (FOOTER_HINT.test(hint)) return 'footer';
  if (inherited === 'body' && HEADER_HINT.test(hint)) return 'header';
  return inherited;
}

/** Walk the DOM collecting visible text into block-level chunks, in document order. */
function collectBlocks(root: AnyNode[]): { blocks: TextBlock[]; headings: PageDocument['headings'] } {
  const blocks: TextBlock[] = [];
  const headings: PageDocument['headings'] = [];
  const seen = new Set<string>();

  const flush = (buffer: string[], tag: string, region: Region) => {
    const text = clean(buffer.join(' ')).slice(0, LIMITS.blockChars);
    buffer.length = 0;
    if (!text || blocks.length >= LIMITS.blocks) return;
    if (/^h[1-6]$/.test(tag)) headings.push({ level: Number(tag[1]), text, region });
    const key = `${tag}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    blocks.push({ index: blocks.length, tag, region, text });
  };

  const walk = (nodes: AnyNode[], buffer: string[], blockTag: string, region: Region) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        buffer.push((node as unknown as { data: string }).data);
        continue;
      }
      if (node.type !== 'tag') continue;
      const element = node as Element;
      const name = element.name.toLowerCase();
      if (SKIP_TAGS.has(name) || isHidden(element)) continue;
      if (name === 'br') {
        buffer.push(' ');
        continue;
      }
      if (name === 'img') {
        continue;
      }
      const childRegion = regionOf(element, region);
      if (BLOCK_TAGS.has(name)) {
        flush(buffer, blockTag, region);
        const inner: string[] = [];
        walk(element.children as AnyNode[], inner, name, childRegion);
        flush(inner, name, childRegion);
      } else {
        walk(element.children as AnyNode[], buffer, blockTag, childRegion);
      }
    }
  };

  const top: string[] = [];
  walk(root, top, 'body', 'body');
  flush(top, 'body', 'body');
  return { blocks, headings };
}

function absolute(href: string | undefined, base: URL): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || /^(javascript|data|vbscript|blob):/i.test(trimmed)) return null;
  try {
    return new URL(trimmed, base).href;
  } catch {
    return null;
  }
}

const sameSite = (url: URL, page: URL) => url.hostname.replace(/^www\./, '') === page.hostname.replace(/^www\./, '');

function regionFor($: CheerioAPI, element: Element): Region {
  let region: Region = 'body';
  const ancestors = $(element).parents().toArray().reverse() as Element[];
  for (const ancestor of [...ancestors, element]) region = regionOf(ancestor, region);
  return region;
}

const numberAttr = (value: string | undefined) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function parseDocument(html: string, pageUrl: string): PageDocument {
  const url = new URL(pageUrl);
  const $ = load(html);
  const meta = (selector: string) => cleanOrNull($(selector).first().attr('content'));

  // JSON-LD (bounded, parse errors counted not thrown)
  const jsonLd: unknown[] = [];
  let jsonLdErrors = 0;
  $('script[type="application/ld+json" i]').each((_, element) => {
    if (jsonLd.length >= LIMITS.jsonLdItems) return false;
    const raw = $(element).text();
    if (raw.length > LIMITS.jsonLdBytes) {
      jsonLdErrors++;
      return;
    }
    try {
      jsonLd.push(JSON.parse(raw.replace(/^\s*<!--|-->\s*$/g, '')));
    } catch {
      jsonLdErrors++;
    }
  });

  const scriptHosts = new Set<string>();
  $('script[src]').each((_, element) => {
    const src = absolute($(element).attr('src'), url);
    if (src && scriptHosts.size < 50) scriptHosts.add(new URL(src).hostname.toLowerCase());
  });

  const body = $('body').length ? ($('body').get(0) as Element) : null;
  const { blocks, headings } = collectBlocks(body ? [body] : ($.root().children().toArray() as AnyNode[]));

  const links: PageLink[] = [];
  $('a[href]').each((_, element) => {
    if (links.length >= LIMITS.links) return false;
    const raw = ($(element).attr('href') ?? '').trim();
    const text = clean($(element).text()) || clean($(element).attr('aria-label')) || clean($(element).find('img').attr('alt'));
    const region = regionFor($, element as Element);
    if (/^tel:/i.test(raw)) links.push({ href: raw, text, kind: 'tel', region });
    else if (/^mailto:/i.test(raw)) links.push({ href: raw, text, kind: 'mailto', region });
    else if (/^sms:/i.test(raw)) links.push({ href: raw, text, kind: 'sms', region });
    else {
      const href = absolute(raw, url);
      if (!href) return;
      const parsed = new URL(href);
      const kind: LinkKind = !/^https?:$/.test(parsed.protocol) ? 'other' : sameSite(parsed, url) ? 'internal' : 'external';
      links.push({ href, text: text.slice(0, 200), kind, region });
    }
  });

  const images: PageImage[] = [];
  $('img').each((_, element) => {
    if (images.length >= LIMITS.images) return false;
    const $img = $(element);
    let src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src') || '';
    const srcset = $img.attr('srcset');
    if ((!src || src.startsWith('data:')) && srcset) src = srcset.split(',').at(-1)?.trim().split(/\s+/)[0] ?? '';
    const absoluteSrc = absolute(src, url);
    if (!absoluteSrc) return;
    const altAttr = $img.attr('alt');
    const hints = `${absoluteSrc} ${altAttr ?? ''} ${$img.attr('class') ?? ''} ${$img.attr('id') ?? ''}`.toLowerCase();
    const region = regionFor($, element as Element);
    images.push({
      src: absoluteSrc,
      alt: altAttr === undefined ? null : clean(altAttr),
      width: numberAttr($img.attr('width')),
      height: numberAttr($img.attr('height')),
      region,
      logoScore: (hints.includes('logo') ? 3 : 0) + (region === 'header' || region === 'nav' ? 2 : 0) + ($img.closest('a[href="/"], a[href="./"]').length ? 1 : 0),
    });
  });

  const forms: PageForm[] = [];
  $('form').each((_, element) => {
    if (forms.length >= LIMITS.forms) return false;
    const $form = $(element);
    const fields = $form.find('input, textarea, select').toArray() as Element[];
    const fieldTypes = fields.map((field) => (field.name === 'input' ? (field.attribs.type ?? 'text').toLowerCase() : field.name));
    const fieldNames = fields.map((field) => clean(field.attribs.name ?? field.attribs.id ?? '').slice(0, 60)).filter(Boolean);
    const joined = `${fieldTypes.join(' ')} ${fieldNames.join(' ')}`.toLowerCase();
    forms.push({
      action: absolute($form.attr('action'), url),
      method: ($form.attr('method') ?? 'get').toLowerCase(),
      fieldTypes: fieldTypes.filter((type) => type !== 'hidden'),
      fieldNames: fieldNames.slice(0, 30),
      hasEmail: /\bemail\b/.test(joined),
      hasPhone: /\b(tel|phone|mobile)\b/.test(joined),
      hasTextarea: fieldTypes.includes('textarea'),
      region: regionFor($, element as Element),
    });
  });

  const iframes: PageDocument['iframes'] = [];
  $('iframe').each((_, element) => {
    if (iframes.length >= LIMITS.iframes) return false;
    const src = absolute($(element).attr('src') ?? $(element).attr('data-src'), url);
    if (src) iframes.push({ src, title: cleanOrNull($(element).attr('title')) });
  });

  let inlineCss = '';
  $('style').each((_, element) => {
    inlineCss += `${$(element).text()}\n`;
    if (inlineCss.length > LIMITS.inlineCss) return false;
  });
  $('[style]').each((_, element) => {
    if (inlineCss.length > LIMITS.inlineCss) return false;
    inlineCss += `x{${$(element).attr('style')}}\n`;
  });

  const stylesheets: string[] = [];
  const googleFonts: string[] = [];
  $('link[href]').each((_, element) => {
    const rel = ($(element).attr('rel') ?? '').toLowerCase();
    const href = absolute($(element).attr('href'), url);
    if (!href) return;
    if (href.includes('fonts.googleapis.com')) {
      for (const match of href.matchAll(/family=([^&]+)/g)) {
        for (const family of decodeURIComponent(match[1] ?? '').split('|')) {
          const name = clean(family.split(':')[0]?.replace(/\+/g, ' '));
          if (name && !googleFonts.includes(name)) googleFonts.push(name);
        }
      }
    } else if (rel.split(/\s+/).includes('stylesheet') && stylesheets.length < LIMITS.stylesheets) {
      stylesheets.push(href);
    }
  });
  const icons = $('link[rel~="icon" i], link[rel~="apple-touch-icon" i]')
    .map((_, element) => absolute($(element).attr('href'), url))
    .get()
    .filter((value): value is string => Boolean(value))
    .slice(0, 5);

  return {
    url: url.href,
    lang: cleanOrNull($('html').attr('lang'))?.slice(0, 20) ?? null,
    title: cleanOrNull($('title').first().text())?.slice(0, 300) ?? null,
    metaDescription: meta('meta[name="description" i]')?.slice(0, 1000) ?? null,
    canonical: absolute($('link[rel~="canonical" i]').first().attr('href'), url),
    viewport: meta('meta[name="viewport" i]'),
    robotsMeta: meta('meta[name="robots" i]'),
    themeColor: meta('meta[name="theme-color" i]'),
    og: {
      title: meta('meta[property="og:title" i]'),
      description: meta('meta[property="og:description" i]'),
      siteName: meta('meta[property="og:site_name" i]'),
      image: absolute($('meta[property="og:image" i]').first().attr('content'), url),
    },
    headings: headings.slice(0, 200),
    blocks,
    links,
    images,
    forms,
    iframes,
    scriptHosts: [...scriptHosts],
    jsonLd,
    jsonLdErrors,
    stylesheets,
    inlineCss: inlineCss.slice(0, LIMITS.inlineCss),
    googleFonts: googleFonts.slice(0, 10),
    icons,
    wordCount: blocks.reduce((total, block) => total + block.text.split(' ').length, 0),
  };
}

/** Flatten JSON-LD (arrays, @graph) into typed nodes. */
export function jsonLdNodes(document: Pick<PageDocument, 'jsonLd'>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || out.length > 100 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const record = value as Record<string, unknown>;
    if (Array.isArray(record['@graph'])) visit(record['@graph'], depth + 1);
    if (record['@type']) out.push(record);
  };
  document.jsonLd.forEach((item) => visit(item, 0));
  return out;
}

export function jsonLdTypes(node: Record<string, unknown>): string[] {
  const type = node['@type'];
  return (Array.isArray(type) ? type : [type]).filter((value): value is string => typeof value === 'string');
}

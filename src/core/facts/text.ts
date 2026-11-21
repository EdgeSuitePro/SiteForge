import type { Region, TextBlock } from '../extract/document';
import type { Evidence, SourcePage } from './types';

export const SNIPPET_MAX = 300;

/** A snippet centred on [start, end) within text, cut at word boundaries. */
export function snippetAround(text: string, start: number, end: number, max = SNIPPET_MAX): string {
  if (text.length <= max) return text;
  const room = Math.max(0, max - (end - start));
  let from = Math.max(0, start - Math.floor(room / 2));
  let to = Math.min(text.length, from + max);
  from = Math.max(0, to - max);
  if (from > 0) from = text.indexOf(' ', from) + 1 || from;
  if (to < text.length) to = text.lastIndexOf(' ', to) > start ? text.lastIndexOf(' ', to) : to;
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

export function blockEvidence(page: SourcePage, block: TextBlock, start = 0, end = block.text.length): Evidence {
  return {
    pageUrl: page.url,
    pageId: page.pageId,
    snippet: snippetAround(block.text, start, end),
    locator: `text ${block.tag} (${block.region})`,
    region: block.region,
  };
}

export function markupEvidence(page: SourcePage, snippet: string, locator: string, region: Evidence['region']): Evidence {
  return { pageUrl: page.url, pageId: page.pageId, snippet: snippet.slice(0, SNIPPET_MAX), locator, region };
}

export function jsonLdEvidence(page: SourcePage, snippet: string, path: string): Evidence {
  return { pageUrl: page.url, pageId: page.pageId, snippet: snippet.slice(0, SNIPPET_MAX), locator: `json-ld ${path}`, region: 'json-ld' };
}

/**
 * Is the phrase at `index` negated within its own clause? ("we do not sharpen serrated knives").
 * Only strong negators are used; a bare "no" is ignored ("no appointment needed for drop-off").
 */
const NEGATOR = /\b(not|don'?t|do not|does not|doesn'?t|no longer|cannot|can'?t|won'?t|will not|unable to|never)\b/gi;
export function isNegated(text: string, index: number): boolean {
  const clauseStart = Math.max(
    text.lastIndexOf('.', index - 1),
    text.lastIndexOf(';', index - 1),
    text.lastIndexOf('!', index - 1),
    text.lastIndexOf('?', index - 1),
    text.lastIndexOf(',', index - 1),
    text.lastIndexOf(':', index - 1),
  );
  const window = text.slice(Math.max(clauseStart + 1, index - 60), index);
  NEGATOR.lastIndex = 0;
  return NEGATOR.test(window);
}

export const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' '),
);

export const isContentRegion = (region: Region) => region !== 'nav';

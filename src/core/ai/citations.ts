import type { Evidence } from '../facts/types';
import type { PackedPage } from './untrusted';

/**
 * Verification of model-supplied quotes against the page text the model was given.
 * A quote counts only if (after normalizing whitespace, case, quotes and dashes) it appears
 * verbatim in the cited page. Everything else is discarded — the model's word is not evidence.
 */

export const MIN_QUOTE_CHARS = 8;
export const MAX_QUOTE_CHARS = 400;

export const normalizeForMatch = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[…]/g, '...')
    .replace(/\s+/g, ' ')
    .trim();

export interface Citation {
  page: string;
  quote: string;
}

export function verifyCitation(citation: Citation, pages: PackedPage[]): Evidence | null {
  const page = pages.find((candidate) => candidate.ref === citation.page || candidate.pageId === citation.page);
  if (!page) return null;
  const quote = normalizeForMatch(citation.quote.replace(/^["“”']+|["“”']+$/g, ''));
  if (quote.length < MIN_QUOTE_CHARS || quote.length > MAX_QUOTE_CHARS) return null;
  const haystack = normalizeForMatch([page.title ?? '', page.metaDescription ?? '', ...page.headings.map((heading) => heading.replace(/^h\d: /, '')), page.text].join('\n'));
  if (!haystack.includes(quote)) return null;
  return {
    pageUrl: page.url,
    pageId: page.pageId,
    snippet: citation.quote.trim().slice(0, 300),
    locator: 'ai quote (verified)',
    region: 'body',
  };
}

export function verifyCitations(citations: Citation[], pages: PackedPage[]): { verified: Evidence[]; rejected: number } {
  const verified: Evidence[] = [];
  let rejected = 0;
  for (const citation of citations) {
    const evidence = verifyCitation(citation, pages);
    if (evidence && !verified.some((existing) => existing.pageId === evidence.pageId && existing.snippet === evidence.snippet)) verified.push(evidence);
    else if (!evidence) rejected++;
  }
  return { verified, rejected };
}

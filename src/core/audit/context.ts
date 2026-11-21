import type { PageDocument } from '../extract/document';
import type { ProfileFact } from '../facts/profile';
import type { Evidence, FactType } from '../facts/types';

export type StoredPageDocumentLike = Omit<PageDocument, 'inlineCss'>;

export interface AuditPage {
  pageId: string;
  url: string;
  depth: number;
  doc: StoredPageDocumentLike;
}

/** Every URL the crawler tried, including failures (for broken-link and crawl-error rules). */
export interface CrawlOutcome {
  pageId: string;
  url: string;
  state: 'queued' | 'fetching' | 'fetched' | 'skipped' | 'failed';
  httpStatus: number | null;
  skipReason: string | null;
  discoveredFrom: string | null;
  linkText: string | null;
  error: string | null;
}

export interface AuditInput {
  pages: AuditPage[];
  crawl: {
    canonicalOrigin: string | null;
    outcomes: CrawlOutcome[];
    sitemapUrlsFound: number;
    robotsSitemaps: number;
    likelyJsRendered: boolean;
    stopReason: string | null;
  };
  /** Facts from the extraction run; rejected facts are excluded by the context. */
  facts: ProfileFact[];
  prospect: { cityHint: string | null };
}

export interface AuditContext extends AuditInput {
  home: AuditPage | null;
  /** Non-rejected facts of a type, strongest first (order as stored). */
  factsOf: (type: FactType) => ProfileFact[];
  hasFact: (type: FactType, key?: string) => boolean;
  pageEvidence: (page: AuditPage, snippet: string, locator: string) => Evidence;
  /** Distinct city names known for the business (from facts or operator hint). */
  cities: string[];
}

export function buildAuditContext(input: AuditInput): AuditContext {
  const facts = input.facts.filter((fact) => fact.status !== 'rejected');
  const pages = [...input.pages].sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
  const home = pages.find((page) => page.depth === 0) ?? pages[0] ?? null;
  const cities = new Set<string>();
  for (const fact of facts) {
    if (fact.type === 'locality' && typeof fact.value.city === 'string') cities.add(fact.value.city);
    if (fact.type === 'address' && typeof fact.value.city === 'string') cities.add(fact.value.city);
  }
  if (input.prospect.cityHint) cities.add(input.prospect.cityHint.split(',')[0]!.trim());

  return {
    ...input,
    pages,
    facts,
    home,
    factsOf: (type) => facts.filter((fact) => fact.type === type),
    hasFact: (type, key) => facts.some((fact) => fact.type === type && (key === undefined || fact.key === key)),
    pageEvidence: (page, snippet, locator) => ({
      pageUrl: page.url,
      pageId: page.pageId,
      snippet: snippet.slice(0, 300),
      locator,
      region: 'head',
    }),
    cities: [...cities].filter(Boolean),
  };
}

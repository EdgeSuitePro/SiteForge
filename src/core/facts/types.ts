import type { PageDocument, Region } from '../extract/document';

/** Bump when fact extraction output changes. Stored on every extraction run. */
export const FACTS_VERSION = 'facts@1';

export const FACT_TYPES = [
  'business_name',
  'logo',
  'phone',
  'email',
  'social_profile',
  'contact_method',
  'booking_provider',
  'address',
  'locality',
  'service_area',
  'hours',
  'service',
  'service_not_offered',
  'price',
  'turnaround',
  'reviews',
  'faq',
  'owner_name',
  'years_claim',
  'structured_data',
] as const;
export type FactType = (typeof FACT_TYPES)[number];

/**
 * How a fact was found:
 *  - structured_data: the site's own schema.org JSON-LD
 *  - markup: unambiguous HTML (tel:/mailto: links, <address>, forms, embedded widgets)
 *  - text_pattern: a deterministic pattern in visible text (weaker; always shown with its snippet)
 * AI-assisted extraction (Phase 4) will add `ai_extracted`; operator edits add `operator`.
 */
export type FactMethod = 'structured_data' | 'markup' | 'text_pattern';
export type Confidence = 'high' | 'medium' | 'low';

export interface Evidence {
  pageUrl: string;
  pageId: string;
  /** Verbatim (whitespace-normalized) text or markup value the fact came from, ≤ 300 chars. */
  snippet: string;
  /** Where on the page, e.g. `link tel (header)`, `json-ld LocalBusiness.telephone`, `text p (main)`. */
  locator: string;
  region: Region | 'head' | 'json-ld';
}

export interface FactCandidate {
  type: FactType;
  /** Normalized identity used to merge the same fact found in several places. */
  key: string;
  value: Record<string, unknown>;
  display: string;
  method: FactMethod;
  confidence: Confidence;
  evidence: Evidence;
}

export interface Fact {
  type: FactType;
  key: string;
  value: Record<string, unknown>;
  display: string;
  method: FactMethod;
  confidence: Confidence;
  /** Number of places it was found. */
  occurrences: number;
  /** Distinct pages it was found on. */
  pageCount: number;
  onHomepage: boolean;
  inHeader: boolean;
  /** Up to MAX_EVIDENCE sources, strongest first. */
  evidence: Evidence[];
}

export interface SourcePage {
  pageId: string;
  url: string;
  depth: number;
  doc: PageDocument;
}

export type Extractor = (page: SourcePage) => FactCandidate[];

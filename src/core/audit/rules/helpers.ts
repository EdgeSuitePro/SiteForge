import type { ProfileFact } from '../../facts/profile';
import type { Evidence } from '../../facts/types';
import type { AuditPage } from '../context';
import type { RuleResult } from '../types';

export const pass = (detail: string, evidence: Evidence[] = []): RuleResult => ({ outcome: 'pass', credit: 1, detail, evidence });
export const fail = (detail: string, evidence: Evidence[] = []): RuleResult => ({ outcome: 'fail', credit: 0, detail, evidence });
export const partial = (credit: number, detail: string, evidence: Evidence[] = []): RuleResult => ({
  outcome: 'partial',
  credit: Math.max(0.1, Math.min(0.9, credit)),
  detail,
  evidence,
});
export const notApplicable = (detail: string): RuleResult => ({ outcome: 'not_applicable', credit: 0, detail, evidence: [] });
export const unknown = (detail: string): RuleResult => ({ outcome: 'unknown', credit: 0, detail, evidence: [] });

/** Graded result from a fraction of pages that comply. */
export function graded(fraction: number, detail: string, evidence: Evidence[] = []): RuleResult {
  if (fraction >= 0.999) return pass(detail, evidence);
  if (fraction <= 0) return fail(detail, evidence);
  return partial(fraction, detail, evidence);
}

export const factEvidence = (facts: ProfileFact[], max = 3): Evidence[] => facts.flatMap((fact) => fact.evidence.slice(0, 1)).slice(0, max);

/** Words that tell a reader (or a search engine) this is a sharpening business. */
export const SHARPENING_TERM = /\b(sharpen\w*|knife|knives|blades?|scissors|shears|edges?|honing|whetstone|grind\w*|cutlery)\b/i;

export const pathOf = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
};

export function pagesMatching(pages: AuditPage[], test: (page: AuditPage) => boolean) {
  return pages.filter(test);
}

export const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** Nav/URL test for a page type, e.g. services or about. */
export function findPageByPurpose(pages: AuditPage[], urlPattern: RegExp, titlePattern: RegExp): AuditPage | null {
  return (
    pages.find((page) => page.depth > 0 && urlPattern.test(pathOf(page.url))) ??
    pages.find((page) => page.depth > 0 && titlePattern.test(`${page.doc.title ?? ''} ${page.doc.headings[0]?.text ?? ''}`)) ??
    null
  );
}

export function cityMentioned(text: string, cities: string[]): string | null {
  for (const city of cities) {
    if (city.length >= 3 && new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) return city;
  }
  return null;
}

import { extractContact } from './extractors/contact';
import { extractIdentity } from './extractors/identity';
import { extractLocation } from './extractors/location';
import { extractOffering } from './extractors/offering';
import { extractTrust } from './extractors/trust';
import type { Confidence, Evidence, Extractor, Fact, FactCandidate, FactMethod, SourcePage } from './types';

export { FACTS_VERSION } from './types';
export { TAXONOMY_VERSION } from './taxonomy';

const EXTRACTORS: Extractor[] = [extractIdentity, extractContact, extractLocation, extractOffering, extractTrust];
export const MAX_EVIDENCE = 5;
/** Price mentions can be numerous; keep the list reviewable. */
const MAX_FACTS_PER_TYPE: Partial<Record<Fact['type'], number>> = { price: 40, service_area: 20, hours: 20, locality: 30 };

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
const METHOD_RANK: Record<FactMethod, number> = { structured_data: 3, markup: 2, text_pattern: 1, ai_extracted: 1 };

function candidateRank(candidate: FactCandidate, depthByPage: Map<string, number>): number {
  return (
    CONFIDENCE_RANK[candidate.confidence] * 100 +
    METHOD_RANK[candidate.method] * 10 +
    (depthByPage.get(candidate.evidence.pageId) === 0 ? 5 : 0) +
    (candidate.evidence.region === 'header' ? 2 : 0)
  );
}

/** Merge candidates with the same type+key into facts with combined evidence. */
export function consolidate(candidates: FactCandidate[], pages: SourcePage[]): Fact[] {
  const depthByPage = new Map(pages.map((page) => [page.pageId, page.depth]));
  const groups = new Map<string, FactCandidate[]>();
  for (const candidate of candidates) {
    const id = `${candidate.type}\u0000${candidate.key}`;
    const group = groups.get(id);
    if (group) group.push(candidate);
    else groups.set(id, [candidate]);
  }

  const facts: Fact[] = [];
  for (const group of groups.values()) {
    const ranked = [...group].sort((a, b) => candidateRank(b, depthByPage) - candidateRank(a, depthByPage));
    const best = ranked[0]!;
    const evidence: Evidence[] = [];
    const seen = new Set<string>();
    for (const candidate of ranked) {
      const id = `${candidate.evidence.pageId}|${candidate.evidence.locator}|${candidate.evidence.snippet}`;
      if (seen.has(id)) continue;
      seen.add(id);
      evidence.push(candidate.evidence);
      if (evidence.length >= MAX_EVIDENCE) break;
    }
    facts.push({
      type: best.type,
      key: best.key,
      value: best.value,
      display: best.display,
      method: best.method,
      confidence: best.confidence,
      occurrences: group.length,
      pageCount: new Set(group.map((candidate) => candidate.evidence.pageId)).size,
      onHomepage: group.some((candidate) => depthByPage.get(candidate.evidence.pageId) === 0),
      inHeader: group.some((candidate) => candidate.evidence.region === 'header'),
      evidence,
    });
  }

  const byType = new Map<string, Fact[]>();
  for (const fact of facts) byType.set(fact.type, [...(byType.get(fact.type) ?? []), fact]);
  const result: Fact[] = [];
  for (const [type, list] of byType) {
    const sorted = list.sort((a, b) => factScore(b) - factScore(a));
    result.push(...sorted.slice(0, MAX_FACTS_PER_TYPE[type as Fact['type']] ?? 100));
  }
  return result;
}

/** Ranking used to pick a primary value per field (higher = more trustworthy / prominent). */
export function factScore(fact: Pick<Fact, 'confidence' | 'method' | 'occurrences' | 'onHomepage' | 'inHeader'>): number {
  return (
    CONFIDENCE_RANK[fact.confidence] * 30 +
    METHOD_RANK[fact.method] * 9 +
    Math.min(fact.occurrences, 10) * 2 +
    (fact.onHomepage ? 4 : 0) +
    (fact.inHeader ? 3 : 0)
  );
}

/** Run every deterministic extractor over the crawled pages. */
export function extractFacts(pages: SourcePage[]): Fact[] {
  const candidates: FactCandidate[] = [];
  for (const page of pages) {
    for (const extractor of EXTRACTORS) candidates.push(...extractor(page));
  }
  return consolidate(candidates, pages);
}

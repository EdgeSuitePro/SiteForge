import { normalizeKey } from '../facts/text';
import { SERVICES } from '../facts/taxonomy';
import type { Fact } from '../facts/types';
import { normalizeForMatch, verifyCitation } from './citations';
import type { FactExtractOutput } from './prompts/fact-extract';
import type { PackedPage } from './untrusted';

const PRICE_IN_QUOTE = /\$\s?(\d{1,4}(?:\.\d{2})?)/;
export const MAX_AI_FACTS = 60;

/**
 * Convert model-extracted facts into SiteForge facts. A fact survives only if its quote is found
 * verbatim on the cited page and the value it claims is visible in that quote.
 */
export function aiFactsFrom(output: FactExtractOutput, pages: PackedPage[]): { facts: Fact[]; rejected: number } {
  const facts = new Map<string, Fact>();
  let rejected = 0;
  const home = pages[0]?.pageId;

  for (const item of output.facts.slice(0, MAX_AI_FACTS * 2)) {
    const evidence = verifyCitation({ page: item.page, quote: item.quote }, pages);
    if (!evidence) {
      rejected++;
      continue;
    }
    const label = item.label.trim().slice(0, 120);
    const quote = item.quote.trim();
    let fact: Omit<Fact, 'evidence' | 'occurrences' | 'pageCount' | 'onHomepage' | 'inHeader' | 'method' | 'confidence'> | null = null;

    switch (item.kind) {
      case 'service':
      case 'service_not_offered': {
        const known = SERVICES.find((service) => service.key === item.taxonomyKey);
        const key = known ? known.key : `other:${normalizeKey(label).replace(/ /g, '-').slice(0, 60)}`;
        if (!known && !label) break;
        fact = {
          type: item.kind,
          key,
          value: { service: key, category: known?.category ?? 'other', label: known?.label ?? label, matched: quote.slice(0, 120) },
          display: known?.label ?? label,
        };
        break;
      }
      case 'price': {
        const amount = PRICE_IN_QUOTE.exec(quote);
        if (!amount) break; // the price itself must be in the quoted text
        fact = {
          type: 'price',
          key: normalizeKey(`${amount[1]} ${label}`),
          value: { amount: Number(amount[1]), maxAmount: null, unit: null, currency: 'USD', context: quote.slice(0, 300), item: label },
          display: quote.length > 160 ? `${quote.slice(0, 157)}…` : quote,
        };
        break;
      }
      case 'owner_name': {
        if (!label || !normalizeForMatch(quote).includes(normalizeForMatch(label))) break; // name must appear in the quote
        fact = { type: 'owner_name', key: normalizeKey(label), value: { name: label }, display: label };
        break;
      }
      case 'turnaround':
        fact = { type: 'turnaround', key: normalizeKey(label || quote).slice(0, 80), value: { claim: label || quote, context: quote.slice(0, 300) }, display: label || quote };
        break;
      case 'service_area':
        fact = { type: 'service_area', key: normalizeKey(quote).slice(0, 160), value: { text: quote, source: 'ai' }, display: quote.length > 200 ? `${quote.slice(0, 197)}…` : quote };
        break;
      case 'hours':
        fact = { type: 'hours', key: normalizeKey(quote).slice(0, 120), value: { text: quote }, display: quote };
        break;
    }
    if (!fact) {
      rejected++;
      continue;
    }
    const id = `${fact.type}\u0000${fact.key}`;
    const existing = facts.get(id);
    if (existing) {
      existing.occurrences++;
      if (!existing.evidence.some((entry) => entry.pageId === evidence.pageId) && existing.evidence.length < 5) existing.evidence.push(evidence);
      existing.pageCount = new Set(existing.evidence.map((entry) => entry.pageId)).size;
      existing.onHomepage ||= evidence.pageId === home;
      continue;
    }
    if (facts.size >= MAX_AI_FACTS) break;
    facts.set(id, {
      ...fact,
      method: 'ai_extracted',
      confidence: 'medium',
      occurrences: 1,
      pageCount: 1,
      onHomepage: evidence.pageId === home,
      inHeader: false,
      evidence: [evidence],
    });
  }
  return { facts: [...facts.values()], rejected };
}

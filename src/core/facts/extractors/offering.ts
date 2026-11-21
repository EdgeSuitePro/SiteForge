import { blockEvidence, isContentRegion, isNegated, normalizeKey } from '../text';
import { SERVICES } from '../taxonomy';
import type { Extractor, FactCandidate } from '../types';

const PRICE =
  /\$\s?(\d{1,4}(?:\.\d{2})?)(?:\s?(?:-|–|—|to)\s?\$?\s?(\d{1,4}(?:\.\d{2})?))?(?:\s?(?:\/|per|a|an|each)\s?(inch|in\.|knife|knives|blade|item|pair|hour|edge|order|tool|scissor|visit|mile|lb|pound))?/gi;
/**
 * A turnaround phrase only counts when OTHER words in the same block show it is about the service
 * ("Next day" as a calendar link is not a turnaround claim).
 */
const TURNAROUND_CONTEXT = /\b(turnaround|ready|back to you|returned?|pick ?up|rush|expedited|usually|typically|sharpen\w*|knives|knife|orders?|service|bring|drop)\b/i;
const TURNAROUND =
  /\b(same[- ]day|next[- ]day|while you wait|(?:within|in)\s+(?:\d+|one|two|three|four|five|seven|a few)\s+(?:business\s+)?(?:hours?|days?|weeks?)|\d+(?:\s?-\s?\d+)?[- ](?:hour|day|week)s?\s+turnaround|turnaround(?:\s+time)?\s+(?:is|of)\s+[^.]{1,40})\b/i;

export const extractOffering: Extractor = (page) => {
  const out: FactCandidate[] = [];

  for (const block of page.doc.blocks) {
    if (!isContentRegion(block.region)) continue;
    const text = block.text;

    for (const service of SERVICES) {
      for (const pattern of service.patterns) {
        const match = pattern.exec(text);
        if (!match) continue;
        const negated = isNegated(text, match.index);
        out.push({
          type: negated ? 'service_not_offered' : 'service',
          key: service.key,
          value: { service: service.key, category: service.category, label: service.label, matched: match[0] },
          display: service.label,
          method: 'text_pattern',
          // Headings and list items are deliberate statements; prose is weaker; a customer's quote
          // ("my chef's knife…") is the weakest — it is not the business describing its services.
          confidence:
            block.tag === 'blockquote' ? 'low' : negated ? 'medium' : /^(h[1-6]|li|dt|th|td)$/.test(block.tag) ? 'high' : 'medium',
          evidence: blockEvidence(page, block, match.index, match.index + match[0].length),
        });
        break;
      }
    }

    for (const match of text.matchAll(PRICE)) {
      const amount = Number(match[1]);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const max = match[2] ? Number(match[2]) : null;
      const unit = match[3]?.toLowerCase().replace('in.', 'inch').replace('knives', 'knife') ?? null;
      const evidence = blockEvidence(page, block, match.index, match.index + match[0].length);
      out.push({
        type: 'price',
        key: normalizeKey(`${amount} ${max ?? ''} ${unit ?? ''} ${evidence.snippet.slice(0, 80)}`),
        value: { amount, maxAmount: max, unit, currency: 'USD', context: evidence.snippet },
        display: evidence.snippet.length > 160 ? `${evidence.snippet.slice(0, 157)}…` : evidence.snippet,
        method: 'text_pattern',
        confidence: 'medium',
        evidence,
      });
    }

    const turnaround = TURNAROUND.exec(text);
    const supporting = turnaround ? text.slice(0, turnaround.index) + text.slice(turnaround.index + turnaround[0].length) : '';
    if (turnaround && TURNAROUND_CONTEXT.test(supporting) && !isNegated(text, turnaround.index)) {
      out.push({
        type: 'turnaround',
        key: normalizeKey(turnaround[0]),
        value: { claim: turnaround[0], context: text.slice(0, 300) },
        display: turnaround[0],
        method: 'text_pattern',
        confidence: 'medium',
        evidence: blockEvidence(page, block, turnaround.index, turnaround.index + turnaround[0].length),
      });
    }
  }
  return out;
};

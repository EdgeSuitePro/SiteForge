import { z } from 'zod';

import { SERVICES } from '../../facts/taxonomy';
import { UNTRUSTED_CONTENT_RULES, untrustedEnvelope, type PackedPage } from '../untrusted';

/** Fast-tier fact extraction: catches phrasing the deterministic patterns miss. Quotes are verified. */
export const FACT_EXTRACT_PROMPT_ID = 'facts.ai_extract';
export const FACT_EXTRACT_PROMPT_VERSION = 'fact-extract@1';

export const AI_FACT_KINDS = ['service', 'service_not_offered', 'price', 'turnaround', 'service_area', 'owner_name', 'hours'] as const;
const TAXONOMY_KEYS: [string, ...string[]] = ['other', ...SERVICES.map((service) => service.key)];

export const factExtractSchema = z.object({
  facts: z.array(
    z.object({
      kind: z.enum(AI_FACT_KINDS),
      taxonomyKey: z.enum(TAXONOMY_KEYS),
      label: z.string(),
      page: z.string(),
      quote: z.string(),
    }),
  ),
});
export type FactExtractOutput = z.infer<typeof factExtractSchema>;

export const FACT_EXTRACT_SYSTEM = `You extract facts about a knife and tool sharpening business from its own website, for EdgeSuite Pro.

${UNTRUSTED_CONTENT_RULES}

Extract only facts the business states about itself:
- service: something the business says it sharpens, repairs, or offers (including how: drop-off, mail-in, mobile, pickup). Map to taxonomyKey when it fits, else "other" with a short label.
- service_not_offered: something the business explicitly says it does NOT do.
- price: a stated price with what it is for (label = the item, e.g. "Chef's knife").
- turnaround: a stated time frame for getting items back.
- service_area: a statement of the places it serves.
- owner_name: the name of the owner or sharpener, only if stated.
- hours: stated opening hours or availability.
Rules: one fact per item; quote = the exact sentence or phrase (copied verbatim) that states it; page = the page ref.
Do not include customer reviews as facts about services. Do not include anything you are not sure the business states. For taxonomyKey on non-service kinds use "other".

Service taxonomy keys: ${SERVICES.map((service) => `${service.key} (${service.label})`).join('; ')}.`;

export function buildFactExtractUser(pages: PackedPage[]): string {
  return `Extract the facts from these pages (p1 is the homepage):
${untrustedEnvelope({ pages: pages.map(({ ref, url, title, headings, text }) => ({ ref, url, title, headings, text })) })}`;
}

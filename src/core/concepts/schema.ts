import { z } from 'zod';

/**
 * A concept is DATA, never HTML. The AI (or the mock generator) writes copy and points at verified
 * facts by reference; deterministic renderers turn it into a page. Phone numbers, prices, hours,
 * addresses and service names are inserted by the renderer from the fact catalog, never typed by
 * the model.
 */
export const CONCEPT_SCHEMA_VERSION = 'concept@1';

export const STRATEGIES = ['local_growth', 'craftsman', 'fastest_path'] as const;
export type StrategyId = (typeof STRATEGIES)[number];

/** What a button should do. Resolved to a real link by the renderer from verified facts (or ESP later). */
export const CTA_INTENTS = ['call', 'text', 'email', 'book', 'drop_off', 'mail_in', 'contact'] as const;
export type CtaIntent = (typeof CTA_INTENTS)[number];

/**
 * Two variants of the same shape: `strict` (lengths and counts enforced; what is stored and rendered)
 * and `lenient` (what the model is asked for — length limits are not enforced by the API, so an
 * over-long line must not fail the whole concept; it is clamped by normalizeConcept instead).
 */
const LIMITS = {
  heading: 90, intro: 300, blurb: 220, stepTitle: 60, stepBody: 240, areaBody: 400, aboutBody: 700, trustBody: 400,
  question: 140, answer: 400, contactBody: 300, ctaBody: 240, eyebrow: 60, headline: 90, subheadline: 260,
  seoTitle: 70, seoDescription: 170, rationale: 500,
} as const;

export const SECTION_KINDS = ['services', 'process', 'pricing', 'service_area', 'about', 'trust', 'faq', 'contact', 'cta_band'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

function shape(strict: boolean) {
  const copy = (max: number) => (strict ? z.string().max(max) : z.string());
  const many = <T extends z.ZodType>(item: T, max: number, min = 0) => (strict ? z.array(item).min(min).max(max) : z.array(item));
  const refs = many(z.string(), 24);
  const section = z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('services'),
      heading: copy(LIMITS.heading),
      intro: copy(LIMITS.intro),
      /** Each item must reference a `service` fact; the renderer prints the service name from the fact. */
      items: many(z.object({ ref: z.string(), blurb: copy(LIMITS.blurb) }), 12),
    }),
    z.object({
      kind: z.literal('process'),
      heading: copy(LIMITS.heading),
      intro: copy(LIMITS.intro),
      steps: many(z.object({ title: copy(LIMITS.stepTitle), body: copy(LIMITS.stepBody) }), 5, 2),
    }),
    z.object({ kind: z.literal('pricing'), heading: copy(LIMITS.heading), intro: copy(LIMITS.intro), refs }),
    z.object({ kind: z.literal('service_area'), heading: copy(LIMITS.heading), body: copy(LIMITS.areaBody), refs }),
    z.object({ kind: z.literal('about'), heading: copy(LIMITS.heading), body: copy(LIMITS.aboutBody), refs }),
    z.object({ kind: z.literal('trust'), heading: copy(LIMITS.heading), body: copy(LIMITS.trustBody), refs }),
    z.object({
      kind: z.literal('faq'),
      heading: copy(LIMITS.heading),
      items: many(z.object({ question: copy(LIMITS.question), answer: copy(LIMITS.answer) }), 8),
    }),
    z.object({ kind: z.literal('contact'), heading: copy(LIMITS.heading), body: copy(LIMITS.contactBody) }),
    z.object({ kind: z.literal('cta_band'), heading: copy(LIMITS.heading), body: copy(LIMITS.ctaBody), cta: z.enum(CTA_INTENTS) }),
  ]);
  return z.object({
    hero: z.object({
      eyebrow: copy(LIMITS.eyebrow),
      headline: copy(LIMITS.headline),
      subheadline: copy(LIMITS.subheadline),
      primaryCta: z.enum(CTA_INTENTS),
      secondaryCta: z.enum(CTA_INTENTS).nullable(),
    }),
    sections: many(section, 10, 3),
    seo: z.object({ title: copy(LIMITS.seoTitle), metaDescription: copy(LIMITS.seoDescription) }),
    /** One or two sentences for the operator: why this concept is shaped the way it is. */
    rationale: copy(LIMITS.rationale),
  });
}

export const conceptContentSchema = shape(true);
export const conceptModelOutputSchema = shape(false);
export type ConceptContent = z.infer<typeof conceptContentSchema>;
export type ConceptSection = ConceptContent['sections'][number];
export type ConceptModelOutput = z.infer<typeof conceptModelOutputSchema>;

/** Clamp text at a word boundary. */
function clamp(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  // Never leave half a {{missing: …}} token behind.
  const cut = clean.slice(0, max - 1).replace(/\{\{[^}]*$/, '');
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max / 2))).replace(/[,;:\s]+$/, '')}…`;
}

/** Model output → strict concept content (clamped lengths and counts). Throws if structurally unusable. */
export function normalizeConcept(raw: ConceptModelOutput): ConceptContent {
  const L = LIMITS;
  const sections = raw.sections.slice(0, 10).map((section): ConceptSection => {
    switch (section.kind) {
      case 'services':
        return { ...section, heading: clamp(section.heading, L.heading), intro: clamp(section.intro, L.intro), items: section.items.slice(0, 12).map((item) => ({ ref: item.ref, blurb: clamp(item.blurb, L.blurb) })) };
      case 'process':
        return { ...section, heading: clamp(section.heading, L.heading), intro: clamp(section.intro, L.intro), steps: section.steps.slice(0, 5).map((step) => ({ title: clamp(step.title, L.stepTitle), body: clamp(step.body, L.stepBody) })) };
      case 'pricing':
        return { ...section, heading: clamp(section.heading, L.heading), intro: clamp(section.intro, L.intro), refs: section.refs.slice(0, 24) };
      case 'service_area':
        return { ...section, heading: clamp(section.heading, L.heading), body: clamp(section.body, L.areaBody), refs: section.refs.slice(0, 24) };
      case 'about':
        return { ...section, heading: clamp(section.heading, L.heading), body: clamp(section.body, L.aboutBody), refs: section.refs.slice(0, 24) };
      case 'trust':
        return { ...section, heading: clamp(section.heading, L.heading), body: clamp(section.body, L.trustBody), refs: section.refs.slice(0, 24) };
      case 'faq':
        return { ...section, heading: clamp(section.heading, L.heading), items: section.items.slice(0, 8).map((item) => ({ question: clamp(item.question, L.question), answer: clamp(item.answer, L.answer) })) };
      case 'contact':
        return { ...section, heading: clamp(section.heading, L.heading), body: clamp(section.body, L.contactBody) };
      case 'cta_band':
        return { ...section, heading: clamp(section.heading, L.heading), body: clamp(section.body, L.ctaBody) };
    }
  });
  return conceptContentSchema.parse({
    hero: {
      ...raw.hero,
      eyebrow: clamp(raw.hero.eyebrow, L.eyebrow),
      headline: clamp(raw.hero.headline, L.headline),
      subheadline: clamp(raw.hero.subheadline, L.subheadline),
    },
    // A process section needs at least two steps to render; drop one that does not.
    sections: sections.filter((section) => section.kind !== 'process' || section.steps.length >= 2),
    seo: { title: clamp(raw.seo.title, L.seoTitle), metaDescription: clamp(raw.seo.metaDescription, L.seoDescription) },
    rationale: clamp(raw.rationale, L.rationale),
  });
}

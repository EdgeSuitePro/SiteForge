import { normalizeForMatch } from '../ai/citations';
import { SERVICES } from '../facts/taxonomy';
import { byRef, contactChannels, factsOf, firstOf, type FactCatalog } from './catalog';
import type { ConceptContent, ConceptSection, CtaIntent, SectionKind, StrategyId } from './schema';
import { STRATEGY_DEFINITIONS } from './strategies';

/**
 * Unsupported-claim checker. Runs on every concept before it is stored or rendered.
 *
 * Every factual claim in the copy (prices, numbers, years, durations, guarantees, credentials,
 * awards, superlatives, ratings, testimonials, place names, services) must be supported by the
 * verified fact catalog. A sentence with an unsupported claim is replaced by a visible operator
 * placeholder and recorded in the report. Copy that repeats the current site verbatim is treated
 * the same way. Structural problems (bad fact references, unavailable call-to-action types,
 * forbidden sections) are repaired and reported.
 */
export const CLAIM_CHECK_VERSION = 'claim-check@1';

/** Placeholder markers (Unicode private-use characters; stripped from all incoming copy). */
export const PH_OPEN = '';
export const PH_SEP = '';
export const PH_CLOSE = '';
const MARKERS = /[-]/g;

export type ClaimKind =
  | 'price'
  | 'number'
  | 'year'
  | 'experience'
  | 'turnaround'
  | 'guarantee'
  | 'credential'
  | 'superlative'
  | 'rating'
  | 'testimonial'
  | 'place'
  | 'service'
  | 'service_not_offered'
  | 'contact_detail'
  | 'copied_text';

export interface ClaimViolation {
  path: string;
  kind: ClaimKind;
  claim: string;
  sentence: string;
}

export interface StructuralIssue {
  path: string;
  issue: string;
}

export interface ClaimReport {
  version: string;
  violations: ClaimViolation[];
  structural: StructuralIssue[];
  placeholders: number;
  claimsChecked: number;
}

export interface ClaimCheckOptions {
  strategy: StrategyId;
  /** Lower-cased 10-word shingles of the current site's text, to catch verbatim copying. */
  siteShingles?: Set<string>;
}

const REASON: Record<ClaimKind, string> = {
  price: 'price not found on the current site',
  number: 'number not found on the current site',
  year: 'year not found on the current site',
  experience: 'experience claim not found on the current site',
  turnaround: 'turnaround not stated on the current site',
  guarantee: 'guarantee not stated on the current site',
  credential: 'credential or award not stated on the current site',
  superlative: 'unsupported superlative',
  rating: 'rating or count not found on the current site',
  testimonial: 'quotation not found on the current site',
  place: 'place not found in the business’s location facts',
  service: 'service not listed on the current site',
  service_not_offered: 'the current site says this is NOT offered',
  contact_detail: 'contact detail not found on the current site',
  copied_text: 'copied word-for-word from the current site; rewrite it',
};

export const placeholder = (kind: ClaimKind) => `${PH_OPEN}${REASON[kind]}${PH_SEP}${PH_CLOSE}`;

/**
 * Copywriters (model or mock) mark information the site does not provide with `{{missing: what}}`.
 * The checker turns it into an operator placeholder; it is never rendered as business information.
 */
export const MISSING_TOKEN = /\{\{\s*missing\s*:\s*([^{}]{1,100})\}\}/gi;
export const missing = (what: string) => `{{missing: ${what}}}`;
const missingPlaceholder = (what: string) => `${PH_OPEN}Missing: ${what.replace(MARKERS, '').trim()}${PH_SEP}missing${PH_CLOSE}`;

// ------------------------------------------------------------------------------------------------
// Support corpus
// ------------------------------------------------------------------------------------------------

interface Support {
  all: string;
  places: string;
  turnaround: string;
  years: string;
  prices: number[];
  phones: string[];
  emails: string[];
  services: Set<string>;
  notOffered: Set<string>;
}

const valueStrings = (value: Record<string, unknown>) =>
  Object.values(value)
    .filter((entry) => typeof entry === 'string' || typeof entry === 'number')
    .map(String);

function buildSupport(catalog: FactCatalog): Support {
  const text = (types: string[]) =>
    normalizeForMatch(
      catalog.facts
        .filter((fact) => types.length === 0 || types.includes(fact.type))
        .flatMap((fact) => [fact.display, ...valueStrings(fact.value), ...fact.snippets])
        .join(' \n '),
    );
  return {
    all: text([]),
    places: text(['locality', 'address', 'service_area', 'business_name']),
    turnaround: text(['turnaround']),
    years: text(['years_claim']),
    prices: factsOf(catalog, 'price').flatMap((fact) => [fact.value.amount, fact.value.maxAmount].filter((amount): amount is number => typeof amount === 'number')),
    phones: factsOf(catalog, 'phone').map((fact) => String(fact.value.e164 ?? '').replace(/\D/g, '').slice(-10)),
    emails: factsOf(catalog, 'email').map((fact) => String(fact.value.email ?? '').toLowerCase()),
    services: new Set(factsOf(catalog, 'service').map((fact) => String(fact.value.service ?? ''))),
    notOffered: new Set(factsOf(catalog, 'service_not_offered').map((fact) => String(fact.value.service ?? ''))),
  };
}

// ------------------------------------------------------------------------------------------------
// Detectors
// ------------------------------------------------------------------------------------------------

const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty';
const PATTERNS = {
  phone: /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g,
  email: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
  price: /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g,
  year: /\b(?:since|established|est\.?|founded(?: in)?|opened(?: in)?)\s+((?:19|20)\d{2})\b|\b((?:19|20)\d{2})\b/gi,
  experience: new RegExp(`\\b(?:\\d+|${NUMBER_WORDS})\\+?\\s+(?:years?|decades?)\\b|\\bdecades\\b|\\bgenerations?\\b`, 'gi'),
  turnaround:
    /\b(?:same[- ]day|next[- ]day|overnight|while[- ]you[- ]wait|24\/7|(?:within|in|under)\s+(?:\d+|an?|one|two|three|a few)\s+(?:minutes?|hours?|days?|business days?|weeks?)|\d+\s*(?:-|to|–)\s*\d+\s*(?:minutes?|hours?|days?|business days?|weeks?)|\d+\s*(?:minutes?|hours?|days?|business days?|weeks?))\b/gi,
  guarantee: /\b(?:guarantee[sd]?|guaranteeing|warrant(?:y|ies|ied)|money[- ]back|satisfaction|risk[- ]free|no[- ]risk)\b/gi,
  credential:
    /\b(?:certified|certification|licensed|insured|bonded|accredited|award[- ]?winning|awards?|voted|master (?:sharpener|bladesmith|craftsman)|apprentice(?:d|ship)?|guild|member of|trained by|formally trained)\b/gi,
  superlative:
    /(?:#\s?1\b|\b(?:best|number one|top[- ]rated|highest[- ]rated|leading|premier|finest|unmatched|unbeatable|unrivall?ed|cheapest|lowest|fastest|most trusted|world[- ]class|second to none|only (?:sharpener|one))\b)/gi,
  rating: /\b\d(?:\.\d)?\s*(?:stars?|★)|\b\d[\d,]*\+?\s+(?:reviews?|ratings?|customers?|clients?|knives|blades|happy)\b|\bfive[- ]star\b/gi,
  quote: /[“"]([^”"]{12,})[”"]/g,
  attribution: /(?:^|\s)[—–-]\s*[A-Z][a-z]+(?:\s[A-Z]\.?|\s[A-Z][a-z]+)?\s*$/,
  place: /\b(?:[Ii]n|[Nn]ear|[Ss]erving|[Aa]cross|[Tt]hroughout|[Aa]round|[Ff]rom|[Ff]or|[Tt]o)\s+((?:[A-Z][\w'’.-]+)(?:(?:,\s*|\s+(?:and|&|or)\s+|,\s+(?:and|or)\s+|\s+)[A-Z][\w'’.-]+){0,8})/g,
  number: /\b\d[\d,]*(?:\.\d+)?\b/g,
};

/** Capitalized words that are not places (sentence-case copy rarely needs this list, but titles do). */
const NOT_PLACES = new Set(
  `a an the your our you we us my their this that these those every each all any most more less many few some
   it its i me one two three four five six seven eight nine ten kitchen chef chefs home cooks cook knives knife
   blades blade tools tool scissors shears garden service services sharpening sharp edge edges care craft quality
   minutes hours days weeks today now monday tuesday wednesday thursday friday saturday sunday january february
   march april may june july august september october november december step steps more information details
   people customers everyone pickup pick drop mail contact call text book email online local your
   business businesses restaurants restaurant professionals pros cooks hunters woodworkers gardeners`
    .split(/\s+/)
    .filter(Boolean),
);

/** Whole-number match: "3" must appear as its own number, not inside "$13" or a phone number. */
const hasNumber = (haystack: string, raw: string) => {
  const digits = raw.replace(/,/g, '');
  const escaped = digits.replace(/[.]/g, '\\.');
  return new RegExp(`(?<![\\d.,])${escaped}(?![\\d]|[.,]\\d)`).test(haystack.replace(/(\d),(\d{3})/g, '$1$2'));
};

const contains = (haystack: string, needle: string) => normalizeForMatch(haystack).includes(normalizeForMatch(needle));

interface Finding {
  kind: ClaimKind;
  claim: string;
}

function checkSentence(sentence: string, support: Support, shingles: Set<string> | undefined): { findings: Finding[]; checked: number } {
  const findings: Finding[] = [];
  let checked = 0;
  let rest = sentence;
  const take = (pattern: RegExp, fn: (match: RegExpExecArray) => Finding | null) => {
    for (const match of [...rest.matchAll(new RegExp(pattern.source, pattern.flags))]) {
      checked++;
      const finding = fn(match);
      if (finding) findings.push(finding);
    }
    // Remove what we have looked at so the catch-all number check does not double-count it.
    rest = rest.replace(new RegExp(pattern.source, pattern.flags), ' ');
  };

  take(PATTERNS.email, (m) => (support.emails.includes(m[0].toLowerCase()) ? null : { kind: 'contact_detail', claim: m[0] }));
  take(PATTERNS.phone, (m) => (support.phones.includes(m[0].replace(/\D/g, '').slice(-10)) ? null : { kind: 'contact_detail', claim: m[0] }));
  take(PATTERNS.price, (m) => {
    const amount = Number(m[1]!.replace(/,/g, ''));
    return support.prices.some((price) => Math.abs(price - amount) < 0.005) ? null : { kind: 'price', claim: m[0] };
  });
  take(PATTERNS.turnaround, (m) => {
    const phrase = normalizeForMatch(m[0]).replace(/-/g, ' ');
    const corpus = support.turnaround.replace(/-/g, ' ');
    if (corpus.includes(phrase)) return null;
    if (/while you wait/.test(phrase) && support.services.has('while_you_wait')) return null;
    return { kind: 'turnaround', claim: m[0] };
  });
  take(PATTERNS.experience, (m) => (contains(support.years, m[0]) ? null : { kind: 'experience', claim: m[0] }));
  take(PATTERNS.year, (m) => {
    const year = m[1] ?? m[2]!;
    return hasNumber(support.all, year) ? null : { kind: 'year', claim: m[0] };
  });
  take(PATTERNS.rating, (m) => (contains(support.all, m[0]) ? null : { kind: 'rating', claim: m[0] }));
  take(PATTERNS.number, (m) => (hasNumber(support.all, m[0]) ? null : { kind: 'number', claim: m[0] }));

  for (const [kind, pattern] of [
    ['guarantee', PATTERNS.guarantee],
    ['credential', PATTERNS.credential],
    ['superlative', PATTERNS.superlative],
  ] as const) {
    for (const match of sentence.matchAll(new RegExp(pattern.source, pattern.flags))) {
      checked++;
      if (!contains(support.all, match[0])) findings.push({ kind, claim: match[0] });
    }
  }

  for (const match of sentence.matchAll(new RegExp(PATTERNS.quote.source, PATTERNS.quote.flags))) {
    checked++;
    if (!contains(support.all, match[1]!)) findings.push({ kind: 'testimonial', claim: match[0] });
  }
  if (PATTERNS.attribution.test(sentence)) {
    checked++;
    findings.push({ kind: 'testimonial', claim: sentence.match(PATTERNS.attribution)![0].trim() });
  }

  for (const match of sentence.matchAll(new RegExp(PATTERNS.place.source, PATTERNS.place.flags))) {
    // "Springfield, Chatham and Rochester" → each place is checked on its own.
    for (const part of match[1]!.split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|&|or)\s+/)) {
      const words = part.split(/\s+/).filter(Boolean);
      while (words.length && NOT_PLACES.has(words[0]!.toLowerCase().replace(/[’']s$/, ''))) words.shift();
      if (!words.length) continue;
      const candidate = words.join(' ').replace(/[.,]+$/, '');
      checked++;
      if (!contains(support.places, candidate) && !contains(support.all, candidate)) findings.push({ kind: 'place', claim: candidate });
    }
  }

  for (const service of SERVICES) {
    const match = service.patterns.map((pattern) => pattern.exec(sentence)).find(Boolean);
    if (!match) continue;
    checked++;
    if (support.notOffered.has(service.key) && !support.services.has(service.key)) findings.push({ kind: 'service_not_offered', claim: match[0] });
    else if (!support.services.has(service.key)) findings.push({ kind: 'service', claim: match[0] });
  }

  if (shingles?.size) {
    const words = normalizeForMatch(sentence).replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(' ').filter(Boolean);
    for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) {
      if (shingles.has(words.slice(i, i + SHINGLE_WORDS).join(' '))) {
        checked++;
        findings.push({ kind: 'copied_text', claim: words.slice(i, i + SHINGLE_WORDS).join(' ') });
        break;
      }
    }
  }
  return { findings, checked };
}

export const SHINGLE_WORDS = 10;

/** 10-word shingles of the current site's text (for the verbatim-copy check). */
export function siteShingles(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    const words = normalizeForMatch(text).replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(' ').filter(Boolean);
    for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) out.add(words.slice(i, i + SHINGLE_WORDS).join(' '));
  }
  return out;
}

const splitSentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])/);

// ------------------------------------------------------------------------------------------------
// Structural checks
// ------------------------------------------------------------------------------------------------

const ALLOWED_REF_TYPES: Partial<Record<SectionKind, string[]>> = {
  pricing: ['price'],
  service_area: ['service_area', 'locality', 'address'],
  about: ['owner_name', 'years_claim', 'business_name'],
  trust: ['reviews', 'years_claim', 'social_profile'],
};

export function availableCtas(catalog: FactCatalog): Set<CtaIntent> {
  const channels = contactChannels(catalog);
  const phone = Boolean(firstOf(catalog, 'phone'));
  const out = new Set<CtaIntent>(['contact', 'book']); // "book" is EdgeSuite Pro reservations when the site has none
  if (phone) out.add('call');
  if (phone && channels.has('text_message')) out.add('text');
  if (firstOf(catalog, 'email')) out.add('email');
  const services = new Set(factsOf(catalog, 'service').map((fact) => String(fact.value.service)));
  if (services.has('drop_off')) out.add('drop_off');
  if (services.has('mail_in')) out.add('mail_in');
  return out;
}

// ------------------------------------------------------------------------------------------------
// Entry point
// ------------------------------------------------------------------------------------------------

export function checkConcept(input: ConceptContent, catalog: FactCatalog, options: ClaimCheckOptions): { content: ConceptContent; report: ClaimReport } {
  const support = buildSupport(catalog);
  const violations: ClaimViolation[] = [];
  const structural: StructuralIssue[] = [];
  let placeholders = 0;
  let claimsChecked = 0;

  const checkText = (path: string, raw: string, { replaceWith }: { replaceWith?: string } = {}): string => {
    const text = raw.replace(MARKERS, '').replace(/\u0000/g, '').trim();
    if (!text) return text;
    // Missing-information tokens become placeholders and are not checked as claims.
    const gaps: string[] = [];
    const withoutGaps = text.replace(new RegExp(MISSING_TOKEN.source, MISSING_TOKEN.flags), (_match, what: string) => {
      gaps.push(what);
      return ` \u0000${gaps.length - 1}\u0000 `;
    });
    const out: string[] = [];
    let replaced = false;
    for (const sentence of splitSentences(withoutGaps.replace(/\s+/g, ' ').trim())) {
      if (/^\u0000\d+\u0000$/.test(sentence.trim())) {
        out.push(sentence);
        continue;
      }
      const { findings, checked } = checkSentence(sentence.replace(/\u0000\d+\u0000/g, ' '), support, options.siteShingles);
      claimsChecked += checked;
      if (!findings.length) {
        out.push(sentence);
        continue;
      }
      for (const finding of findings) violations.push({ path, kind: finding.kind, claim: finding.claim, sentence });
      if (replaceWith !== undefined) {
        replaced = true;
        break;
      }
      placeholders++;
      out.push(placeholder(findings[0]!.kind));
    }
    if (replaced) return replaceWith!;
    const joined = out.join(' ').replace(/\s?\u0000(\d+)\u0000\s?/g, (_match, index: string) => {
      if (replaceWith !== undefined) return ' ';
      placeholders++;
      return ` ${missingPlaceholder(gaps[Number(index)]!)} `;
    });
    return joined.replace(/\s+/g, ' ').trim();
  };

  const ctas = availableCtas(catalog);
  const cta = (path: string, intent: CtaIntent): CtaIntent => {
    if (ctas.has(intent)) return intent;
    structural.push({ path, issue: `call to action "${intent}" is not supported by the facts; using "contact"` });
    return 'contact';
  };

  const strategy = STRATEGY_DEFINITIONS[options.strategy];
  const sections: ConceptSection[] = [];
  for (const [index, section] of input.sections.entries()) {
    const path = `sections[${index}]`;
    if (strategy.excludedSections.includes(section.kind)) {
      structural.push({ path, issue: `${section.kind} section is not part of the ${strategy.name} strategy; removed` });
      continue;
    }
    if (sections.some((existing) => existing.kind === section.kind)) {
      structural.push({ path, issue: `duplicate ${section.kind} section removed` });
      continue;
    }
    const filterRefs = (refs: string[]) =>
      refs.filter((ref) => {
        const fact = byRef(catalog, ref);
        const ok = fact && (ALLOWED_REF_TYPES[section.kind] ?? []).includes(fact.type);
        if (!ok) structural.push({ path, issue: `fact reference ${ref} is not valid in a ${section.kind} section; removed` });
        return ok;
      });

    switch (section.kind) {
      case 'services': {
        const seen = new Set<string>();
        const items = section.items.filter((item, itemIndex) => {
          const fact = byRef(catalog, item.ref);
          const ok = fact?.type === 'service' && !seen.has(item.ref);
          if (!ok) structural.push({ path: `${path}.items[${itemIndex}]`, issue: `reference ${item.ref} is not a listed service; removed` });
          seen.add(item.ref);
          return ok;
        });
        sections.push({
          ...section,
          heading: checkText(`${path}.heading`, section.heading),
          intro: checkText(`${path}.intro`, section.intro),
          items: items.map((item, itemIndex) => ({ ref: item.ref, blurb: checkText(`${path}.items[${itemIndex}].blurb`, item.blurb) })),
        });
        break;
      }
      case 'process':
        sections.push({
          ...section,
          heading: checkText(`${path}.heading`, section.heading),
          intro: checkText(`${path}.intro`, section.intro),
          steps: section.steps.map((step, stepIndex) => ({
            title: checkText(`${path}.steps[${stepIndex}].title`, step.title),
            body: checkText(`${path}.steps[${stepIndex}].body`, step.body),
          })),
        });
        break;
      case 'pricing':
        sections.push({ ...section, heading: checkText(`${path}.heading`, section.heading), intro: checkText(`${path}.intro`, section.intro), refs: filterRefs(section.refs) });
        break;
      case 'service_area':
      case 'about':
      case 'trust':
        sections.push({ ...section, heading: checkText(`${path}.heading`, section.heading), body: checkText(`${path}.body`, section.body), refs: filterRefs(section.refs) });
        break;
      case 'faq':
        sections.push({
          ...section,
          heading: checkText(`${path}.heading`, section.heading),
          items: section.items.map((item, itemIndex) => ({
            question: checkText(`${path}.items[${itemIndex}].question`, item.question),
            answer: checkText(`${path}.items[${itemIndex}].answer`, item.answer),
          })),
        });
        break;
      case 'contact':
        sections.push({ ...section, heading: checkText(`${path}.heading`, section.heading), body: checkText(`${path}.body`, section.body) });
        break;
      case 'cta_band':
        sections.push({ ...section, heading: checkText(`${path}.heading`, section.heading), body: checkText(`${path}.body`, section.body), cta: cta(`${path}.cta`, section.cta) });
        break;
    }
  }
  for (const required of strategy.requiredSections) {
    if (!sections.some((section) => section.kind === required)) structural.push({ path: 'sections', issue: `the ${strategy.name} strategy expects a ${required} section` });
  }

  const name = firstOf(catalog, 'business_name')?.display ?? 'Knife sharpening';
  const content: ConceptContent = {
    hero: {
      eyebrow: checkText('hero.eyebrow', input.hero.eyebrow, { replaceWith: '' }),
      headline: checkText('hero.headline', input.hero.headline),
      subheadline: checkText('hero.subheadline', input.hero.subheadline),
      primaryCta: cta('hero.primaryCta', input.hero.primaryCta),
      secondaryCta: input.hero.secondaryCta ? cta('hero.secondaryCta', input.hero.secondaryCta) : null,
    },
    sections,
    // Metadata is never shown as a placeholder: an unsupported title falls back to the business name.
    seo: {
      title: checkText('seo.title', input.seo.title, { replaceWith: name }),
      metaDescription: checkText('seo.metaDescription', input.seo.metaDescription, { replaceWith: '' }),
    },
    rationale: input.rationale.replace(MARKERS, '').trim(),
  };
  if (content.hero.secondaryCta === content.hero.primaryCta) content.hero.secondaryCta = null;

  return { content, report: { version: CLAIM_CHECK_VERSION, violations, structural, placeholders, claimsChecked } };
}

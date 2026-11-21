import { jsonLdNodes, jsonLdTypes } from '../../extract/document';
import { blockEvidence, isContentRegion, jsonLdEvidence, markupEvidence, normalizeKey } from '../text';
import type { Extractor, FactCandidate } from '../types';

const REVIEW_WIDGET_HOSTS: Array<[RegExp, string]> = [
  [/elfsight\.com/, 'Elfsight reviews widget'],
  [/trustindex\.io/, 'Trustindex reviews widget'],
  [/birdeye\.com/, 'Birdeye reviews widget'],
  [/podium\.com/, 'Podium reviews widget'],
  [/reviewsonmywebsite\.com|embedsocial\.com|sociablekit\.com|trustmary\.com/, 'Reviews widget'],
];
const REVIEW_HEADING = /\b(testimonials?|reviews?|what (our )?(customers|clients) (are )?say(ing)?|kind words|happy customers)\b/i;
const FAQ_HEADING = /\b(faqs?|frequently asked questions?|common questions)\b/i;
/**
 * Case-sensitive on purpose (names must be capitalised), so lead-in phrases spell out both cases:
 * "My name is Jason Miller", "I'm Jason", "Owner: Jason Miller", "Founded by Jason Miller", "Meet Jason".
 */
const OWNER =
  /(?:^|[^\w])(?:[Mm]y name is|I'?m|I am|[Oo]wner(?:\s*(?:and|&)\s*(?:sharpener|founder|operator))?\s*[,:–-]?|[Ff]ounded by|[Mm]eet)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){0,2})\b/;
const NOT_A_NAME = new Set(['The', 'Our', 'We', 'Your', 'This', 'Here', 'Happy', 'Glad', 'Proud', 'Excited', 'Sharp', 'Professional', 'Local', 'Family', 'Available', 'Located', 'Open', 'Not', 'Also']);
const YEARS =
  /\b(?:(?:since|established|est\.?|founded(?: in)?|serving [\w\s]{1,30} since)\s+((?:19|20)\d{2})|((?:\d{1,2}|twenty|thirty|forty|fifty)\+?\s+years?)\s+(?:of\s+)?(?:experience|in business|sharpening|serving))\b/i;

export const extractTrust: Extractor = (page) => {
  const out: FactCandidate[] = [];

  for (const node of jsonLdNodes(page.doc)) {
    const types = jsonLdTypes(node);
    for (const type of types) {
      out.push({ type: 'structured_data', key: type.toLowerCase(), value: { schemaType: type }, display: `schema.org ${type}`, method: 'structured_data', confidence: 'high', evidence: jsonLdEvidence(page, `@type: ${type}`, type) });
    }
    const rating = node.aggregateRating as Record<string, unknown> | undefined;
    if (rating && typeof rating === 'object') {
      const value = Number(rating.ratingValue);
      const count = Number(rating.reviewCount ?? rating.ratingCount);
      out.push({
        type: 'reviews',
        key: 'schema_rating',
        value: { source: 'schema_rating', rating: Number.isFinite(value) ? value : null, count: Number.isFinite(count) ? count : null },
        display: `Rating in structured data${Number.isFinite(value) ? `: ${value}` : ''}${Number.isFinite(count) ? ` (${count} reviews)` : ''}`,
        method: 'structured_data',
        confidence: 'high',
        evidence: jsonLdEvidence(page, JSON.stringify(rating).slice(0, 200), `${types.join('/')}.aggregateRating`),
      });
    }
    if (types.includes('FAQPage')) {
      const questions = Array.isArray(node.mainEntity) ? node.mainEntity.length : 0;
      out.push({ type: 'faq', key: 'schema', value: { source: 'schema', questions }, display: `FAQ structured data (${questions} questions)`, method: 'structured_data', confidence: 'high', evidence: jsonLdEvidence(page, `FAQPage with ${questions} questions`, 'FAQPage') });
    }
    const founders = [node.founder, node.employee].flat().filter(Boolean).slice(0, 5);
    for (const founder of founders) {
      const name = typeof founder === 'string' ? founder : typeof (founder as Record<string, unknown>)?.name === 'string' ? ((founder as Record<string, unknown>).name as string) : null;
      if (name) out.push({ type: 'owner_name', key: normalizeKey(name), value: { name }, display: name, method: 'structured_data', confidence: 'high', evidence: jsonLdEvidence(page, name, `${types.join('/')}.founder`) });
    }
  }

  for (const host of page.doc.scriptHosts) {
    const widget = REVIEW_WIDGET_HOSTS.find(([pattern]) => pattern.test(host));
    if (widget) out.push({ type: 'reviews', key: 'widget', value: { source: 'widget', provider: host }, display: widget[1], method: 'markup', confidence: 'medium', evidence: markupEvidence(page, host, 'script', 'body') });
  }

  const reviewHeading = page.doc.headings.find((heading) => REVIEW_HEADING.test(heading.text) && heading.region !== 'nav');
  if (reviewHeading) {
    const block = page.doc.blocks.find((candidate) => candidate.text === reviewHeading.text);
    if (block) out.push({ type: 'reviews', key: 'testimonial_section', value: { source: 'testimonial_section', heading: reviewHeading.text }, display: `Testimonials section: “${reviewHeading.text}”`, method: 'markup', confidence: 'high', evidence: blockEvidence(page, block) });
  }
  const quotes = page.doc.blocks.filter((block) => block.tag === 'blockquote' && block.text.length > 30);
  if (quotes.length) {
    out.push({ type: 'reviews', key: 'quotes', value: { source: 'quotes', count: quotes.length }, display: `${quotes.length} quoted testimonial${quotes.length === 1 ? '' : 's'}`, method: 'markup', confidence: 'medium', evidence: blockEvidence(page, quotes[0]!) });
  }

  const faqHeading = page.doc.headings.find((heading) => FAQ_HEADING.test(heading.text) && heading.region !== 'nav');
  const questionHeadings = page.doc.headings.filter((heading) => heading.text.endsWith('?'));
  if (faqHeading || questionHeadings.length >= 3) {
    const anchorText = faqHeading?.text ?? questionHeadings[0]!.text;
    const block = page.doc.blocks.find((candidate) => candidate.text === anchorText);
    if (block) {
      out.push({
        type: 'faq',
        key: 'content',
        value: { source: 'content', questions: questionHeadings.length },
        display: faqHeading ? `FAQ section: “${faqHeading.text}”` : `${questionHeadings.length} question headings`,
        method: 'markup',
        confidence: 'high',
        evidence: blockEvidence(page, block),
      });
    }
  }

  for (const block of page.doc.blocks) {
    if (!isContentRegion(block.region)) continue;
    const owner = OWNER.exec(block.text);
    if (owner?.[1] && !NOT_A_NAME.has(owner[1].split(' ')[0] ?? '')) {
      out.push({ type: 'owner_name', key: normalizeKey(owner[1]), value: { name: owner[1] }, display: owner[1], method: 'text_pattern', confidence: 'low', evidence: blockEvidence(page, block, owner.index, owner.index + owner[0].length) });
    }
    const years = YEARS.exec(block.text);
    if (years) {
      out.push({
        type: 'years_claim',
        key: normalizeKey(years[0]),
        value: { claim: years[0], year: years[1] ? Number(years[1]) : null },
        display: years[0],
        method: 'text_pattern',
        confidence: 'medium',
        evidence: blockEvidence(page, block, years.index, years.index + years[0].length),
      });
    }
  }
  return out;
};

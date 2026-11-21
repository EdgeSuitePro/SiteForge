import { clean, jsonLdNodes, jsonLdTypes } from '../../extract/document';
import { jsonLdEvidence, markupEvidence, normalizeKey } from '../text';
import type { Extractor, FactCandidate } from '../types';

const BUSINESS_TYPES = /LocalBusiness|Organization|Store|HomeAndConstructionBusiness|ProfessionalService|Corporation/i;
const TITLE_SEPARATORS = /\s+[|–—•·:]\s+|\s+-\s+/;
const GENERIC_TITLE = /^(home|homepage|welcome|index|untitled|about|contact)$/i;
const LEGAL_SUFFIX = /,?\s+(llc|l\.l\.c\.|inc\.?|co\.?|ltd\.?|corp\.?)$/i;
const COPYRIGHT = /(?:©|\(c\)|copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s*([A-Z][\w&'.,\s-]{2,60}?)(?:\.|\s+all rights|\s*\||$)/i;

function nameCandidate(raw: string, evidence: FactCandidate['evidence'], method: FactCandidate['method'], confidence: FactCandidate['confidence'], source: string): FactCandidate | null {
  const name = clean(raw).replace(/^welcome to\s+/i, '').trim();
  if (name.length < 2 || name.length > 80 || GENERIC_TITLE.test(name)) return null;
  return {
    type: 'business_name',
    key: normalizeKey(name.replace(LEGAL_SUFFIX, '')),
    value: { name, source },
    display: name,
    method,
    confidence,
    evidence,
  };
}

export const extractIdentity: Extractor = (page) => {
  const out: FactCandidate[] = [];
  const push = (candidate: FactCandidate | null) => {
    if (candidate) out.push(candidate);
  };
  const doc = page.doc;

  for (const node of jsonLdNodes(doc)) {
    const types = jsonLdTypes(node);
    if (!types.some((type) => BUSINESS_TYPES.test(type))) continue;
    if (typeof node.name === 'string') push(nameCandidate(node.name, jsonLdEvidence(page, node.name, `${types.join('/')}.name`), 'structured_data', 'high', 'structured_data'));
    const logo = typeof node.logo === 'string' ? node.logo : typeof (node.logo as Record<string, unknown>)?.url === 'string' ? ((node.logo as Record<string, unknown>).url as string) : null;
    if (logo) {
      try {
        const src = new URL(logo, page.url).href;
        out.push({ type: 'logo', key: src, value: { src, alt: null }, display: src, method: 'structured_data', confidence: 'high', evidence: jsonLdEvidence(page, logo, `${types.join('/')}.logo`) });
      } catch {
        /* ignore */
      }
    }
  }

  if (page.depth === 0) {
    if (doc.og.siteName) push(nameCandidate(doc.og.siteName, markupEvidence(page, doc.og.siteName, 'meta og:site_name', 'head'), 'markup', 'high', 'og_site_name'));
    if (doc.title) {
      const first = doc.title.split(TITLE_SEPARATORS)[0] ?? '';
      push(nameCandidate(first, markupEvidence(page, doc.title, 'title', 'head'), 'markup', 'medium', 'title'));
    }
  }

  for (const block of doc.blocks) {
    if (block.region !== 'footer') continue;
    const match = COPYRIGHT.exec(block.text);
    if (match?.[1]) push(nameCandidate(match[1].replace(/[.,\s]+$/, ''), markupEvidence(page, block.text.slice(0, 200), `text ${block.tag} (footer)`, 'footer'), 'text_pattern', 'medium', 'copyright'));
  }

  for (const image of doc.images) {
    if (image.logoScore < 3) continue;
    out.push({ type: 'logo', key: image.src, value: { src: image.src, alt: image.alt }, display: image.alt || image.src, method: 'markup', confidence: image.logoScore >= 5 ? 'high' : 'medium', evidence: markupEvidence(page, `${image.src}${image.alt ? ` (alt: ${image.alt})` : ''}`, `img (${image.region})`, image.region) });
    if (image.alt && page.depth === 0) {
      const altName = image.alt.replace(/\blogo\b/gi, '').replace(/\s{2,}/g, ' ').trim();
      push(nameCandidate(altName, markupEvidence(page, image.alt, `img alt (${image.region})`, image.region), 'markup', 'low', 'logo_alt'));
    }
  }
  return out;
};

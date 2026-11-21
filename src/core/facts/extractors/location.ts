import { jsonLdNodes, jsonLdTypes } from '../../extract/document';
import { blockEvidence, isContentRegion, jsonLdEvidence, normalizeKey, US_STATES } from '../text';
import type { Extractor, FactCandidate, SourcePage } from '../types';

const STREET_SUFFIX =
  '(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Blvd|Boulevard|Dr(?:ive)?|Ln|Lane|Way|Ct|Court|Pl(?:ace)?|Pkwy|Parkway|Hwy|Highway|Cir(?:cle)?|Ter(?:race)?|Trl|Trail|Sq(?:uare)?|Pike|Loop|Row)';
/** "1234 N Main St, Suite 5, Springfield, IL 62701" */
const US_ADDRESS = new RegExp(
  `\\b(\\d{1,6}\\s+(?:[NSEW]\\.?\\s+)?(?:[A-Z0-9][\\w.'-]*\\s+){0,4}${STREET_SUFFIX}\\.?(?:\\s*,?\\s*(?:Suite|Ste\\.?|Unit|Apt\\.?|#)\\s*[\\w-]+)?)\\s*,?\\s+([A-Z][A-Za-z.' -]{1,40}?),?\\s+([A-Z]{2})\\s+(\\d{5})(?:-\\d{4})?\\b`,
  'g',
);
/** "Springfield, IL" / "Springfield, IL 62701" — the state code must be a real US state. */
const CITY_STATE = /\b([A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,3}),\s*([A-Z]{2})\b(?:\s+\d{5})?/g;
const CITY_STOPWORDS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Suite', 'Phone', 'Call', 'Email', 'Hours', 'Open', 'Closed', 'Copyright', 'All']);

const SERVICE_AREA = /\b(serving|we serve|service area|service areas|proudly serv\w*|servicing|located in|based in|conveniently located|areas? we serve|throughout (the )?(greater )?[A-Z])/i;

const DAY = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\\.?';
const HOURS_DAY = new RegExp(`\\b${DAY}\\b`, 'i');
const HOURS_TIME = /\b\d{1,2}(:\d{2})?\s?(am|pm|a\.m\.|p\.m\.)\b|\bnoon\b|\bclosed\b|\b24\/7\b/i;
const BY_APPOINTMENT = /\bby appointment( only)?\b/i;

function addressCandidate(page: SourcePage, parts: { street?: string; city?: string; state?: string; postalCode?: string; country?: string }, evidence: FactCandidate['evidence'], method: FactCandidate['method'], confidence: FactCandidate['confidence']): FactCandidate | null {
  const street = parts.street?.trim();
  const city = parts.city?.trim();
  if (!street && !city) return null;
  const display = [street, [city, [parts.state, parts.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  return {
    type: 'address',
    key: normalizeKey(`${street ?? ''} ${parts.postalCode ?? city ?? ''}`),
    value: { street: street ?? null, city: city ?? null, state: parts.state ?? null, postalCode: parts.postalCode ?? null, country: parts.country ?? null },
    display,
    method,
    confidence,
    evidence,
  };
}

function localityCandidate(city: string, state: string, evidence: FactCandidate['evidence'], method: FactCandidate['method'], confidence: FactCandidate['confidence']): FactCandidate | null {
  const cleanCity = city.trim().replace(/\s+/g, ' ');
  const cleanState = state.trim().toUpperCase();
  if (!cleanCity || CITY_STOPWORDS.has(cleanCity.split(' ')[0] ?? '') || (cleanState.length === 2 && !US_STATES.has(cleanState))) return null;
  return {
    type: 'locality',
    key: normalizeKey(`${cleanCity} ${cleanState}`),
    value: { city: cleanCity, state: cleanState },
    display: `${cleanCity}, ${cleanState}`,
    method,
    confidence,
    evidence,
  };
}

const asText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export const extractLocation: Extractor = (page) => {
  const out: FactCandidate[] = [];
  const push = (candidate: FactCandidate | null) => {
    if (candidate) out.push(candidate);
  };

  // --- structured data
  for (const node of jsonLdNodes(page.doc)) {
    const types = jsonLdTypes(node).join('/');
    const address = node.address;
    if (address && typeof address === 'object' && !Array.isArray(address)) {
      const a = address as Record<string, unknown>;
      const parts = {
        street: asText(a.streetAddress),
        city: asText(a.addressLocality),
        state: asText(a.addressRegion),
        postalCode: asText(a.postalCode),
        country: asText(a.addressCountry) ?? asText((a.addressCountry as Record<string, unknown> | undefined)?.name),
      };
      const snippet = Object.values(parts).filter(Boolean).join(', ');
      push(addressCandidate(page, parts, jsonLdEvidence(page, snippet, `${types}.address`), 'structured_data', 'high'));
      if (parts.city && parts.state) push(localityCandidate(parts.city, parts.state, jsonLdEvidence(page, snippet, `${types}.address`), 'structured_data', 'high'));
    } else if (typeof address === 'string') {
      push(addressCandidate(page, { street: address }, jsonLdEvidence(page, address, `${types}.address`), 'structured_data', 'medium'));
    }

    const areas = Array.isArray(node.areaServed) ? node.areaServed : node.areaServed ? [node.areaServed] : [];
    for (const area of areas.slice(0, 30)) {
      const name = typeof area === 'string' ? area : asText((area as Record<string, unknown>)?.name);
      if (!name) continue;
      out.push({ type: 'service_area', key: normalizeKey(name), value: { text: name, source: 'areaServed' }, display: name, method: 'structured_data', confidence: 'high', evidence: jsonLdEvidence(page, name, `${types}.areaServed`) });
    }

    const hours = Array.isArray(node.openingHours) ? node.openingHours : typeof node.openingHours === 'string' ? [node.openingHours] : [];
    for (const entry of hours.slice(0, 14)) {
      if (typeof entry !== 'string') continue;
      out.push({ type: 'hours', key: normalizeKey(entry), value: { text: entry }, display: entry, method: 'structured_data', confidence: 'high', evidence: jsonLdEvidence(page, entry, `${types}.openingHours`) });
    }
    const specs = Array.isArray(node.openingHoursSpecification) ? node.openingHoursSpecification : node.openingHoursSpecification ? [node.openingHoursSpecification] : [];
    for (const spec of specs.slice(0, 14)) {
      if (!spec || typeof spec !== 'object') continue;
      const s = spec as Record<string, unknown>;
      const days = (Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek]).filter((day): day is string => typeof day === 'string').map((day) => day.replace(/^https?:\/\/schema\.org\//, ''));
      const text = `${days.join(', ')} ${asText(s.opens) ?? ''}–${asText(s.closes) ?? ''}`.trim();
      out.push({ type: 'hours', key: normalizeKey(text), value: { text, days, opens: s.opens ?? null, closes: s.closes ?? null }, display: text, method: 'structured_data', confidence: 'high', evidence: jsonLdEvidence(page, text, `${types}.openingHoursSpecification`) });
    }
  }

  // --- visible text
  for (const block of page.doc.blocks) {
    if (!isContentRegion(block.region)) continue;
    const text = block.text;

    for (const match of text.matchAll(US_ADDRESS)) {
      const [, street, city, state, zip] = match;
      if (!state || !US_STATES.has(state)) continue;
      const evidence = blockEvidence(page, block, match.index, match.index + match[0].length);
      const method = block.tag === 'address' ? 'markup' : 'text_pattern';
      push(addressCandidate(page, { street, city, state, postalCode: zip }, { ...evidence, locator: block.tag === 'address' ? `address element (${block.region})` : evidence.locator }, method, block.tag === 'address' ? 'high' : 'medium'));
    }

    for (const match of text.matchAll(CITY_STATE)) {
      push(localityCandidate(match[1] ?? '', match[2] ?? '', blockEvidence(page, block, match.index, match.index + match[0].length), 'text_pattern', 'medium'));
    }

    const area = SERVICE_AREA.exec(text);
    if (area && text.length <= 600) {
      out.push({
        type: 'service_area',
        key: normalizeKey(text).slice(0, 160),
        value: { text, source: 'statement' },
        display: text.length > 200 ? `${text.slice(0, 197)}…` : text,
        method: 'text_pattern',
        confidence: 'medium',
        evidence: blockEvidence(page, block, area.index, area.index + area[0].length),
      });
    }

    if (text.length <= 300 && ((HOURS_DAY.test(text) && HOURS_TIME.test(text)) || BY_APPOINTMENT.test(text))) {
      out.push({ type: 'hours', key: normalizeKey(text), value: { text }, display: text, method: 'text_pattern', confidence: 'medium', evidence: blockEvidence(page, block) });
    }
  }
  return out;
};

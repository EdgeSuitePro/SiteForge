import { jsonLdNodes, jsonLdTypes } from '../../extract/document';
import { blockEvidence, isContentRegion, jsonLdEvidence, markupEvidence } from '../text';
import type { Extractor, FactCandidate, SourcePage } from '../types';

// ------------------------------------------------------------------------------------- phone

/** North American numbers in text: require parentheses or separators so order numbers don't match. */
const PHONE_TEXT =
  /(?<![\d$])(?:\+?1[\s.-]?)?(?:\(([2-9]\d{2})\)\s?|([2-9]\d{2})[\s.-])([2-9]\d{2})[\s.-](\d{4})(?!\d)/g;

export function normalizePhone(raw: string): { e164: string; display: string } | null {
  const plus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length === 10 && /^[2-9]\d{2}[2-9]/.test(digits)) {
    return { e164: `+1${digits}`, display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` };
  }
  if (plus && digits.length >= 8 && digits.length <= 15) return { e164: `+${digits}`, display: `+${digits}` };
  return null;
}

function phoneCandidate(page: SourcePage, raw: string, evidence: FactCandidate['evidence'], method: FactCandidate['method'], confidence: FactCandidate['confidence']): FactCandidate | null {
  const phone = normalizePhone(raw);
  if (!phone) return null;
  return { type: 'phone', key: phone.e164, value: { e164: phone.e164 }, display: phone.display, method, confidence, evidence };
}

// ------------------------------------------------------------------------------------- email

const EMAIL_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;
const EMAIL_IGNORE = /\.(png|jpe?g|gif|webp|svg)$|@(example\.(com|org)|sentry\.|.*wixpress\.com|.*sentry-next)|^(u003e|x22)/i;

function emailCandidate(raw: string, evidence: FactCandidate['evidence'], method: FactCandidate['method'], confidence: FactCandidate['confidence']): FactCandidate | null {
  const email = raw.trim().toLowerCase().replace(/^mailto:/, '').split('?')[0] ?? '';
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(email) || EMAIL_IGNORE.test(email)) return null;
  return { type: 'email', key: email, value: { email }, display: email, method, confidence, evidence };
}

// ------------------------------------------------------------------------------------- social

const SOCIAL: Array<{ platform: string; label: string; host: RegExp }> = [
  { platform: 'facebook', label: 'Facebook', host: /(^|\.)facebook\.com$|(^|\.)fb\.com$/ },
  { platform: 'instagram', label: 'Instagram', host: /(^|\.)instagram\.com$/ },
  { platform: 'x', label: 'X (Twitter)', host: /(^|\.)(twitter|x)\.com$/ },
  { platform: 'youtube', label: 'YouTube', host: /(^|\.)youtube\.com$|^youtu\.be$/ },
  { platform: 'tiktok', label: 'TikTok', host: /(^|\.)tiktok\.com$/ },
  { platform: 'linkedin', label: 'LinkedIn', host: /(^|\.)linkedin\.com$/ },
  { platform: 'pinterest', label: 'Pinterest', host: /(^|\.)pinterest\.[a-z.]+$/ },
  { platform: 'yelp', label: 'Yelp', host: /(^|\.)yelp\.[a-z.]+$/ },
  { platform: 'nextdoor', label: 'Nextdoor', host: /(^|\.)nextdoor\.com$/ },
  { platform: 'threads', label: 'Threads', host: /(^|\.)threads\.(net|com)$/ },
  { platform: 'google_business', label: 'Google Business Profile', host: /^g\.page$|^maps\.app\.goo\.gl$|^(www\.)?google\.[a-z.]+$/ },
];
const SOCIAL_SHARE = /sharer|share\.php|\/share|intent\/(tweet|post)|\/dialog\/|pin\/create|shareArticle|\/plugins\//i;
/** Builder/vendor profiles that appear in templates, not the business's own profiles. */
const VENDOR_PROFILES = /^\/(wix|squarespace|godaddy|weebly|wordpressdotcom|shopify|elfsight)(\/|$)/i;

function socialCandidate(page: SourcePage, href: string, evidence: FactCandidate['evidence'], method: FactCandidate['method']): FactCandidate | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const match = SOCIAL.find((entry) => entry.host.test(host));
  if (!match) return null;
  if (match.platform === 'google_business' && host.includes('google.') && !/\/maps\b|\/search\b.*\bkgmid\b/.test(url.pathname + url.search)) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (!path && match.platform !== 'google_business') return null;
  if (SOCIAL_SHARE.test(url.pathname + url.search) || VENDOR_PROFILES.test(path)) return null;
  const canonical = `${match.platform}:${host.replace(/^(www|m|mobile)\./, '')}${path.toLowerCase()}`;
  return {
    type: 'social_profile',
    key: canonical,
    value: { platform: match.platform, url: `https://${host}${path}${match.platform === 'google_business' ? url.search : ''}` },
    display: `${match.label}: ${host.replace(/^www\./, '')}${path}`,
    method,
    confidence: 'high',
    evidence,
  };
}

// ------------------------------------------------------------------------------- booking/contact

const BOOKING_PROVIDERS: Array<{ provider: string; label: string; test: RegExp }> = [
  { provider: 'square', label: 'Square Appointments', test: /squareup\.com\/appointments|square\.site|book\.squareup\.com|app\.squareup\.com\/appointments/i },
  { provider: 'setmore', label: 'Setmore', test: /setmore\.com/i },
  { provider: 'calendly', label: 'Calendly', test: /calendly\.com/i },
  { provider: 'acuity', label: 'Acuity Scheduling', test: /acuityscheduling\.com|as\.me\//i },
  { provider: 'vagaro', label: 'Vagaro', test: /vagaro\.com/i },
  { provider: 'booksy', label: 'Booksy', test: /booksy\.com/i },
  { provider: 'simplybook', label: 'SimplyBook.me', test: /simplybook\.(me|it)/i },
  { provider: 'youcanbookme', label: 'YouCanBook.me', test: /youcanbook\.me/i },
  { provider: 'fresha', label: 'Fresha', test: /fresha\.com/i },
  { provider: 'google_calendar', label: 'Google Calendar booking', test: /calendar\.app\.google|calendar\.google\.com\/calendar\/appointments/i },
  { provider: 'wix_bookings', label: 'Wix Bookings', test: /\/book-online|\/booking-calendar/i },
];

function bookingCandidates(page: SourcePage): FactCandidate[] {
  const out: FactCandidate[] = [];
  const sources: Array<{ url: string; locator: string; region: FactCandidate['evidence']['region'] }> = [
    ...page.doc.iframes.map((frame) => ({ url: frame.src, locator: 'iframe embed', region: 'main' as const })),
    ...page.doc.links.filter((link) => link.kind !== 'tel' && link.kind !== 'mailto').map((link) => ({ url: link.href, locator: `link (${link.region})`, region: link.region })),
  ];
  for (const source of sources) {
    const provider = BOOKING_PROVIDERS.find((entry) => entry.test.test(source.url));
    if (!provider) continue;
    if (provider.provider === 'wix_bookings' && !source.url.includes(new URL(page.url).hostname.replace(/^www\./, ''))) continue;
    out.push({
      type: 'booking_provider',
      key: provider.provider,
      value: { provider: provider.provider, url: source.url },
      display: provider.label,
      method: 'markup',
      confidence: 'high',
      evidence: markupEvidence(page, source.url, source.locator, source.region),
    });
  }
  return out;
}

const BOOKING_CTA = /\b(book|schedule|reserve|make an appointment|appointments?)\b/i;
const CALL_OR_TEXT = /\b(call or text|text or call|text us|text me)\b/i;

function contactMethodCandidates(page: SourcePage): FactCandidate[] {
  const out: FactCandidate[] = [];
  const add = (channel: string, display: string, snippet: string, locator: string, region: FactCandidate['evidence']['region']) =>
    out.push({ type: 'contact_method', key: channel, value: { channel }, display, method: 'markup', confidence: 'high', evidence: markupEvidence(page, snippet, locator, region) });

  for (const link of page.doc.links) {
    if (link.kind === 'tel') add('phone_call', 'Phone call (tap-to-call link)', `${link.text || link.href}`, `link tel (${link.region})`, link.region);
    else if (link.kind === 'sms') add('text_message', 'Text message (SMS link)', `${link.text || link.href}`, `link sms (${link.region})`, link.region);
    else if (link.kind === 'mailto') add('email', 'Email link', `${link.text || link.href}`, `link mailto (${link.region})`, link.region);
    else if (link.kind === 'internal' && BOOKING_CTA.test(link.text) && link.text.length <= 60) add('online_booking_link', 'Booking / scheduling link', `${link.text} → ${link.href}`, `link (${link.region})`, link.region);
  }
  for (const form of page.doc.forms) {
    const visibleFields = form.fieldTypes.filter((type) => type !== 'submit' && type !== 'button');
    const isSearch = form.fieldTypes.includes('search') || /search|[?&]s=/.test(form.action ?? '');
    if (isSearch) continue;
    if (form.hasTextarea || (form.hasEmail && visibleFields.length >= 2)) {
      add('contact_form', 'Contact form', `form fields: ${form.fieldTypes.join(', ')}`, `form (${form.region})`, form.region);
    } else if (form.hasEmail && visibleFields.length === 1) {
      add('newsletter', 'Email sign-up form', `form fields: ${form.fieldTypes.join(', ')}`, `form (${form.region})`, form.region);
    }
  }
  for (const block of page.doc.blocks) {
    const match = CALL_OR_TEXT.exec(block.text);
    if (match && isContentRegion(block.region)) {
      out.push({ type: 'contact_method', key: 'text_message', value: { channel: 'text_message' }, display: 'Text message (mentioned)', method: 'text_pattern', confidence: 'medium', evidence: blockEvidence(page, block, match.index, match.index + match[0].length) });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------- extractor

export const extractContact: Extractor = (page) => {
  const out: FactCandidate[] = [];
  const push = (candidate: FactCandidate | null) => {
    if (candidate) out.push(candidate);
  };

  for (const link of page.doc.links) {
    if (link.kind === 'tel') {
      push(phoneCandidate(page, decodeURIComponent(link.href.slice(4)), markupEvidence(page, `${link.text} (${link.href})`.trim(), `link tel (${link.region})`, link.region), 'markup', 'high'));
    } else if (link.kind === 'mailto') {
      push(emailCandidate(decodeURIComponent(link.href), markupEvidence(page, link.href, `link mailto (${link.region})`, link.region), 'markup', 'high'));
    } else if (link.kind === 'external') {
      push(socialCandidate(page, link.href, markupEvidence(page, link.href, `link (${link.region})`, link.region), 'markup'));
    }
  }

  for (const node of jsonLdNodes(page.doc)) {
    const types = jsonLdTypes(node).join('/');
    if (typeof node.telephone === 'string') push(phoneCandidate(page, node.telephone, jsonLdEvidence(page, node.telephone, `${types}.telephone`), 'structured_data', 'high'));
    if (typeof node.email === 'string') push(emailCandidate(node.email, jsonLdEvidence(page, node.email, `${types}.email`), 'structured_data', 'high'));
    const sameAs = Array.isArray(node.sameAs) ? node.sameAs : typeof node.sameAs === 'string' ? [node.sameAs] : [];
    for (const href of sameAs.slice(0, 20)) {
      if (typeof href === 'string') push(socialCandidate(page, href, jsonLdEvidence(page, href, `${types}.sameAs`), 'structured_data'));
    }
  }

  for (const block of page.doc.blocks) {
    if (!isContentRegion(block.region)) continue;
    for (const match of block.text.matchAll(PHONE_TEXT)) {
      push(phoneCandidate(page, match[0], blockEvidence(page, block, match.index, match.index + match[0].length), 'text_pattern', 'medium'));
    }
    for (const match of block.text.matchAll(EMAIL_TEXT)) {
      push(emailCandidate(match[0], blockEvidence(page, block, match.index, match.index + match[0].length), 'text_pattern', 'medium'));
    }
  }

  out.push(...bookingCandidates(page), ...contactMethodCandidates(page));
  return out;
};

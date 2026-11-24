import { PH_CLOSE, PH_OPEN, PH_SEP } from '../concepts/claims';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** Escape text for HTML element content and quoted attribute values. */
export const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"'`]/g, (char) => HTML_ESCAPES[char]!);

/** Only http(s), tel:, sms: and mailto: links, and in-page anchors, are ever rendered. */
export function safeHref(value: string): string | null {
  if (/^#[\w-]+$/.test(value)) return value;
  if (/^(tel|sms):\+?[\d]{6,15}$/.test(value)) return value;
  if (/^mailto:[^\s<>"']+@[^\s<>"']+$/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export type PlaceholderMode = 'show' | 'hide';

/**
 * Render checked concept copy: escape everything, then turn placeholder markers into visible
 * operator notes ("show", internal previews) or remove them ("hide").
 */
export function copy(text: string, mode: PlaceholderMode = 'show'): string {
  const pattern = new RegExp(`${PH_OPEN}([^${PH_SEP}${PH_CLOSE}]*)${PH_SEP}([^${PH_CLOSE}]*)${PH_CLOSE}`, 'g');
  let out = '';
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    out += esc(text.slice(last, match.index));
    if (mode === 'show') {
      const isGap = match[2] === 'missing';
      out += `<mark class="sf-ph${isGap ? ' sf-ph-gap' : ''}" title="Operator note — not shown to customers">${isGap ? '' : 'Removed: '}${esc(match[1])}</mark>`;
    }
    last = match.index + match[0].length;
  }
  out += esc(text.slice(last));
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Embed JSON in a <script type="application/ld+json"> block without allowing it to close the tag. */
export const jsonForScript = (value: unknown) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

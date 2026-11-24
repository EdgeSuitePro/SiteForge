import { byRef, businessName, factsOf, firstOf, services, type FactCatalog } from '../concepts/catalog';
import type { ConceptContent, ConceptSection, CtaIntent, StrategyId } from '../concepts/schema';
import { copy, esc, jsonForScript, safeHref, type PlaceholderMode } from './escape';
import type { DesignTokens } from './tokens';

export interface RenderInput {
  strategy: StrategyId;
  content: ConceptContent;
  catalog: FactCatalog;
  tokens: DesignTokens;
  /** The prospect's current domain, for the "not modified" banner. */
  domain: string;
  placeholders: PlaceholderMode;
}

export type SectionOf<K extends ConceptSection['kind']> = Extract<ConceptSection, { kind: K }>;

export const sectionOf = <K extends ConceptSection['kind']>(content: ConceptContent, kind: K) =>
  content.sections.find((section): section is SectionOf<K> => section.kind === kind) ?? null;

export const t = (input: RenderInput, text: string) => copy(text, input.placeholders);

// ------------------------------------------------------------------------------------------------
// Calls to action: intents resolved from verified facts. "book" without an existing booking system
// points at the EdgeSuite Pro reservation block — the integration this concept is pitching.
// ------------------------------------------------------------------------------------------------

export interface ResolvedCta {
  label: string;
  href: string;
  external: boolean;
}

export function resolveCta(input: RenderInput, intent: CtaIntent): ResolvedCta {
  const phone = firstOf(input.catalog, 'phone');
  const e164 = phone ? String(phone.value.e164 ?? '') : '';
  const email = firstOf(input.catalog, 'email');
  const booking = factsOf(input.catalog, 'booking_provider').map((fact) => safeHref(String(fact.value.url ?? ''))).find(Boolean);
  switch (intent) {
    case 'call':
      return e164 ? { label: `Call ${phone!.display}`, href: safeHref(`tel:${e164}`) ?? '#contact', external: false } : { label: 'Get in touch', href: '#contact', external: false };
    case 'text':
      return e164 ? { label: 'Send a text', href: safeHref(`sms:${e164}`) ?? '#contact', external: false } : { label: 'Get in touch', href: '#contact', external: false };
    case 'email':
      return email ? { label: 'Email us', href: safeHref(`mailto:${String(email.value.email)}`) ?? '#contact', external: false } : { label: 'Get in touch', href: '#contact', external: false };
    case 'book':
      return booking ? { label: 'Book online', href: booking, external: true } : { label: 'Reserve a sharpening', href: '#reserve', external: false };
    case 'drop_off':
      return { label: 'How drop-off works', href: '#how-it-works', external: false };
    case 'mail_in':
      return { label: 'Mail in your knives', href: '#how-it-works', external: false };
    case 'contact':
      return { label: 'Get in touch', href: '#contact', external: false };
  }
}

const SHORT: Partial<Record<CtaIntent, string>> = { call: 'Call', text: 'Text', email: 'Email', book: 'Book', contact: 'Contact' };

export function button(input: RenderInput, intent: CtaIntent, variant: 'primary' | 'secondary' = 'primary', extraClass = '', short = false): string {
  const resolved = resolveCta(input, intent);
  const cta = short && SHORT[intent] ? { ...resolved, label: SHORT[intent]! } : resolved;
  const rel = cta.external ? ' rel="noopener noreferrer nofollow" target="_blank"' : '';
  return `<a class="sf-btn sf-btn-${variant}${extraClass ? ` ${extraClass}` : ''}" href="${esc(cta.href)}"${rel}>${esc(cta.label)}</a>`;
}

// ------------------------------------------------------------------------------------------------
// Fact-driven building blocks (values come from the catalog, never from model copy)
// ------------------------------------------------------------------------------------------------

export const serviceLabel = (input: RenderInput, ref: string) => services(input.catalog).find((service) => service.ref === ref)?.label ?? null;

export function priceRows(input: RenderInput, refs: string[]): string {
  const rows = refs
    .map((ref) => byRef(input.catalog, ref))
    .filter((fact) => fact?.type === 'price')
    .map((fact) => {
      const item = typeof fact!.value.item === 'string' && fact!.value.item ? fact!.value.item : null;
      const amount = typeof fact!.value.amount === 'number' ? `$${fact!.value.amount % 1 ? fact!.value.amount.toFixed(2) : fact!.value.amount}` : '';
      return item
        ? `<tr><th scope="row">${esc(item)}</th><td>${esc(amount)}${fact!.value.unit ? ` ${esc(fact!.value.unit)}` : ''}</td></tr>`
        : `<tr><td colspan="2">${esc(fact!.display)}</td></tr>`;
    });
  return rows.length ? `<table class="sf-prices"><tbody>${rows.join('')}</tbody></table>` : '';
}

export function factList(input: RenderInput, refs: string[]): string[] {
  return refs.map((ref) => byRef(input.catalog, ref)?.display).filter((display): display is string => Boolean(display));
}

export function contactDetails(input: RenderInput): string {
  const phone = firstOf(input.catalog, 'phone');
  const email = firstOf(input.catalog, 'email');
  const address = firstOf(input.catalog, 'address');
  const hours = factsOf(input.catalog, 'hours');
  const rows: string[] = [];
  if (phone) rows.push(`<div><dt>Phone</dt><dd><a href="${esc(safeHref(`tel:${String(phone.value.e164 ?? '')}`) ?? '#')}">${esc(phone.display)}</a></dd></div>`);
  if (email) rows.push(`<div><dt>Email</dt><dd><a href="${esc(safeHref(`mailto:${String(email.value.email)}`) ?? '#')}">${esc(email.display)}</a></dd></div>`);
  if (address) rows.push(`<div><dt>Address</dt><dd>${esc(address.display)}</dd></div>`);
  if (hours.length) rows.push(`<div><dt>Hours</dt><dd>${hours.slice(0, 7).map((hour) => esc(hour.display)).join('<br>')}</dd></div>`);
  if (!rows.length && input.placeholders === 'show') {
    return `<p><mark class="sf-ph sf-ph-gap">Missing: phone, email or address — none were found on the current site</mark></p>`;
  }
  return `<dl class="sf-contact">${rows.join('')}</dl>`;
}

export function reserveBlock(input: RenderInput): string {
  const booking = factsOf(input.catalog, 'booking_provider').length > 0;
  if (booking) return '';
  return `<section id="reserve" class="sf-reserve" aria-label="Reserve a sharpening">
  <div class="sf-wrap"><h2>Reserve a sharpening</h2>
  <p>Customers would choose a service and a drop-off or pickup time here, then get a confirmation and a reminder.</p>
  <p class="sf-note">Powered by EdgeSuite Pro reservations in the live site. Not active in this preview.</p></div>
</section>`;
}

/** schema.org LocalBusiness built only from catalog facts. */
export function jsonLd(input: RenderInput): string {
  const name = businessName(input.catalog);
  if (!name) return '';
  const phone = firstOf(input.catalog, 'phone');
  const email = firstOf(input.catalog, 'email');
  const address = firstOf(input.catalog, 'address');
  const areas = factsOf(input.catalog, 'service_area').map((fact) => fact.display);
  const data: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name };
  if (phone) data.telephone = String(phone.value.e164 ?? phone.display);
  if (email) data.email = String(email.value.email ?? email.display);
  if (address) {
    data.address = {
      '@type': 'PostalAddress',
      ...(address.value.street ? { streetAddress: address.value.street } : {}),
      ...(address.value.city ? { addressLocality: address.value.city } : {}),
      ...(address.value.state ? { addressRegion: address.value.state } : {}),
      ...(address.value.postalCode ? { postalCode: address.value.postalCode } : {}),
    };
  }
  if (areas.length) data.areaServed = areas;
  return `<script type="application/ld+json">${jsonForScript(data)}</script>`;
}

// ------------------------------------------------------------------------------------------------
// Page shell
// ------------------------------------------------------------------------------------------------

export function baseCss(tokens: DesignTokens): string {
  return `:root{--p:${tokens.primary};--on-p:${tokens.onPrimary};--p-ink:${tokens.primaryInk};--bg:${tokens.bg};--surface:${tokens.surface};--ink:${tokens.ink};--muted:${tokens.muted};--line:${tokens.line};--hf:${tokens.headingFont};--bf:${tokens.bodyFont}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 var(--bf)}
h1,h2,h3{font-family:var(--hf);line-height:1.15;margin:0 0 .5em}
p{margin:0 0 1em}
a{color:var(--p-ink)}
img{max-width:100%}
.sf-wrap{max-width:1080px;margin:0 auto;padding:0 20px}
.sf-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 22px;border-radius:10px;font-weight:600;text-decoration:none;border:2px solid var(--p);line-height:1.2}
.sf-btn-primary{background:var(--p);color:var(--on-p)}
.sf-btn-secondary{background:transparent;color:var(--p-ink)}
.sf-btn:focus-visible,a:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.sf-banner{background:#111827;color:#f9fafb;font:13px/1.4 system-ui,sans-serif;padding:8px 20px;text-align:center}
.sf-banner strong{color:#fde68a}
.sf-ph{background:#fef3c7;color:#78350f;border:1px dashed #d97706;border-radius:4px;padding:1px 6px;font:600 13px/1.5 system-ui,sans-serif}
.sf-ph-gap::before{content:"✎ "}
.sf-prices{width:100%;border-collapse:collapse}
.sf-prices th,.sf-prices td{text-align:left;padding:10px 0;border-bottom:1px solid var(--line)}
.sf-prices td:last-child{text-align:right;font-weight:600;white-space:nowrap}
.sf-contact{display:grid;gap:12px;margin:0}
.sf-contact dt{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.sf-contact dd{margin:0;font-weight:600}
.sf-reserve{background:var(--surface);border-top:1px solid var(--line);padding:48px 0}
.sf-note{font-size:14px;color:var(--muted)}
.sf-foot{border-top:1px solid var(--line);padding:24px 0 96px;font-size:14px;color:var(--muted)}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}`;
}

export function banner(input: RenderInput): string {
  return `<div class="sf-banner" role="note"><strong>Private concept preview</strong> by EdgeSuite Pro SiteForge — not the live website. Nothing on ${esc(input.domain)} has been changed.</div>`;
}

export function footer(input: RenderInput): string {
  const name = businessName(input.catalog);
  return `<footer class="sf-foot"><div class="sf-wrap"><p>${name ? `${esc(name)} · ` : ''}Concept preview. Business details are taken from the current website${input.placeholders === 'show' ? '; highlighted notes are for the operator and must be resolved with the owner before anything goes live' : ''}.</p></div></footer>`;
}

export function shell(input: RenderInput, css: string, body: string): { html: string; css: string } {
  const fullCss = `${baseCss(input.tokens)}\n${css}`;
  const title = input.content.seo.title || businessName(input.catalog) || 'Concept preview';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
${input.content.seo.metaDescription ? `<meta name="description" content="${esc(input.content.seo.metaDescription)}">` : ''}
<style>${fullCss}</style>
${jsonLd(input)}
</head>
<body>
${banner(input)}
${body}
${footer(input)}
</body>
</html>`;
  return { html, css: fullCss };
}

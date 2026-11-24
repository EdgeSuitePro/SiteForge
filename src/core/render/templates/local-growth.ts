import { businessName, city, factsOf, firstOf } from '../../concepts/catalog';
import type { ConceptSection } from '../../concepts/schema';
import { esc, safeHref } from '../escape';
import { button, contactDetails, factList, priceRows, reserveBlock, serviceLabel, shell, t, type RenderInput } from '../shared';

/** Concept A — Local Growth: place-first, scannable, trust high up, contact everywhere. */

const CSS = `
.lg-top{background:var(--p);color:var(--on-p);font-size:14px}
.lg-top .sf-wrap{display:flex;justify-content:space-between;gap:12px;padding-top:8px;padding-bottom:8px;flex-wrap:wrap}
.lg-top a{color:var(--on-p);font-weight:700}
.lg-head{border-bottom:1px solid var(--line);background:var(--bg)}
.lg-head .sf-wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:68px}
.lg-name{font:700 20px/1.2 var(--hf)}
.lg-nav{display:none;gap:20px;font-size:15px}
.lg-nav a{color:var(--ink);text-decoration:none}
.lg-hero{background:linear-gradient(180deg,var(--surface),var(--bg));padding:48px 0}
.lg-hero .sf-wrap{display:grid;gap:28px}
.lg-eyebrow{display:inline-block;font-weight:700;font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--p-ink);margin-bottom:12px}
.lg-hero h1{font-size:clamp(32px,6vw,52px)}
.lg-hero p{font-size:19px;color:var(--muted);max-width:40em}
.lg-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px}
.lg-card{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:20px;box-shadow:0 6px 24px rgba(15,23,42,.06)}
.lg-card h2{font-size:16px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.lg-gap{margin-top:16px}
.lg-chips{display:flex;flex-wrap:wrap;align-items:flex-start;align-content:flex-start;gap:8px;list-style:none;padding:0;margin:0}
.lg-chips li{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-weight:600}
.lg-sec{padding:56px 0}
.lg-sec:nth-of-type(even){background:var(--surface)}
.lg-sec h2{font-size:clamp(26px,4vw,36px)}
.lg-lede{color:var(--muted);max-width:44em}
.lg-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));margin-top:24px}
.lg-svc{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:20px;border-top:4px solid var(--p)}
.lg-svc h3{font-size:19px}
.lg-svc p{color:var(--muted);margin:0}
.lg-steps{counter-reset:s;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));list-style:none;padding:0;margin:24px 0 0}
.lg-steps li{counter-increment:s;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:20px}
.lg-steps li::before{content:counter(s);display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--p);color:var(--on-p);font-weight:700;margin-bottom:12px}
.lg-faq details{border-bottom:1px solid var(--line);padding:14px 0}
.lg-faq summary{font-weight:600;cursor:pointer}
.lg-two{display:grid;gap:32px}
.lg-band{background:var(--p);color:var(--on-p);padding:48px 0;text-align:center}
.lg-band .sf-btn-primary{background:var(--on-p);color:var(--p);border-color:var(--on-p)}
@media(min-width:860px){.lg-nav{display:flex}.lg-hero .sf-wrap{grid-template-columns:1.4fr 1fr;align-items:center}.lg-two{grid-template-columns:1fr 1fr}}
`;

function section(input: RenderInput, section: ConceptSection): string {
  switch (section.kind) {
    case 'services': {
      const cards = section.items
        .map((item) => {
          const label = serviceLabel(input, item.ref);
          return label ? `<article class="lg-svc"><h3>${esc(label)}</h3>${item.blurb ? `<p>${t(input, item.blurb)}</p>` : ''}</article>` : '';
        })
        .join('');
      return `<section class="lg-sec" id="services"><div class="sf-wrap"><h2>${t(input, section.heading)}</h2>${section.intro ? `<p class="lg-lede">${t(input, section.intro)}</p>` : ''}<div class="lg-grid">${cards}</div></div></section>`;
    }
    case 'service_area': {
      const places = factList(input, section.refs);
      return `<section class="lg-sec" id="area"><div class="sf-wrap lg-two"><div><h2>${t(input, section.heading)}</h2><p class="lg-lede">${t(input, section.body)}</p></div>${places.length ? `<ul class="lg-chips" aria-label="Areas served">${places.map((place) => `<li>${esc(place)}</li>`).join('')}</ul>` : ''}</div></section>`;
    }
    case 'trust': {
      const items = factList(input, section.refs);
      return `<section class="lg-sec" id="reviews"><div class="sf-wrap"><h2>${t(input, section.heading)}</h2><p class="lg-lede">${t(input, section.body)}</p>${items.length ? `<ul class="lg-chips">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}</div></section>`;
    }
    case 'process':
      return `<section class="lg-sec" id="how-it-works"><div class="sf-wrap"><h2>${t(input, section.heading)}</h2>${section.intro ? `<p class="lg-lede">${t(input, section.intro)}</p>` : ''}<ol class="lg-steps">${section.steps.map((step) => `<li><h3>${t(input, step.title)}</h3><p>${t(input, step.body)}</p></li>`).join('')}</ol></div></section>`;
    case 'pricing':
      return `<section class="lg-sec" id="pricing"><div class="sf-wrap"><h2>${t(input, section.heading)}</h2>${section.intro ? `<p class="lg-lede">${t(input, section.intro)}</p>` : ''}${priceRows(input, section.refs)}</div></section>`;
    case 'about':
      return `<section class="lg-sec" id="about"><div class="sf-wrap"><h2>${t(input, section.heading)}</h2><p class="lg-lede">${t(input, section.body)}</p></div></section>`;
    case 'faq':
      return `<section class="lg-sec lg-faq" id="faq"><div class="sf-wrap"><h2>${t(input, section.heading)}</h2>${section.items.map((item) => `<details><summary>${t(input, item.question)}</summary><p>${t(input, item.answer)}</p></details>`).join('')}</div></section>`;
    case 'contact':
      return `<section class="lg-sec" id="contact"><div class="sf-wrap lg-two"><div><h2>${t(input, section.heading)}</h2><p class="lg-lede">${t(input, section.body)}</p><div class="lg-actions">${button(input, input.content.hero.primaryCta)}</div></div><div class="lg-card">${contactDetails(input)}</div></div></section>`;
    case 'cta_band':
      return `<section class="lg-band"><div class="sf-wrap"><h2>${t(input, section.heading)}</h2><p>${t(input, section.body)}</p>${button(input, section.cta)}</div></section>`;
  }
}

export function renderLocalGrowth(input: RenderInput) {
  const { hero } = input.content;
  const name = businessName(input.catalog);
  const place = city(input.catalog);
  const phone = firstOf(input.catalog, 'phone');
  const areas = factsOf(input.catalog, 'service_area').map((fact) => fact.display);
  const hours = factsOf(input.catalog, 'hours').map((fact) => fact.display);
  const tel = phone ? safeHref(`tel:${String(phone.value.e164 ?? '')}`) : null;
  const nav = input.content.sections
    .map((s) => ({ services: ['services', 'Services'], service_area: ['area', 'Area'], process: ['how-it-works', 'How it works'], pricing: ['pricing', 'Prices'], contact: ['contact', 'Contact'] })[s.kind as string] as [string, string] | undefined)
    .filter(Boolean)
    .map((entry) => `<a href="#${entry![0]}">${entry![1]}</a>`)
    .join('');
  const quick = [
    place ? `<li><strong>${esc(place.city)}${place.state ? `, ${esc(place.state)}` : ''}</strong></li>` : '',
    ...areas.slice(0, 4).map((area) => `<li>${esc(area)}</li>`),
  ].join('');

  const body = `
${place || tel ? `<div class="lg-top"><div class="sf-wrap"><span>${place ? `Serving ${esc(place.city)}${place.state ? `, ${esc(place.state)}` : ''}` : ''}</span>${tel ? `<a href="${esc(tel)}">${esc(phone!.display)}</a>` : ''}</div></div>` : ''}
<header class="lg-head"><div class="sf-wrap"><span class="lg-name">${esc(name ?? 'Knife sharpening')}</span><nav class="lg-nav" aria-label="Sections">${nav}</nav>${button(input, hero.primaryCta, 'primary', '', true)}</div></header>
<main>
<section class="lg-hero"><div class="sf-wrap"><div>${hero.eyebrow ? `<span class="lg-eyebrow">${t(input, hero.eyebrow)}</span>` : ''}<h1>${t(input, hero.headline)}</h1><p>${t(input, hero.subheadline)}</p><div class="lg-actions">${button(input, hero.primaryCta)}${hero.secondaryCta ? button(input, hero.secondaryCta, 'secondary') : ''}</div></div>
${quick || hours.length ? `<aside class="lg-card" aria-label="At a glance">${quick ? `<h2>Where we work</h2><ul class="lg-chips">${quick}</ul>` : ''}${hours.length ? `<h2 class="lg-gap">Hours</h2><p>${hours.slice(0, 4).map(esc).join('<br>')}</p>` : ''}</aside>` : ''}</div></section>
${input.content.sections.map((entry) => section(input, entry)).join('\n')}
${input.content.sections.some((entry) => entry.kind === 'contact') ? '' : `<section class="lg-sec" id="contact"><div class="sf-wrap"><h2>Contact</h2>${contactDetails(input)}</div></section>`}
${reserveBlock(input)}
</main>`;
  return shell(input, CSS, body);
}

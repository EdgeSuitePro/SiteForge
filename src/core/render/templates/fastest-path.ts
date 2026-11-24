import { businessName } from '../../concepts/catalog';
import type { ConceptSection, CtaIntent } from '../../concepts/schema';
import { esc } from '../escape';
import { button, contactDetails, priceRows, reserveBlock, serviceLabel, shell, t, type RenderInput } from '../shared';
import { availableCtas } from '../../concepts/claims';

/** Concept C — Fastest Path: one column, action first, a sticky action bar on phones. */

const CSS = `
.fp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
.fp-name{font:800 18px/1.2 var(--hf)}
.fp-main{max-width:640px;margin:0 auto;padding:0 20px}
.fp-hero{padding:36px 0 28px}
.fp-eyebrow{font-size:14px;font-weight:700;color:var(--p-ink)}
.fp-hero h1{font-size:clamp(34px,8vw,48px);font-weight:800;letter-spacing:-.02em;margin-top:6px}
.fp-hero p{font-size:19px;color:var(--muted)}
.fp-stack{display:grid;gap:10px;margin-top:20px}
.fp-stack .sf-btn{width:100%;font-size:18px;min-height:56px}
.fp-sec{padding:28px 0;border-top:1px solid var(--line)}
.fp-sec h2{font-size:24px;font-weight:800}
.fp-sec p{color:var(--muted)}
.fp-check{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.fp-check li{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:var(--surface);border-radius:10px;font-weight:600}
.fp-check li::before{content:"✓";color:var(--p-ink);font-weight:800}
.fp-steps{list-style:none;padding:0;margin:0;counter-reset:s;display:grid;gap:14px}
.fp-steps li{counter-increment:s;display:grid;grid-template-columns:40px 1fr;gap:2px 12px}
.fp-steps li::before{content:counter(s);grid-row:span 2;display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--p);color:var(--on-p);font-weight:800}
.fp-steps h3{font-size:18px;margin:6px 0 0}
.fp-steps p{margin:0}
.fp-band{background:var(--surface);border-radius:16px;padding:24px;margin:28px 0;text-align:center}
.fp-faq details{border-bottom:1px solid var(--line);padding:12px 0}
.fp-faq summary{font-weight:700;cursor:pointer}
.fp-bar{position:fixed;left:0;right:0;bottom:0;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:var(--bg);border-top:1px solid var(--line);box-shadow:0 -6px 20px rgba(0,0,0,.08);z-index:10}
.fp-bar .sf-btn{min-height:50px;padding:10px;font-size:16px}
@media(min-width:900px){.fp-bar{display:none}}
`;

function section(input: RenderInput, section: ConceptSection): string {
  switch (section.kind) {
    case 'services':
      return `<section class="fp-sec" id="services"><h2>${t(input, section.heading)}</h2>${section.intro ? `<p>${t(input, section.intro)}</p>` : ''}<ul class="fp-check">${section.items
        .map((item) => {
          const label = serviceLabel(input, item.ref);
          return label ? `<li>${esc(label)}</li>` : '';
        })
        .join('')}</ul></section>`;
    case 'pricing':
      return `<section class="fp-sec" id="pricing"><h2>${t(input, section.heading)}</h2>${section.intro ? `<p>${t(input, section.intro)}</p>` : ''}${priceRows(input, section.refs)}</section>`;
    case 'process':
      return `<section class="fp-sec" id="how-it-works"><h2>${t(input, section.heading)}</h2>${section.intro ? `<p>${t(input, section.intro)}</p>` : ''}<ol class="fp-steps">${section.steps.map((step) => `<li><h3>${t(input, step.title)}</h3><p>${t(input, step.body)}</p></li>`).join('')}</ol></section>`;
    case 'cta_band':
      return `<div class="fp-band"><h2>${t(input, section.heading)}</h2><p>${t(input, section.body)}</p>${button(input, section.cta)}</div>`;
    case 'faq':
      return `<section class="fp-sec fp-faq" id="faq"><h2>${t(input, section.heading)}</h2>${section.items.map((item) => `<details><summary>${t(input, item.question)}</summary><p>${t(input, item.answer)}</p></details>`).join('')}</section>`;
    case 'contact':
      return `<section class="fp-sec" id="contact"><h2>${t(input, section.heading)}</h2><p>${t(input, section.body)}</p>${contactDetails(input)}</section>`;
    case 'service_area':
    case 'trust':
    case 'about':
      return `<section class="fp-sec" id="${section.kind === 'service_area' ? 'area' : section.kind}"><h2>${t(input, section.heading)}</h2><p>${t(input, section.body)}</p></section>`;
  }
}

export function renderFastestPath(input: RenderInput) {
  const { hero } = input.content;
  const name = businessName(input.catalog);
  const ctas = availableCtas(input.catalog);
  const barIntents = (['call', 'text', 'book'] as CtaIntent[]).filter((intent) => ctas.has(intent)).slice(0, 2);
  if (!barIntents.length) barIntents.push('contact');
  const hasContact = input.content.sections.some((entry) => entry.kind === 'contact');
  const body = `
<header class="fp-head"><span class="fp-name">${esc(name ?? 'Sharpening')}</span>${button(input, hero.primaryCta, 'secondary', '', true)}</header>
<main class="fp-main">
<section class="fp-hero">${hero.eyebrow ? `<span class="fp-eyebrow">${t(input, hero.eyebrow)}</span>` : ''}<h1>${t(input, hero.headline)}</h1><p>${t(input, hero.subheadline)}</p><div class="fp-stack">${button(input, hero.primaryCta)}${hero.secondaryCta ? button(input, hero.secondaryCta, 'secondary') : ''}</div></section>
${input.content.sections.map((entry) => section(input, entry)).join('\n')}
${hasContact ? '' : `<section class="fp-sec" id="contact"><h2>Contact</h2>${contactDetails(input)}</section>`}
</main>
${reserveBlock(input)}
<nav class="fp-bar" aria-label="Quick actions">${barIntents.map((intent, index) => button(input, intent, index === 0 ? 'primary' : 'secondary')).join('')}</nav>`;
  return shell(input, CSS, body);
}

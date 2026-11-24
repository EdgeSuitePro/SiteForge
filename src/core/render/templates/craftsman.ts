import { businessName, firstOf } from '../../concepts/catalog';
import type { ConceptSection } from '../../concepts/schema';
import { PH_OPEN } from '../../concepts/claims';
import { esc } from '../escape';
import { button, contactDetails, factList, priceRows, reserveBlock, serviceLabel, shell, t, type RenderInput } from '../shared';

/** Concept B — Craftsman / Premium: editorial, unhurried, story and process first. */

const CSS = `
body{font-size:18px}
.cr-head{padding:28px 0;text-align:center;border-bottom:1px solid var(--line)}
.cr-name{font:400 clamp(22px,3vw,28px)/1.2 var(--hf);letter-spacing:.14em;text-transform:uppercase}
.cr-hero{padding:clamp(56px,10vw,120px) 0;text-align:center}
.cr-hero .sf-wrap{max-width:820px}
.cr-eyebrow{font:600 13px/1 system-ui,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:var(--p-ink)}
.cr-hero h1{font-size:clamp(38px,7vw,68px);font-weight:400;margin:18px 0 22px}
.cr-rule{width:64px;height:2px;background:var(--p);margin:0 auto 24px;border:0}
.cr-hero p{font-size:20px;color:var(--muted);font-style:italic}
.cr-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:14px;margin-top:28px}
.cr-sec{padding:72px 0;border-top:1px solid var(--line)}
.cr-sec .sf-wrap{max-width:900px}
.cr-sec h2{font-size:clamp(28px,4vw,40px);font-weight:400}
.cr-kicker{font:600 12px/1 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-bottom:14px;display:block}
.cr-about{display:grid;gap:32px}
.cr-lead::first-letter{float:left;font:400 64px/.8 var(--hf);padding:6px 10px 0 0;color:var(--p-ink)}
.cr-aside{border-left:2px solid var(--p);padding-left:20px;color:var(--muted)}
.cr-steps{list-style:none;padding:0;margin:32px 0 0;counter-reset:s}
.cr-steps li{counter-increment:s;display:grid;grid-template-columns:72px 1fr;gap:8px 20px;padding:22px 0;border-bottom:1px solid var(--line)}
.cr-steps li::before{content:counter(s,decimal-leading-zero);font:400 40px/1 var(--hf);color:var(--p-ink);grid-row:span 2}
.cr-steps h3{font-size:22px;font-weight:400;margin:0}
.cr-steps p{margin:0;color:var(--muted)}
.cr-list{list-style:none;padding:0;margin:28px 0 0}
.cr-list li{display:flex;gap:16px;align-items:baseline;padding:16px 0;border-bottom:1px dotted var(--line)}
.cr-list strong{font:400 21px/1.3 var(--hf);flex:0 0 auto;max-width:55%}
.cr-list span{color:var(--muted);font-size:16px}
.cr-trust{background:var(--surface)}
.cr-band{background:var(--p);color:var(--on-p);padding:80px 0;text-align:center}
.cr-band h2{font-weight:400;font-size:clamp(30px,5vw,46px)}
.cr-band .sf-btn-primary{background:var(--on-p);color:var(--p);border-color:var(--on-p)}
.cr-faq details{border-bottom:1px solid var(--line);padding:16px 0}
.cr-faq summary{font:400 20px/1.3 var(--hf);cursor:pointer}
@media(min-width:860px){.cr-about{grid-template-columns:2fr 1fr}}
`;

function section(input: RenderInput, section: ConceptSection): string {
  switch (section.kind) {
    case 'about': {
      const facts = factList(input, section.refs);
      return `<section class="cr-sec" id="about"><div class="sf-wrap"><span class="cr-kicker">The shop</span><h2>${t(input, section.heading)}</h2><div class="cr-about"><div><p${section.body.startsWith(PH_OPEN) ? '' : ' class="cr-lead"'}>${t(input, section.body)}</p></div>${facts.length ? `<aside class="cr-aside">${facts.map((fact) => `<p>${esc(fact)}</p>`).join('')}</aside>` : ''}</div></div></section>`;
    }
    case 'process':
      return `<section class="cr-sec" id="how-it-works"><div class="sf-wrap"><span class="cr-kicker">Process</span><h2>${t(input, section.heading)}</h2>${section.intro ? `<p>${t(input, section.intro)}</p>` : ''}<ol class="cr-steps">${section.steps.map((step) => `<li><h3>${t(input, step.title)}</h3><p>${t(input, step.body)}</p></li>`).join('')}</ol></div></section>`;
    case 'services':
      return `<section class="cr-sec" id="services"><div class="sf-wrap"><span class="cr-kicker">Services</span><h2>${t(input, section.heading)}</h2>${section.intro ? `<p>${t(input, section.intro)}</p>` : ''}<ul class="cr-list">${section.items
        .map((item) => {
          const label = serviceLabel(input, item.ref);
          return label ? `<li><strong>${esc(label)}</strong>${item.blurb ? `<span>${t(input, item.blurb)}</span>` : ''}</li>` : '';
        })
        .join('')}</ul></div></section>`;
    case 'pricing':
      return `<section class="cr-sec" id="pricing"><div class="sf-wrap"><span class="cr-kicker">Pricing</span><h2>${t(input, section.heading)}</h2>${section.intro ? `<p>${t(input, section.intro)}</p>` : ''}${priceRows(input, section.refs)}</div></section>`;
    case 'trust': {
      const facts = factList(input, section.refs);
      return `<section class="cr-sec cr-trust" id="reviews"><div class="sf-wrap"><span class="cr-kicker">Trust</span><h2>${t(input, section.heading)}</h2><p>${t(input, section.body)}</p>${facts.map((fact) => `<p class="cr-aside">${esc(fact)}</p>`).join('')}</div></section>`;
    }
    case 'service_area':
      return `<section class="cr-sec" id="area"><div class="sf-wrap"><span class="cr-kicker">Where</span><h2>${t(input, section.heading)}</h2><p>${t(input, section.body)}</p><p class="cr-aside">${factList(input, section.refs).map(esc).join(' · ')}</p></div></section>`;
    case 'faq':
      return `<section class="cr-sec cr-faq" id="faq"><div class="sf-wrap"><span class="cr-kicker">Questions</span><h2>${t(input, section.heading)}</h2>${section.items.map((item) => `<details><summary>${t(input, item.question)}</summary><p>${t(input, item.answer)}</p></details>`).join('')}</div></section>`;
    case 'contact':
      return `<section class="cr-sec" id="contact"><div class="sf-wrap"><span class="cr-kicker">Visit</span><h2>${t(input, section.heading)}</h2><p>${t(input, section.body)}</p>${contactDetails(input)}</div></section>`;
    case 'cta_band':
      return `<section class="cr-band"><div class="sf-wrap"><h2>${t(input, section.heading)}</h2><p>${t(input, section.body)}</p><div class="cr-actions">${button(input, section.cta)}</div></div></section>`;
  }
}

export function renderCraftsman(input: RenderInput) {
  const { hero } = input.content;
  const name = businessName(input.catalog);
  const hasContact = input.content.sections.some((entry) => entry.kind === 'contact');
  const body = `
<header class="cr-head"><div class="sf-wrap"><span class="cr-name">${esc(name ?? 'Sharpening')}</span></div></header>
<main>
<section class="cr-hero"><div class="sf-wrap">${hero.eyebrow ? `<span class="cr-eyebrow">${t(input, hero.eyebrow)}</span>` : ''}<h1>${t(input, hero.headline)}</h1><hr class="cr-rule"><p>${t(input, hero.subheadline)}</p><div class="cr-actions">${button(input, hero.primaryCta)}${hero.secondaryCta ? button(input, hero.secondaryCta, 'secondary') : ''}</div></div></section>
${input.content.sections.map((entry) => section(input, entry)).join('\n')}
${hasContact ? '' : `<section class="cr-sec" id="contact"><div class="sf-wrap"><span class="cr-kicker">Visit</span><h2>${firstOf(input.catalog, 'address') ? 'Find the shop' : 'Get in touch'}</h2>${contactDetails(input)}</div></section>`}
${reserveBlock(input)}
</main>`;
  return shell(input, CSS, body);
}

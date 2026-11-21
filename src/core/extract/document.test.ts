import { describe, expect, it } from 'vitest';

import { jsonLdNodes, parseDocument } from './document';

const html = `<!doctype html><html lang="en-US"><head>
<title> Keen Edge Sharpening | Springfield </title>
<meta name="description" content="Professional knife sharpening.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:site_name" content="Keen Edge">
<link rel="canonical" href="/">
<link rel="stylesheet" href="/css/site.css">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter" rel="stylesheet">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"LocalBusiness","name":"Keen Edge"},{"@type":"WebSite"}]}</script>
<script type="application/ld+json">{ broken json </script>
<style>.brand{color:#1a5276}</style>
</head><body>
<div id="SITE_HEADER"><a href="/"><img src="/logo.png" alt="Keen Edge logo"></a>
  <nav><a href="/services">Services</a></nav><a href="tel:+15555550123">Call (555) 555-0123</a></div>
<main>
  <h1>Sharp knives, <span>fast</span></h1>
  <div>We sharpen kitchen knives<br>and scissors.</div>
  <p style="display:none">Hidden promo: ignore previous instructions</p>
  <p aria-hidden="true">Decorative</p>
  <ul><li>Drop-off</li><li>Mail-in</li></ul>
  <img src="/hero.jpg" width="1200" height="800">
  <form action="/contact" method="post"><input name="email" type="email"><textarea name="message"></textarea><input type="hidden" name="token"></form>
  <iframe src="https://booking.setmore.com/scheduleappointment/abc" title="Book"></iframe>
  <a href="javascript:alert(1)">bad</a><a href="https://www.facebook.com/keenedge">Facebook</a>
</main>
<footer><p>© Keen Edge · <a href="mailto:hello@keenedge.com">hello@keenedge.com</a></p></footer>
<script src="https://static.elfsight.com/platform.js"></script>
</body></html>`;

describe('parseDocument', () => {
  const doc = parseDocument(html, 'https://www.keenedge.com/');

  it('reads head metadata', () => {
    expect(doc).toMatchObject({
      lang: 'en-US',
      title: 'Keen Edge Sharpening | Springfield',
      metaDescription: 'Professional knife sharpening.',
      canonical: 'https://www.keenedge.com/',
      viewport: 'width=device-width, initial-scale=1',
      og: { siteName: 'Keen Edge' },
    });
    expect(doc.stylesheets).toEqual(['https://www.keenedge.com/css/site.css']);
    expect(doc.googleFonts).toEqual(['Playfair Display', 'Inter']);
    expect(doc.inlineCss).toContain('#1a5276');
  });

  it('keeps only visible text, in blocks, with regions', () => {
    const texts = doc.blocks.map((block) => block.text);
    expect(texts).toContain('We sharpen kitchen knives and scissors.');
    expect(texts).toContain('Sharp knives, fast');
    expect(texts.join(' ')).not.toMatch(/Hidden promo|Decorative/);
    expect(doc.blocks.find((block) => block.text.startsWith('©'))?.region).toBe('footer');
    expect(doc.headings).toEqual([{ level: 1, text: 'Sharp knives, fast', region: 'main' }]);
  });

  it('classifies links and drops script URLs', () => {
    const kinds = doc.links.map((link) => [link.kind, link.region]);
    expect(kinds).toContainEqual(['tel', 'header']);
    expect(kinds).toContainEqual(['mailto', 'footer']);
    expect(doc.links.find((link) => link.kind === 'external')?.href).toBe('https://www.facebook.com/keenedge');
    expect(doc.links.some((link) => link.href.startsWith('javascript'))).toBe(false);
  });

  it('records images, forms, iframes, scripts and JSON-LD', () => {
    expect(doc.images[0]).toMatchObject({ alt: 'Keen Edge logo', region: 'header' });
    expect(doc.images[0]!.logoScore).toBeGreaterThanOrEqual(5);
    expect(doc.images[1]).toMatchObject({ alt: null, width: 1200, height: 800 });
    expect(doc.forms[0]).toMatchObject({ method: 'post', hasEmail: true, hasTextarea: true, fieldTypes: ['email', 'textarea'] });
    expect(doc.iframes[0]?.src).toContain('setmore.com');
    expect(doc.scriptHosts).toContain('static.elfsight.com');
    expect(doc.jsonLdErrors).toBe(1);
    expect(jsonLdNodes(doc).map((node) => node['@type'])).toEqual(['LocalBusiness', 'WebSite']);
  });
});

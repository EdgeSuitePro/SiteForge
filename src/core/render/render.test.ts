import { describe, expect, it } from 'vitest';

import { checkConcept } from '../concepts/claims';
import { draftConcept } from '../concepts/draft';
import { STRATEGIES } from '../concepts/schema';
import { testCatalog } from '../concepts/test-catalog';
import { copy, esc, safeHref } from './escape';
import { designTokens, renderConcept } from './index';
import { contrast } from './tokens';

const brand = { version: 'brand@1', colors: [], brandColors: ['#f5c542'], neutrals: [], fonts: ['Lora'], themeColor: null };

function render(strategy: (typeof STRATEGIES)[number], catalog = testCatalog(), placeholders: 'show' | 'hide' = 'show') {
  const { content } = checkConcept(draftConcept(strategy, catalog), catalog, { strategy });
  return renderConcept({ strategy, content, catalog, tokens: designTokens(strategy, brand), domain: 'edgeworks.test', placeholders }).html;
}

describe('renderers', () => {
  for (const strategy of STRATEGIES) {
    it(`${strategy}: complete, private, script-free page`, () => {
      const html = render(strategy);
      expect(html).toMatch(/^<!doctype html>/);
      expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive">');
      expect(html).toContain('Nothing on edgeworks.test has been changed');
      expect(html).toContain('<meta name="viewport"');
      // The only <script> is inert JSON-LD data.
      expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script type="application/ld+json">']);
      expect(html).not.toMatch(/\son\w+=/i); // no inline event handlers
      expect(html).not.toMatch(/style="/); // no inline style attributes (CSP hashes the single <style>)
      expect(html).not.toMatch(/<(img|iframe|link|object|embed)\b/i); // no external resources
      expect(html).toContain('href="tel:+12175550142"');
      expect(html).toContain('Kitchen knife sharpening');
    });

    it(`${strategy}: deterministic`, () => {
      expect(render(strategy)).toBe(render(strategy));
    });
  }

  it('produces three different pages', () => {
    const pages = STRATEGIES.map((strategy) => render(strategy).replace(/<style>[\s\S]*?<\/style>/, ''));
    expect(new Set(pages).size).toBe(3);
    expect(pages[0]).toContain('lg-hero');
    expect(pages[1]).toContain('cr-hero');
    expect(pages[2]).toContain('fp-bar');
  });

  it('escapes hostile fact values', () => {
    const catalog = testCatalog();
    catalog.facts[0]!.display = '<script>alert(1)</script>"><img src=x onerror=alert(1)>';
    const html = render('local_growth', catalog);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('shows operator placeholders internally and hides them for customer-facing renders', () => {
    const empty = { facts: [] };
    expect(render('craftsman', empty, 'show')).toContain('class="sf-ph');
    expect(render('craftsman', empty, 'hide')).not.toContain('sf-ph"');
  });

  it('makes brand colours accessible', () => {
    const tokens = designTokens('local_growth', brand); // a light yellow brand colour
    expect(contrast(tokens.primary, tokens.onPrimary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.primaryInk, tokens.bg)).toBeGreaterThanOrEqual(4.5);
    expect(tokens.headingFont.startsWith('"Lora"')).toBe(true);
  });
});

describe('escaping helpers', () => {
  it('escapes and filters links', () => {
    expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('tel:+12175550142')).toBe('tel:+12175550142');
    expect(safeHref('https://book.example/x')).toBe('https://book.example/x');
  });

  it('renders placeholder markers safely', () => {
    expect(copy('Hi <b>x</b> there')).toBe('Hi <mark class="sf-ph" title="Operator note — not shown to customers">Removed: &lt;b&gt;x&lt;/b&gt;</mark> there');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startFixtureServer, testFetchPolicy, text, type FixtureServer } from '../../../tests/support/fixture-server';
import { createSafeFetcher, type SafeFetcher } from '../crawl/fetcher';
import { analyzeBrand, isNeutral, parseColor } from './brand';
import { fetchStylesheets } from './stylesheets';

describe('parseColor', () => {
  it.each([
    ['#ABC', '#aabbcc'],
    ['#1a5276', '#1a5276'],
    ['rgb(26, 82, 118)', '#1a5276'],
    ['rgba(26 82 118 / 50%)', '#1a5276'],
    ['rgba(0,0,0,0)', null],
    ['tomato', null],
  ])('%s → %s', (input, expected) => expect(parseColor(input)).toBe(expected));
});

describe('analyzeBrand', () => {
  const brand = analyzeBrand({
    sources: [
      { css: ':root{--brand-primary:#b8541c;--text:#222222} body{font-family:"Inter",system-ui,sans-serif;color:#222;background:#fff}', weight: 3 },
      { css: '.btn{background:#b8541c;color:#ffffff} h1{font-family:"Playfair Display",Georgia,serif} .icon{font-family:"Font Awesome 6 Free"} a{color:rgb(31,95,74)}', weight: 1 },
    ],
    themeColors: ['#1f5f4a'],
    googleFonts: ['Playfair Display'],
  });

  it('ranks named brand variables and theme-color as brand colours', () => {
    expect(brand.brandColors.slice(0, 2).sort()).toEqual(['#1f5f4a', '#b8541c']);
    expect(brand.themeColor).toBe('#1f5f4a');
    expect(brand.colors.find((color) => color.hex === '#b8541c')?.named).toBe(true);
  });

  it('separates neutrals', () => {
    expect(brand.neutrals).toEqual(expect.arrayContaining(['#222222', '#ffffff']));
    expect(isNeutral('#808080')).toBe(true);
    expect(isNeutral('#b8541c')).toBe(false);
  });

  it('keeps real fonts and drops generic and icon fonts', () => {
    expect(brand.fonts).toEqual(['Playfair Display', 'Inter']);
  });
});

describe('fetchStylesheets', () => {
  let server: FixtureServer;
  let fetcher: SafeFetcher;
  beforeAll(async () => {
    server = await startFixtureServer({
      '/site.css': text(200, ':root{--brand:#b8541c}', 'text/css'),
      '/not-css': text(200, '<html>', 'text/html'),
      '/bootstrap.min.css': text(200, '.x{color:#0d6efd}', 'text/css'),
    });
    fetcher = createSafeFetcher(testFetchPolicy);
  });
  afterAll(async () => {
    await fetcher.close();
    await server.close();
  });

  it('fetches brand stylesheets, skips framework sheets and non-CSS, and refuses private hosts', async () => {
    const sheets = await fetchStylesheets(fetcher, [
      `${server.origin()}/site.css`,
      `${server.origin()}/site.css`,
      `${server.origin()}/not-css`,
      `${server.origin()}/bootstrap.min.css`,
      `http://rebind.test:${server.port}/evil.css`,
    ]);
    expect(sheets.map((sheet) => new URL(sheet.href).pathname)).toEqual(['/site.css']);
    expect(server.hits.some((hit) => hit.includes('bootstrap'))).toBe(false);
  });
});

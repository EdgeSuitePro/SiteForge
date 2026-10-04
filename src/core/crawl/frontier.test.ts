import { describe, expect, it } from 'vitest';

import { evaluateLink, pathPattern, scorePriority, type FrontierContext } from './frontier';
import { parsePage } from './page-links';
import { parseSitemap } from './sitemap';

const context: FrontierContext = {
  rootDomain: 'edgeworks.com',
  canonicalOrigin: new URL('https://www.edgeworks.com'),
  includeSubdomains: false,
  maxDepth: 4,
};
const home = { depth: 0, url: 'https://www.edgeworks.com/' };

describe('evaluateLink', () => {
  it('rewrites same-site variants onto the canonical origin', () => {
    const result = evaluateLink('http://edgeworks.com/services/?utm_source=fb#x', context, home);
    expect(result).toMatchObject({ candidate: { url: 'https://www.edgeworks.com/services', depth: 1 } });
  });

  it.each([
    ['https://facebook.com/edgeworks', 'offsite'],
    ['https://shop.edgeworks.com/', 'offsite'],
    ['https://edgeworks.com.evil.net/', 'offsite'],
    ['https://www.edgeworks.com/menu.pdf', 'extension'],
    ['https://www.edgeworks.com/wp-content/uploads/a.JPG', 'extension'],
    ['https://www.edgeworks.com/wp-admin/', 'excluded_path'],
    ['https://www.edgeworks.com/cart', 'excluded_path'],
    [`https://www.edgeworks.com/${'a/'.repeat(15)}`, 'path_too_long'],
  ])('skips %s as %s', (url, reason) => {
    expect(evaluateLink(url, context, home)).toMatchObject({ skip: reason });
  });

  it('enforces depth', () => {
    expect(evaluateLink('https://www.edgeworks.com/a', context, { depth: 4, url: null })).toMatchObject({ skip: 'depth' });
  });
});

describe('pathPattern', () => {
  it('collapses templated URL families', () => {
    expect(pathPattern(new URL('https://x.com/events/2024/05/17'))).toBe('/events/:n/:n/:n');
    expect(pathPattern(new URL('https://x.com/events/2024-05-17'))).toBe('/events/:date');
    expect(pathPattern(new URL('https://x.com/p/8f3a9c0d2e1b4a'))).toBe('/p/:id');
    expect(pathPattern(new URL('https://x.com/?page_id=12'))).toBe('/?page_id');
    expect(pathPattern(new URL('https://x.com/Services'))).toBe('/services');
  });
});

describe('scorePriority', () => {
  it('prefers navigation and sharpening-business pages over blog archives', () => {
    const services = scorePriority(new URL('https://x.com/services'), 'Services', true, 1);
    const pricing = scorePriority(new URL('https://x.com/our-prices'), '', false, 1);
    const blog = scorePriority(new URL('https://x.com/blog/2021/old-post'), '', false, 1);
    expect(services).toBeGreaterThan(pricing);
    expect(pricing).toBeGreaterThan(blog);
  });
});

describe('parsePage', () => {
  it('extracts links, nav membership, robots meta and stats', () => {
    const page = parsePage(
      `<html lang="en"><head><title> Edge Works | Knife Sharpening </title>
        <meta name="robots" content="noindex, follow"><link rel="canonical" href="/home">
        <base href="https://attacker.example/"></head>
        <body><nav><a href="/services">Services</a></nav>
        <h1>Sharp knives, fast</h1>
        <a href="#top">top</a><a href="mailto:a@b.c">mail</a><a href="javascript:alert(1)">x</a>
        <a href="/about">About us</a><a href="/about">dup</a>
        <script>var ignored = "lots of words here"</script></body></html>`,
      new URL('https://www.edgeworks.com/'),
    );
    expect(page.title).toBe('Edge Works | Knife Sharpening');
    expect(page.h1).toBe('Sharp knives, fast');
    expect(page.lang).toBe('en');
    expect(page.canonical).toBe('https://www.edgeworks.com/home'); // hostile <base> ignored
    expect(page.metaRobots).toEqual({ noindex: true, nofollow: false });
    expect(page.links).toEqual([
      { url: 'https://www.edgeworks.com/services', text: 'Services', inNav: true },
      { url: 'https://www.edgeworks.com/about', text: 'About us', inNav: false },
    ]);
  });

  it('flags likely JavaScript-only app shells', () => {
    const page = parsePage(
      '<html><body><div id="root"></div><script src="a.js"></script></body></html>',
      new URL('https://x.com/'),
    );
    expect(page.likelyJsRendered).toBe(true);
  });
});

describe('parseSitemap', () => {
  it('reads urlsets and indexes, bounded', () => {
    const urlset = parseSitemap(
      '<urlset><url><loc>https://x.com/a?x=1&amp;y=2</loc></url><url><loc><![CDATA[https://x.com/b]]></loc></url><url><loc>ftp://x</loc></url></urlset>',
      10,
    );
    expect(urlset).toEqual({ kind: 'urlset', locations: ['https://x.com/a?x=1&y=2', 'https://x.com/b'] });
    expect(parseSitemap('<sitemapindex><sitemap><loc>https://x.com/s1.xml</loc></sitemap></sitemapindex>', 10).kind).toBe(
      'index',
    );
    const many = `<urlset>${'<url><loc>https://x.com/p</loc></url>'.repeat(50)}</urlset>`;
    expect(parseSitemap(many, 5).locations).toHaveLength(5);
  });
});

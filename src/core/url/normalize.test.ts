import { describe, expect, it } from 'vitest';

import { canonicalizeUrl, isSameSite, normalizeDomain, parseOperatorUrl } from './normalize';
import { checkUrlShape } from './safety';

describe('parseOperatorUrl', () => {
  it('adds https and canonicalizes', () => {
    const result = parseOperatorUrl('  Example-Sharpener.com/  ');
    expect(result).toMatchObject({ ok: true, domain: 'example-sharpener.com' });
    if (result.ok) expect(result.url.href).toBe('https://example-sharpener.com/');
  });

  it('strips www for the domain but keeps the URL host', () => {
    const result = parseOperatorUrl('http://WWW.Sharp.co.uk/services/?utm_source=x#top');
    expect(result).toMatchObject({ ok: true, domain: 'sharp.co.uk' });
    if (result.ok) expect(result.url.href).toBe('http://www.sharp.co.uk/services');
  });

  it.each([
    ['', /Enter a website/],
    ['file:///etc/passwd', /Only http and https/],
    ['ftp://example.com', /Only http and https/],
    ['javascript:alert(1)', /Only http and https/],
    ['http://localhost:3000', /web ports|Local/],
    ['http://localhost', /Enter a public website domain|Local/],
    ['http://printer.local', /Local network/],
    ['http://metadata.google.internal', /Local network/],
    ['http://127.0.0.1', /Private, local/],
    ['http://2130706433', /Private, local/], // decimal 127.0.0.1
    ['http://0x7f.0.0.1', /Private, local/], // hex 127.0.0.1
    ['http://017700000001', /Private, local/], // octal 127.0.0.1
    ['http://169.254.169.254/latest/meta-data', /Private, local/],
    ['http://[::1]/', /Private, local/],
    ['http://[::ffff:127.0.0.1]/', /Private, local/],
    ['http://user:pass@example.com', /credentials/],
    ['https://example.com:8443', /web ports/],
    ['http://intranet', /Enter a public website domain/],
    ['http://exa mple.com', /spaces/],
    [`https://example.com/${'a'.repeat(2100)}`, /too long/],
  ])('rejects %s', (input, message) => {
    const result = parseOperatorUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it('accepts a public IP literal', () => {
    expect(parseOperatorUrl('http://93.184.216.34/').ok).toBe(true);
  });
});

describe('canonicalizeUrl', () => {
  it.each([
    ['https://Example.com:443/a//b/', 'https://example.com/a/b'],
    ['http://example.com:80/', 'http://example.com/'],
    ['https://example.com/x?sort=asc&sessionid=1#frag', 'https://example.com/x'],
    ['https://example.com/?p=12&utm_medium=email', 'https://example.com/?p=12'],
    ['https://example.com/?page_id=7&p=3', 'https://example.com/?page_id=7&p=3'],
  ])('%s → %s', (input, expected) => expect(canonicalizeUrl(input).href).toBe(expected));
});

describe('site membership', () => {
  it('treats www and apex as one site, subdomains opt-in', () => {
    expect(normalizeDomain('WWW.Example.com.')).toBe('example.com');
    expect(isSameSite(new URL('https://www.example.com/a'), 'example.com')).toBe(true);
    expect(isSameSite(new URL('https://shop.example.com/'), 'example.com')).toBe(false);
    expect(isSameSite(new URL('https://shop.example.com/'), 'example.com', true)).toBe(true);
    expect(isSameSite(new URL('https://example.com.evil.net/'), 'example.com', true)).toBe(false);
    expect(isSameSite(new URL('https://notexample.com/'), 'example.com', true)).toBe(false);
  });
});

describe('checkUrlShape', () => {
  it('rejects data and blob URLs', () => {
    expect(checkUrlShape(new URL('data:text/html,hi')).ok).toBe(false);
  });
});

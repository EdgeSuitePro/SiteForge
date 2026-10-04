import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';

import {
  endlessBody,
  gzipBomb,
  html,
  redirect,
  stall,
  startFixtureServer,
  testFetchPolicy,
  text,
  type FixtureServer,
} from '../../../tests/support/fixture-server';
import { createSafeFetcher, defaultFetchPolicy, type FetchOptions, type SafeFetcher } from './fetcher';

let server: FixtureServer;
let fetcher: SafeFetcher;

const HTML: FetchOptions = {
  maxBytes: 200_000,
  onOversize: 'truncate',
  timeoutMs: 3_000,
  maxRedirects: 5,
  acceptTypes: ['text/html', 'application/xhtml+xml'],
};

beforeAll(async () => {
  server = await startFixtureServer({
    '/': html('<h1>Edge Works Sharpening</h1>'),
    '/gz': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(gzipSync('<p>compressed</p>'));
    },
    '/hop1': redirect('/hop2', 301),
    '/hop2': redirect('/'),
    '/loop': redirect('/loop'),
    '/to-private-ip': redirect('http://10.0.0.5/admin'),
    '/to-metadata': redirect('http://169.254.169.254/latest/meta-data/'),
    '/to-localhost': redirect('http://localhost/'),
    '/to-file': redirect('file:///etc/passwd'),
    '/to-rebind': (_req, res) => {
      res.writeHead(302, { location: `http://rebind.test:${server.port}/` });
      res.end();
    },
    '/offsite': redirect('https://elsewhere.example/'),
    '/pdf': text(200, '%PDF-1.4', 'application/pdf'),
    '/missing': text(404, 'nope'),
    '/error': text(503, 'down'),
    '/bomb': gzipBomb(50 * 1024 * 1024),
    '/endless': endlessBody,
    '/stall': stall,
    '/declared-huge': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(10 * 1024 * 1024) });
      res.end('<p>tiny</p>');
    },
    '/weird-encoding': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'zstd-unknown' });
      res.end('xx');
    },
  });
  fetcher = createSafeFetcher(testFetchPolicy);
});

afterAll(async () => {
  await fetcher.close();
  await server.close();
});

describe('safe fetcher — normal responses', () => {
  it('fetches HTML', async () => {
    const result = await fetcher.fetch(`${server.origin()}/`, HTML);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.body.toString()).toContain('Edge Works Sharpening');
  });

  it('decompresses gzip', async () => {
    const result = await fetcher.fetch(`${server.origin()}/gz`, HTML);
    expect(result.kind === 'ok' && result.body.toString()).toBe('<p>compressed</p>');
  });

  it('follows redirects manually and records the chain', async () => {
    const result = await fetcher.fetch(`${server.origin()}/hop1`, HTML);
    expect(result.kind).toBe('ok');
    expect(result.redirects).toHaveLength(2);
    expect(result.finalUrl).toBe(`${server.origin()}/`);
  });

  it('reports HTTP errors and unsupported types without reading bodies', async () => {
    expect(await fetcher.fetch(`${server.origin()}/missing`, HTML)).toMatchObject({ kind: 'http_error', status: 404 });
    expect(await fetcher.fetch(`${server.origin()}/error`, HTML)).toMatchObject({ kind: 'http_error', status: 503 });
    expect(await fetcher.fetch(`${server.origin()}/pdf`, HTML)).toMatchObject({ kind: 'unsupported_type' });
  });
});

describe('safe fetcher — SSRF defences', () => {
  it.each([
    ['/to-private-ip', 'blocked'],
    ['/to-metadata', 'blocked'],
    ['/to-localhost', 'blocked'],
    ['/to-file', 'blocked'],
  ])('refuses redirect %s', async (path, kind) => {
    const result = await fetcher.fetch(`${server.origin()}${path}`, HTML);
    expect(result.kind).toBe(kind);
  });

  it('refuses a hostname that resolves to a metadata address at connect time (DNS rebinding)', async () => {
    const direct = await fetcher.fetch(`http://rebind.test:${server.port}/`, HTML);
    expect(direct).toMatchObject({ kind: 'blocked', reason: 'blocked_ip' });
    const viaRedirect = await fetcher.fetch(`${server.origin()}/to-rebind`, HTML);
    expect(viaRedirect).toMatchObject({ kind: 'blocked', reason: 'blocked_ip' });
  });

  it('refuses when ANY resolved address is private, and for private IPv6', async () => {
    expect(await fetcher.fetch(`http://mixed.test:${server.port}/`, HTML)).toMatchObject({ kind: 'blocked' });
    expect(await fetcher.fetch(`http://v6private.test:${server.port}/`, HTML)).toMatchObject({ kind: 'blocked' });
  });

  it('lets the caller refuse off-site redirects', async () => {
    const result = await fetcher.fetch(`${server.origin()}/offsite`, {
      ...HTML,
      allowRedirect: (_from, to) => to.hostname.endsWith('.test'),
    });
    expect(result).toMatchObject({ kind: 'redirect_refused', location: 'https://elsewhere.example/' });
  });

  it('stops redirect loops', async () => {
    expect(await fetcher.fetch(`${server.origin()}/loop`, HTML)).toMatchObject({ kind: 'redirect_limit' });
  });

  it('the production policy refuses the fixture itself (loopback) before connecting', async () => {
    const prod = createSafeFetcher(defaultFetchPolicy);
    try {
      expect(await prod.fetch(`http://127.0.0.1:${server.port}/`, HTML)).toMatchObject({ kind: 'blocked' });
      expect(await prod.fetch('http://[::1]/', HTML)).toMatchObject({ kind: 'blocked' });
    } finally {
      await prod.close();
    }
  });
});

describe('safe fetcher — resource limits', () => {
  it('caps decompressed bytes for a gzip bomb', async () => {
    const result = await fetcher.fetch(`${server.origin()}/bomb`, HTML);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.truncated).toBe(true);
      expect(result.bytes).toBe(HTML.maxBytes);
    }
    expect(await fetcher.fetch(`${server.origin()}/bomb`, { ...HTML, onOversize: 'fail' })).toMatchObject({
      kind: 'too_large',
    });
  });

  it('stops reading an endless body', async () => {
    const result = await fetcher.fetch(`${server.origin()}/endless`, HTML);
    expect(result.kind === 'ok' && result.truncated).toBe(true);
  });

  it('fails fast on an oversized declared length when oversize is fatal', async () => {
    expect(await fetcher.fetch(`${server.origin()}/declared-huge`, { ...HTML, onOversize: 'fail' })).toMatchObject({
      kind: 'too_large',
    });
  });

  it('times out a stalled server', async () => {
    const started = Date.now();
    expect(await fetcher.fetch(`${server.origin()}/stall`, { ...HTML, timeoutMs: 500 })).toMatchObject({
      kind: 'timeout',
    });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('rejects unknown content encodings', async () => {
    expect(await fetcher.fetch(`${server.origin()}/weird-encoding`, HTML)).toMatchObject({ kind: 'network_error' });
  });
});

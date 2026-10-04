import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import type { LookupAddress } from 'node:dns';

import type { FetchPolicy } from '@/core/crawl/fetcher';
import { isBlockedIp } from '@/core/url/ip';
import { checkUrlShape } from '@/core/url/safety';

export type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void;

export interface FixtureServer {
  port: number;
  /** Base URL using a fake public hostname that the test resolver maps to 127.0.0.1. */
  origin: (host?: string) => string;
  hits: string[];
  close: () => Promise<void>;
}

export async function startFixtureServer(routes: Record<string, Handler>, fallback?: Handler): Promise<FixtureServer> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    hits.push(`${req.method} ${url.pathname}${url.search}`);
    const handler = routes[url.pathname] ?? fallback;
    if (handler) handler(req, res, url);
    else {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<h1>Not found</h1>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    origin: (host = 'sharpener.test') => `http://${host}:${port}`,
    hits,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Test policy: identical to production EXCEPT that
 *  - the fixture's non-standard port is allowed, and
 *  - loopback 127.0.0.1 counts as "public" so the fixture server is reachable.
 * DNS is faked: `*.test` → 127.0.0.1, `rebind.test` → 169.254.169.254, `mixed.test` → public + private.
 */
export const testFetchPolicy: FetchPolicy = {
  checkUrl: (url) => {
    const result = checkUrlShape(url);
    return !result.ok && result.reason === 'port' ? { ok: true } : result;
  },
  isAddressAllowed: (address) => address === '127.0.0.1' || !isBlockedIp(address),
  resolve: async (hostname): Promise<LookupAddress[]> => {
    if (hostname === 'rebind.test') return [{ address: '169.254.169.254', family: 4 }];
    if (hostname === 'mixed.test') return [{ address: '127.0.0.1', family: 4 }, { address: '10.0.0.8', family: 4 }];
    if (hostname === 'v6private.test') return [{ address: 'fd00::1', family: 6 }];
    if (hostname.endsWith('.test')) return [{ address: '127.0.0.1', family: 4 }];
    const error: NodeJS.ErrnoException = new Error(`ENOTFOUND ${hostname}`);
    error.code = 'ENOTFOUND';
    throw error;
  },
};

export const html = (body: string, head = ''): Handler => (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
};

export const text = (status: number, body: string, contentType = 'text/plain'): Handler => (_req, res) => {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
};

export const redirect = (location: string, status = 302): Handler => (_req, res) => {
  res.writeHead(status, { location });
  res.end();
};

export const gzipBomb = (decompressedBytes: number): Handler => {
  const payload = gzipSync(Buffer.alloc(decompressedBytes, 0x61));
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
    res.end(payload);
  };
};

export const endlessBody: Handler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  const chunk = Buffer.alloc(64 * 1024, 0x62);
  const timer = setInterval(() => {
    if (!res.write(chunk)) return;
  }, 1);
  res.on('close', () => clearInterval(timer));
};

export const stall: Handler = () => {
  // Never responds.
};

import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import type { Readable, Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { Agent, request } from 'undici';

import { isBlockedIp } from '../url/ip';
import { bareHostname, checkUrlShape, type UrlCheck } from '../url/safety';

/**
 * SSRF-hardened HTTP fetcher for crawling untrusted websites.
 *
 * Defence layers:
 *  1. URL shape check (scheme, port, credentials, hostname, IP literals) on the start URL and on
 *     every redirect hop — redirects are followed manually, never by the HTTP client.
 *  2. Connect-time DNS validation: the socket's own `lookup` resolves the host and refuses to
 *     connect if ANY resolved address is non-public. This defeats DNS rebinding because the
 *     address that is validated is the address that is connected to.
 *  3. Bounded everything: header/body timeouts, an overall deadline, decompressed-byte caps
 *     (zip-bomb safe), a content-type allowlist, and a redirect hop limit.
 */

export const SITEFORGE_USER_AGENT =
  'Mozilla/5.0 (compatible; EdgeSuiteProSiteForge/0.1; +https://siteforge.edgesuitepro.com/bot)';
/** Token matched against robots.txt `User-agent:` lines. */
export const ROBOTS_USER_AGENT_TOKEN = 'EdgeSuiteProSiteForge';

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

export interface FetchPolicy {
  /** Static URL checks applied to every hop. */
  checkUrl: (url: URL) => UrlCheck;
  /** Connect-time address check. */
  isAddressAllowed: (address: string) => boolean;
  /** DNS resolver (injectable for tests). */
  resolve: Resolver;
}

export const defaultFetchPolicy: FetchPolicy = {
  checkUrl: checkUrlShape,
  isAddressAllowed: (address) => !isBlockedIp(address),
  resolve: (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
};

export interface FetchOptions {
  /** Maximum decompressed body size in bytes. */
  maxBytes: number;
  /** What to do when the body exceeds maxBytes: keep the first maxBytes (HTML) or fail. */
  onOversize: 'truncate' | 'fail';
  /** Overall deadline for the whole request including redirects. */
  timeoutMs: number;
  maxRedirects: number;
  /** Accepted media types, e.g. ['text/html', 'application/xhtml+xml']. Empty = any. */
  acceptTypes: readonly string[];
  /** Decide whether a redirect target may be followed (e.g. stay on the same site). */
  allowRedirect?: (from: URL, to: URL) => boolean;
  method?: 'GET' | 'HEAD';
  signal?: AbortSignal;
}

interface Base {
  requestedUrl: string;
  finalUrl: string;
  redirects: string[];
}

export type FetchOutcome =
  | (Base & {
      kind: 'ok';
      status: number;
      contentType: string;
      headers: Record<string, string>;
      body: Buffer;
      bytes: number;
      truncated: boolean;
    })
  | (Base & { kind: 'http_error'; status: number; headers: Record<string, string> })
  | (Base & { kind: 'blocked'; reason: string; message: string })
  | (Base & { kind: 'unsupported_type'; status: number; contentType: string })
  | (Base & { kind: 'too_large'; limit: number })
  | (Base & { kind: 'redirect_limit' })
  | (Base & { kind: 'redirect_refused'; location: string })
  | (Base & { kind: 'timeout' })
  | (Base & { kind: 'network_error'; message: string });

const BLOCKED_ERROR_CODE = 'ESITEFORGE_BLOCKED_ADDRESS';

class BlockedAddressError extends Error {
  readonly code = BLOCKED_ERROR_CODE;
  constructor(hostname: string) {
    super(`Refused to connect to ${hostname}: it resolves to a private, local, or reserved address.`);
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** Socket-level lookup that only ever yields allowed addresses. */
function guardedLookup(policy: FetchPolicy) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
    policy
      .resolve(hostname)
      .then((addresses) => {
        if (addresses.length === 0) {
          const error: NodeJS.ErrnoException = new Error(`No addresses for ${hostname}`);
          error.code = 'ENOTFOUND';
          throw error;
        }
        if (addresses.some((entry) => !policy.isAddressAllowed(entry.address))) {
          throw new BlockedAddressError(hostname);
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      })
      .catch((error: NodeJS.ErrnoException) => callback(error, ''));
  };
}

const flattenHeaders = (headers: Record<string, string | string[] | undefined>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value)]),
  );

const noop = () => {};

/** Abandon a response body without leaving an unhandled 'aborted' error behind. */
function discard(body: Readable): void {
  body.on('error', noop);
  body.destroy();
}

const mediaType = (contentType: string) => (contentType.split(';')[0] ?? '').trim().toLowerCase();

function decoderFor(encoding: string): Transform | null | undefined {
  const value = encoding.trim().toLowerCase();
  if (!value || value === 'identity') return null;
  if (value === 'gzip' || value === 'x-gzip') return createGunzip();
  if (value === 'br') return createBrotliDecompress();
  if (value === 'deflate') return createInflate();
  return undefined; // unsupported encoding
}

/** Read at most `maxBytes` decompressed bytes. Destroys the streams as soon as the cap is hit. */
async function readCapped(
  body: Readable,
  encoding: string,
  maxBytes: number,
): Promise<{ data: Buffer; exceeded: boolean }> {
  const decoder = decoderFor(encoding);
  if (decoder === undefined) throw new Error(`Unsupported content-encoding: ${encoding}`);
  const source: Readable = decoder ? body.pipe(decoder) : body;
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      if (total + buffer.length > maxBytes) {
        chunks.push(buffer.subarray(0, maxBytes - total));
        total = maxBytes;
        return { data: Buffer.concat(chunks), exceeded: true };
      }
      chunks.push(buffer);
      total += buffer.length;
    }
    return { data: Buffer.concat(chunks), exceeded: false };
  } finally {
    decoder?.on('error', noop);
    discard(body);
    decoder?.destroy();
  }
}

export interface SafeFetcher {
  fetch(url: string | URL, options: FetchOptions): Promise<FetchOutcome>;
  close(): Promise<void>;
}

export function createSafeFetcher(policy: FetchPolicy = defaultFetchPolicy): SafeFetcher {
  const agent = new Agent({
    connect: { lookup: guardedLookup(policy) as never, timeout: 10_000 },
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
    connections: 4,
    // Defence in depth: undici aborts any body far beyond our own caps.
    maxResponseSize: 64 * 1024 * 1024,
  });

  async function fetchOnce(start: URL, options: FetchOptions): Promise<FetchOutcome> {
    const redirects: string[] = [];
    const deadline = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
    let current = start;
    const base = (): Base => ({ requestedUrl: start.href, finalUrl: current.href, redirects });

    for (let hop = 0; ; hop++) {
      const shape = policy.checkUrl(current);
      if (!shape.ok) return { ...base(), kind: 'blocked', reason: shape.reason, message: shape.message };
      const host = bareHostname(current);
      if (isIP(host) && !policy.isAddressAllowed(host)) {
        return { ...base(), kind: 'blocked', reason: 'blocked_ip', message: 'Blocked network address.' };
      }

      let response: Awaited<ReturnType<typeof request>>;
      try {
        response = await request(current, {
          method: options.method ?? 'GET',
          dispatcher: agent,
          signal,
          headers: {
            'user-agent': SITEFORGE_USER_AGENT,
            accept: options.acceptTypes.length ? `${options.acceptTypes.join(', ')};q=1.0, */*;q=0.1` : '*/*',
            'accept-encoding': 'gzip, deflate, br',
            'accept-language': 'en-US,en;q=0.8',
          },
        });
      } catch (error) {
        if (signal.aborted) return { ...base(), kind: 'timeout' };
        const err = error as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
        const code = err.code ?? err.cause?.code;
        if (code === BLOCKED_ERROR_CODE || err.cause?.code === BLOCKED_ERROR_CODE) {
          return { ...base(), kind: 'blocked', reason: 'blocked_ip', message: (err.cause ?? err).message };
        }
        if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
          return { ...base(), kind: 'timeout' };
        }
        return { ...base(), kind: 'network_error', message: code ?? err.message };
      }

      const headers = flattenHeaders(response.headers as Record<string, string | string[] | undefined>);
      const status = response.statusCode;

      if (status >= 300 && status < 400 && headers.location) {
        discard(response.body);
        if (hop >= options.maxRedirects) return { ...base(), kind: 'redirect_limit' };
        let next: URL;
        try {
          next = new URL(headers.location, current);
        } catch {
          return { ...base(), kind: 'network_error', message: 'Invalid redirect location.' };
        }
        next.hash = '';
        if (options.allowRedirect && !options.allowRedirect(current, next)) {
          return { ...base(), kind: 'redirect_refused', location: next.href };
        }
        redirects.push(current.href);
        current = next;
        continue;
      }

      if (status < 200 || status >= 300) {
        discard(response.body);
        return { ...base(), kind: 'http_error', status, headers };
      }

      const contentType = headers['content-type'] ?? '';
      if (options.acceptTypes.length && !options.acceptTypes.includes(mediaType(contentType))) {
        discard(response.body);
        return { ...base(), kind: 'unsupported_type', status, contentType };
      }

      const declared = Number(headers['content-length']);
      if (options.onOversize === 'fail' && Number.isFinite(declared) && declared > options.maxBytes) {
        discard(response.body);
        return { ...base(), kind: 'too_large', limit: options.maxBytes };
      }

      if (options.method === 'HEAD') {
        discard(response.body);
        return { ...base(), kind: 'ok', status, contentType, headers, body: Buffer.alloc(0), bytes: 0, truncated: false };
      }

      try {
        const { data, exceeded } = await readCapped(response.body, headers['content-encoding'] ?? '', options.maxBytes);
        if (exceeded && options.onOversize === 'fail') return { ...base(), kind: 'too_large', limit: options.maxBytes };
        return { ...base(), kind: 'ok', status, contentType, headers, body: data, bytes: data.length, truncated: exceeded };
      } catch (error) {
        if (signal.aborted) return { ...base(), kind: 'timeout' };
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'UND_ERR_BODY_TIMEOUT') return { ...base(), kind: 'timeout' };
        return { ...base(), kind: 'network_error', message: err.code ?? err.message };
      }
    }
  }

  return {
    fetch: (url, options) => {
      let parsed: URL;
      try {
        parsed = typeof url === 'string' ? new URL(url) : url;
      } catch {
        return Promise.resolve({
          kind: 'blocked',
          reason: 'invalid',
          message: 'Invalid URL.',
          requestedUrl: String(url),
          finalUrl: String(url),
          redirects: [],
        });
      }
      return fetchOnce(parsed, options);
    },
    close: () => agent.close(),
  };
}

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal signed session token: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Used by the local dev login. The Supabase adapter will use Supabase's own session cookies.
 * Pure and dependency-free so it can run in the Next.js proxy as well as in server code.
 */

export const SESSION_COOKIE = 'sf_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function createSessionToken(
  user: { id: string; email: string },
  secret: string,
  now: number = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = { sub: user.id, email: user.email, iat, exp: iat + SESSION_TTL_SECONDS };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now: number = Date.now(),
): SessionPayload | null {
  if (!token || token.length > 4096) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

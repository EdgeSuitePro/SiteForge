import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { ZodError } from 'zod';

import { AuthError } from './auth/operator';
import { ServiceError } from './crawl/service';
import { log } from './log';

/** Map known errors to JSON responses; never leak internals for unexpected ones. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return Response.json({ error: error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 });
  }
  if (error instanceof ServiceError || error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  log.error('http.unhandled', { error });
  return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}

/** Constant-time check of an `Authorization: Bearer <secret>` header. */
export function hasBearerSecret(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const provided = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

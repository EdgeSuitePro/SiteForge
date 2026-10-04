import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySessionToken } from './src/server/auth/session';
import { serverEnv } from './src/server/env';

/**
 * Runs before every non-static request (Node.js runtime):
 *  1. Rejects unauthenticated access to the operator app and operator APIs.
 *  2. Sets a per-request nonce-based Content-Security-Policy.
 *
 * Workspace membership is re-checked server-side by requireOperator(); this is the outer gate.
 */

/** Paths reachable without an operator session. */
const PUBLIC_PATHS = ['/login', '/api/health', '/robots.txt'];
/** Paths authenticated by their own mechanism (shared secrets, share tokens). */
const SELF_AUTHENTICATED_PREFIXES = ['/api/jobs/'];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) || SELF_AUTHENTICATED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

function contentSecurityPolicy(nonce: string, isDev: boolean, isDeployed: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Inline style attributes are allowed; scripts are what the nonce protects.
    "style-src 'self' 'unsafe-inline'",
    // Prospect images are never hotlinked in the operator UI.
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only on HTTPS deployments: on plain-http localhost it would break every subresource.
    ...(isDeployed ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let secret: string;
  let isDeployed: boolean;
  try {
    ({ sessionSecret: secret, isDeployed } = serverEnv());
  } catch (error) {
    console.error(error);
    return new NextResponse('SiteForge is misconfigured. See server logs.', { status: 500 });
  }

  if (!isPublic(pathname)) {
    const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, secret);
    if (!session) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
      }
      const login = new URL('/login', request.url);
      if (pathname !== '/') login.searchParams.set('next', pathname);
      return NextResponse.redirect(login);
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development', isDeployed);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

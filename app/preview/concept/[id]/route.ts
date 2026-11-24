import { createHash } from 'node:crypto';

import { renderConcept } from '@/core/render';
import { getOperator } from '@/server/auth/operator';
import { getConceptForPreview } from '@/server/concepts/service';
import { getDb } from '@/server/db/client';
import { isUuid } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * Private concept preview (operator-only in V1). The page is a self-contained document from the
 * deterministic renderer: no scripts, one inline stylesheet allowed by hash, no external requests.
 * It may only be framed by SiteForge itself and is never indexed or cached.
 *
 *   ?mode=clean  hides operator placeholders (to see what a finished page would look like)
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const operator = await getOperator();
  if (!operator) return new Response('Please sign in.', { status: 401, headers: baseHeaders() });
  const { id } = await params;
  if (!isUuid(id)) return new Response('Not found.', { status: 404, headers: baseHeaders() });

  const db = await getDb();
  const found = await getConceptForPreview(db, operator.workspaceId, id);
  if (!found) return new Response('Not found.', { status: 404, headers: baseHeaders() });

  const mode = new URL(request.url).searchParams.get('mode') === 'clean' ? 'hide' : 'show';
  const { concept, prospect } = found;
  const { html, css } = renderConcept({
    strategy: concept.strategy,
    content: concept.content,
    catalog: concept.factCatalog,
    tokens: concept.designTokens,
    domain: prospect.normalizedDomain,
    placeholders: mode,
  });
  const styleHash = createHash('sha256').update(css).digest('base64');
  return new Response(html, {
    status: 200,
    headers: {
      ...baseHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': [
        "default-src 'none'",
        `style-src 'sha256-${styleHash}'`,
        'img-src data:',
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'self'",
      ].join('; '),
    },
  });
}

function baseHeaders(): Record<string, string> {
  return {
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': 'private, no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

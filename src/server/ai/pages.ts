import 'server-only';

import { eq } from 'drizzle-orm';

import type { AuditPage } from '../../core/audit/context';
import type { Database } from '../db/client';
import { pageExtractions } from '../db/schema';

export async function loadAuditPages(db: Database, extractionRunId: string): Promise<AuditPage[]> {
  const rows = await db.select().from(pageExtractions).where(eq(pageExtractions.extractionRunId, extractionRunId));
  return rows.map((row) => ({ pageId: row.pageId, url: row.url, depth: row.depth, doc: row.document }));
}

/** Model input bounds: enough of the site to judge it, small enough to stay cheap. */
export const PACK_LIMITS = {
  extract: { maxPages: 12, maxCharsPerPage: 6_000 },
  semantic: { maxPages: 10, maxCharsPerPage: 5_000 },
} as const;

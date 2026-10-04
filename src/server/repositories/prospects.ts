import 'server-only';

import { desc, eq } from 'drizzle-orm';

import type { Database } from '../db/client';
import { prospects } from '../db/schema';

export type ProspectRow = typeof prospects.$inferSelect;

export async function listProspects(db: Database, workspaceId: string): Promise<ProspectRow[]> {
  return db
    .select()
    .from(prospects)
    .where(eq(prospects.workspaceId, workspaceId))
    .orderBy(desc(prospects.createdAt))
    .limit(200);
}

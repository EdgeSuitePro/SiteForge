import type { Operator } from '@/server/auth/operator';
import type { Database } from '@/server/db/client';
import { workspaceMembers, workspaces } from '@/server/db/schema';

let counter = 0;

export async function createTestOperator(db: Database): Promise<Operator> {
  counter++;
  const [workspace] = await db.insert(workspaces).values({ slug: `ws-${counter}-${Date.now()}`, name: 'Test workspace' }).returning();
  if (!workspace) throw new Error('workspace insert failed');
  const userId = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, email: `op${counter}@test.local`, role: 'owner' });
  return { userId, email: `op${counter}@test.local`, workspaceId: workspace.id, workspaceName: workspace.name, role: 'owner' };
}

import { canonicalizeUrl, normalizeDomain } from '@/core/url/normalize';
import { prospects } from '@/server/db/schema';

/**
 * Seed a prospect for a fixture URL. The fixture server listens on a random port, which the
 * production operator-input rules (ports 80/443 only) correctly reject, so tests insert directly.
 */
export async function seedProspect(db: Database, operator: Operator, websiteUrl: string) {
  const url = canonicalizeUrl(websiteUrl);
  const [row] = await db
    .insert(prospects)
    .values({ workspaceId: operator.workspaceId, websiteUrl: url.href, normalizedDomain: normalizeDomain(url.hostname) })
    .returning();
  if (!row) throw new Error('prospect insert failed');
  return { prospect: row };
}

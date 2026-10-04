import 'server-only';

import type { Database } from './db/client';
import { activityLog } from './db/schema';

export async function recordActivity(
  db: Database,
  entry: { workspaceId: string; prospectId?: string | null; actorUserId?: string | null; kind: string; detail?: Record<string, unknown> },
): Promise<void> {
  await db.insert(activityLog).values({
    workspaceId: entry.workspaceId,
    prospectId: entry.prospectId ?? null,
    actorUserId: entry.actorUserId ?? null,
    kind: entry.kind,
    detail: entry.detail ?? {},
  });
}

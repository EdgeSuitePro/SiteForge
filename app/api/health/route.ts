import { sql } from 'drizzle-orm';

import { getDb } from '@/server/db/client';
import { serverEnv } from '@/server/env';
import { log } from '@/server/log';

export const dynamic = 'force-dynamic';

/** Liveness + database reachability. Reveals no configuration beyond the database kind. */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: serverEnv().database.kind });
  } catch (error) {
    log.error('health.failed', { error });
    return Response.json({ ok: false }, { status: 503 });
  }
}

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseHandle } from '@/server/db/client';
import { rowsOf } from '@/server/db/rows';
import { prospects, workspaces } from '@/server/db/schema';

import { createTestDatabase } from '../support/db';

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await createTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

describe('committed migrations', () => {
  it('create every table in the siteforge schema with row-level security enabled', async () => {
    const result = await handle.db.execute(sql`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'siteforge' and c.relkind = 'r'
      order by c.relname`);
    const rows = rowsOf<{ relname: string; relrowsecurity: boolean }>(result);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it('are idempotent when re-applied', async () => {
    await expect(handle.migrate()).resolves.toBeUndefined();
  });

  it('enforce one prospect per domain per workspace and valid statuses', async () => {
    const [workspace] = await handle.db.insert(workspaces).values({ slug: 'w1', name: 'W1' }).returning();
    if (!workspace) throw new Error('workspace insert failed');
    const base = { workspaceId: workspace.id, websiteUrl: 'https://example.com/', normalizedDomain: 'example.com' };

    await handle.db.insert(prospects).values(base);
    await expect(handle.db.insert(prospects).values(base)).rejects.toThrow();
    await expect(
      handle.db
        .insert(prospects)
        .values({ ...base, normalizedDomain: 'other.com', status: 'bogus' as never }),
    ).rejects.toThrow();

    const [row] = await handle.db.select().from(prospects).where(eq(prospects.normalizedDomain, 'example.com'));
    expect(row?.status).toBe('new');
  });
});

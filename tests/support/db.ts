import { openDatabase, type DatabaseHandle } from '@/server/db/client';

/** Fresh in-memory PGlite with all committed migrations applied. */
export async function createTestDatabase(): Promise<DatabaseHandle> {
  const handle = openDatabase({ kind: 'pglite', dataDir: 'memory://' });
  await handle.migrate();
  return handle;
}

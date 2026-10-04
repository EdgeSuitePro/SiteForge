/** Delete the local embedded database. Refuses to touch anything but a local directory. */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

import { parseServerEnv } from '../src/server/env';

const env = parseServerEnv(process.env);
if (env.database.kind !== 'pglite' || env.database.dataDir.startsWith('memory://')) {
  console.error('db:reset-local only resets the local PGlite directory. Unset DATABASE_URL first.');
  process.exit(1);
}
const dir = path.resolve(env.database.dataDir);
if (!dir.startsWith(path.resolve('.data'))) {
  console.error(`Refusing to delete ${dir}: local databases must live under .data/`);
  process.exit(1);
}
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}. It will be recreated and migrated on next start.`);

/**
 * Normalize a raw `db.execute(sql...)` result to an array of rows.
 * PGlite returns `{ rows: [...] }`; postgres-js returns an array-like RowList.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  throw new TypeError('Unrecognized database result shape.');
}

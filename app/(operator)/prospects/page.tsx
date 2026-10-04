import { requireOperator } from '@/server/auth/operator';
import { getDb } from '@/server/db/client';
import { listProspects } from '@/server/repositories/prospects';

export const metadata = { title: 'Prospects' };
export const dynamic = 'force-dynamic';

export default async function ProspectsPage() {
  const operator = await requireOperator();
  const db = await getDb();
  const rows = await listProspects(db, operator.workspaceId);

  return (
    <main>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Prospects</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Sharpening businesses whose websites you are evaluating.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-panel px-6 py-12 text-center">
          <p className="font-medium">No prospects yet</p>
          <p className="mt-1 text-sm text-ink-soft">Adding a website and analyzing it arrives in the next phase.</p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-panel">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.businessNameHint ?? row.normalizedDomain}</p>
                <p className="truncate text-sm text-muted">{row.websiteUrl}</p>
              </div>
              <span className="shrink-0 rounded-full bg-canvas px-2.5 py-0.5 text-xs text-ink-soft">{row.status}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

import Link from 'next/link';

import { requireOperator } from '@/server/auth/operator';
import { getDb } from '@/server/db/client';
import { listProspects } from '@/server/repositories/prospects';
import { AddProspectForm } from '@/ui/add-prospect-form';
import { PROSPECT_STATUS_LABEL } from '@/ui/labels';
import { StatusPill, prospectTone } from '@/ui/status-pill';

import { createProspectAction } from './actions';

export const metadata = { title: 'Prospects' };
export const dynamic = 'force-dynamic';

export default async function ProspectsPage() {
  const operator = await requireOperator();
  const db = await getDb();
  const rows = await listProspects(db, operator.workspaceId);

  return (
    <main className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <section className="min-w-0">
        <h1 className="text-xl font-semibold">Prospects</h1>
        <p className="mt-1 text-sm text-ink-soft">Sharpening businesses whose websites you are evaluating.</p>

        {rows.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-line bg-panel px-6 py-12 text-center">
            <p className="font-medium">No prospects yet</p>
            <p className="mt-1 text-sm text-ink-soft">Add a sharpening business website to get started.</p>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-panel">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/prospects/${row.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-canvas"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.businessNameHint ?? row.normalizedDomain}</p>
                    <p className="truncate text-sm text-muted">
                      {row.normalizedDomain}
                      {row.cityHint ? ` · ${row.cityHint}` : ''}
                    </p>
                  </div>
                  <StatusPill tone={prospectTone(row.status)}>{PROSPECT_STATUS_LABEL[row.status] ?? row.status}</StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AddProspectForm action={createProspectAction} />
    </main>
  );
}

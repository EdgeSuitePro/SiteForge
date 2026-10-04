import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireOperator } from '@/server/auth/operator';
import { getLatestCrawlProgress, getProspect, ServiceError } from '@/server/crawl/service';
import { getDb } from '@/server/db/client';
import { isUuid } from '@/server/http';
import { CrawlProgressPanel } from '@/ui/crawl-progress';
import { PROSPECT_STATUS_LABEL } from '@/ui/labels';
import { StatusPill, prospectTone } from '@/ui/status-pill';

import { analyzeAction, cancelAction } from '../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Prospect ${(await params).id.slice(0, 8)}` };
}

export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const operator = await requireOperator();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await getDb();

  let prospect;
  try {
    prospect = await getProspect(db, operator.workspaceId, id);
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) notFound();
    throw error;
  }
  const progress = await getLatestCrawlProgress(db, operator.workspaceId, id);

  return (
    <main>
      <Link href="/prospects" className="text-sm text-ink-soft hover:text-ink">
        ← Prospects
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold">{prospect.businessNameHint ?? prospect.normalizedDomain}</h1>
          <p className="mt-1 break-all text-sm text-ink-soft">
            {prospect.websiteUrl}
            {prospect.cityHint ? ` · ${prospect.cityHint}` : ''}
          </p>
        </div>
        <StatusPill tone={prospectTone(prospect.status)}>{PROSPECT_STATUS_LABEL[prospect.status] ?? prospect.status}</StatusPill>
      </div>
      {prospect.notes && (
        <p className="mt-4 max-w-3xl whitespace-pre-line rounded-md bg-panel px-4 py-3 text-sm text-ink-soft ring-1 ring-line">
          {prospect.notes}
        </p>
      )}

      <CrawlProgressPanel
        prospectId={prospect.id}
        initial={progress ? JSON.parse(JSON.stringify(progress)) : null}
        analyze={analyzeAction.bind(null, prospect.id)}
        cancel={cancelAction.bind(null, prospect.id)}
      />
    </main>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireOperator } from '@/server/auth/operator';
import { getLatestCrawlProgress, getProspect, ServiceError } from '@/server/crawl/service';
import { getAudit } from '@/server/audit/service';
import { getDb } from '@/server/db/client';
import { getBusinessProfile } from '@/server/facts/service';
import { isUuid } from '@/server/http';
import { AuditPanel } from '@/ui/audit-panel';
import { AutoRefresh } from '@/ui/auto-refresh';
import { BusinessProfilePanel } from '@/ui/business-profile';
import { CrawlProgressPanel } from '@/ui/crawl-progress';
import { PROSPECT_STATUS_LABEL } from '@/ui/labels';
import { StatusPill, prospectTone } from '@/ui/status-pill';

import { analyzeAction, cancelAction, reAuditAction, reExtractAction, reviewFactAction } from '../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Prospect ${(await params).id.slice(0, 8)}` };
}

const TABS = [
  { key: 'audit', label: 'Audit' },
  { key: 'profile', label: 'Business profile' },
  { key: 'crawl', label: 'Crawl' },
] as const;

/** Server data → plain JSON for client components (Dates become strings). */
const serialize = <T,>(value: T) => JSON.parse(JSON.stringify(value));

export default async function ProspectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const operator = await requireOperator();
  const { id } = await params;
  const { tab: requestedTab } = await searchParams;
  if (!isUuid(id)) notFound();
  const db = await getDb();

  let prospect;
  try {
    prospect = await getProspect(db, operator.workspaceId, id);
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) notFound();
    throw error;
  }
  const [progress, profile, audit] = await Promise.all([
    getLatestCrawlProgress(db, operator.workspaceId, id),
    getBusinessProfile(db, operator.workspaceId, id),
    getAudit(db, operator.workspaceId, id),
  ]);

  const hasAudit = audit?.run.status === 'completed';
  const hasProfile = profile?.run.status === 'completed';
  const tab = TABS.some((entry) => entry.key === requestedTab) ? requestedTab : hasAudit ? 'audit' : hasProfile ? 'profile' : 'crawl';
  const crawlActive = progress?.run.status === 'queued' || progress?.run.status === 'running';
  const extractionActive = Boolean(profile?.pending) || profile?.run.status === 'queued' || profile?.run.status === 'running';
  const auditActive = Boolean(audit?.pending);

  return (
    <main>
      <AutoRefresh active={crawlActive || extractionActive || auditActive} />
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

      <nav aria-label="Prospect sections" className="mt-6 flex gap-1 border-b border-line">
        {TABS.map((entry) => (
          <Link
            key={entry.key}
            href={`/prospects/${prospect.id}?tab=${entry.key}`}
            aria-current={tab === entry.key ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === entry.key ? 'border-steel text-ink' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'audit' ? (
          <AuditPanel view={audit} analyzing={crawlActive || extractionActive} reAudit={reAuditAction.bind(null, prospect.id)} />
        ) : tab === 'profile' ? (
          <BusinessProfilePanel
            view={profile ? serialize(profile) : null}
            crawl={progress ? serialize(progress) : null}
            review={reviewFactAction.bind(null, prospect.id)}
            reExtract={reExtractAction.bind(null, prospect.id)}
          />
        ) : (
          <CrawlProgressPanel
            prospectId={prospect.id}
            initial={progress ? serialize(progress) : null}
            analyze={analyzeAction.bind(null, prospect.id)}
            cancel={cancelAction.bind(null, prospect.id)}
          />
        )}
      </div>
    </main>
  );
}

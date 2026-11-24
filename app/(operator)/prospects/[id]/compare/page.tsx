import Link from 'next/link';
import { notFound } from 'next/navigation';

import { STRATEGY_DEFINITIONS } from '@/core/concepts/strategies';
import { getAudit } from '@/server/audit/service';
import { requireOperator } from '@/server/auth/operator';
import { getConcepts } from '@/server/concepts/service';
import { getProspect, ServiceError } from '@/server/crawl/service';
import { getDb } from '@/server/db/client';
import { isUuid } from '@/server/http';
import { ConceptCompare } from '@/ui/concept-compare';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Compare concepts' };

export default async function ComparePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ concept?: string }> }) {
  const operator = await requireOperator();
  const { id } = await params;
  const { concept: initial } = await searchParams;
  if (!isUuid(id)) notFound();
  const db = await getDb();
  let prospect;
  try {
    prospect = await getProspect(db, operator.workspaceId, id);
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) notFound();
    throw error;
  }
  const [view, audit] = await Promise.all([getConcepts(db, operator.workspaceId, id), getAudit(db, operator.workspaceId, id)]);
  const completed = (view?.concepts ?? []).filter((concept) => concept.status === 'completed');
  const problems = (audit?.findings ?? [])
    .filter((finding) => (finding.outcome === 'fail' || finding.outcome === 'partial') && finding.pointsPossible > 0 && finding.severity !== 'low')
    .slice(0, 6)
    .map((finding) => ({ title: finding.title, severity: finding.severity }));

  return (
    <main>
      <Link href={`/prospects/${prospect.id}?tab=concepts`} className="text-sm text-ink-soft hover:text-ink">
        ← {prospect.businessNameHint ?? prospect.normalizedDomain}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">Compare concepts</h1>
      <p className="mt-1 text-sm text-ink-soft">Private previews: never indexed, and nothing on {prospect.normalizedDomain} has been changed.</p>
      <div className="mt-6">
        {completed.length === 0 ? (
          <p className="rounded-lg border border-line bg-panel p-6 text-sm text-ink-soft">No finished concepts yet. Generate them from the Concepts tab.</p>
        ) : (
          <ConceptCompare
            initial={initial ?? null}
            current={{ url: prospect.websiteUrl, domain: prospect.normalizedDomain, score: audit?.run.status === 'completed' ? audit.run.overallScore : null, problems }}
            concepts={completed.map((concept) => {
              const definition = STRATEGY_DEFINITIONS[concept.strategy];
              return { id: concept.id, strategy: concept.strategy, letter: definition.letter, name: definition.name, summary: definition.summary };
            })}
          />
        )}
      </div>
    </main>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { STRATEGY_DEFINITIONS } from '@/core/concepts/strategies';
import { getAudit } from '@/server/audit/service';
import { requireOperator } from '@/server/auth/operator';
import { getConcepts } from '@/server/concepts/service';
import { getProspect, ServiceError } from '@/server/crawl/service';
import { getDb } from '@/server/db/client';
import { getBusinessProfile } from '@/server/facts/service';
import { isUuid } from '@/server/http';
import { StatusPill } from '@/ui/status-pill';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Presentation' };

const SEVERITY = { high: { label: 'High priority', tone: 'bad' }, medium: { label: 'Medium', tone: 'warn' }, low: { label: 'Low', tone: 'neutral' } } as const;

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
};

/**
 * Prospect presentation (operator-only in V1): the score and why, the findings with evidence,
 * what would change, and the three concepts. Everything shown is from the stored audit and facts.
 */
export default async function PresentationPage({ params }: { params: Promise<{ id: string }> }) {
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
  const [audit, conceptsView, profile] = await Promise.all([
    getAudit(db, operator.workspaceId, id),
    getConcepts(db, operator.workspaceId, id),
    getBusinessProfile(db, operator.workspaceId, id),
  ]);
  if (!audit || audit.run.status !== 'completed') {
    return (
      <main>
        <p className="rounded-lg border border-line bg-panel p-6 text-sm text-ink-soft">The presentation is available once the website has been analyzed.</p>
      </main>
    );
  }
  const name = profile?.profile.find((field) => field.field === 'business_name')?.primary?.display ?? prospect.businessNameHint ?? prospect.normalizedDomain;
  const realFindings = audit.run.semanticStatus === 'mock' ? audit.findings.filter((finding) => finding.source !== 'semantic') : audit.findings;
  const problems = realFindings.filter((finding) => (finding.outcome === 'fail' || finding.outcome === 'partial') && finding.pointsPossible > 0);
  const top = problems.filter((finding) => finding.severity !== 'low').slice(0, 6);
  const changes = problems.slice(0, 6);
  const opportunities = realFindings.filter((finding) => finding.category === 'revenue_opportunities' && finding.outcome !== 'pass' && finding.outcome !== 'not_applicable' && finding.outcome !== 'unknown');
  const categories = (audit.run.categories ?? []).filter((category) => audit.categoryInfo[category.category].weight > 0);
  const concepts = (conceptsView?.concepts ?? []).filter((concept) => concept.status === 'completed');

  return (
    <main className="mx-auto max-w-4xl space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/prospects/${prospect.id}?tab=concepts`} className="text-sm text-ink-soft hover:text-ink">
          ← Back to prospect
        </Link>
        <span className="text-xs text-muted">Operator view · private</span>
      </div>

      <header>
        <p className="text-sm font-medium text-steel">EdgeSuite Pro · Website review</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{name}</h1>
        <p className="mt-1 break-all text-ink-soft">{prospect.websiteUrl}</p>
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-signal-good ring-1 ring-emerald-200">
          Your existing website has not been modified. Everything below is a private review and private concept previews.
        </p>
      </header>

      <section className="grid gap-8 rounded-xl border border-line bg-panel p-6 md:grid-cols-[200px_1fr]">
        <div>
          <p className="text-xs font-medium text-muted">{audit.scoreName}</p>
          <p className="mt-1 font-semibold tabular-nums">
            <span className="text-6xl">{audit.run.overallScore}</span>
            <span className="text-xl text-muted">/100</span>
          </p>
          <p className="mt-3 text-xs leading-5 text-muted">An EdgeSuite Pro measure of how well the site helps customers find and choose you. Not an industry-standard SEO score.</p>
        </div>
        <ul className="space-y-3">
          {categories.map((category) => {
            const info = audit.categoryInfo[category.category];
            return (
              <li key={category.category}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{info.label}</span>
                  <span className="tabular-nums">{category.score ?? 'n/a'}</span>
                </div>
                <span className="mt-1 block h-2 rounded-full bg-sky-100" aria-hidden="true">
                  {category.score !== null && <span className="block h-2 rounded-full bg-steel" style={{ width: `${Math.max(category.score, 2)}%` }} />}
                </span>
                <p className="mt-0.5 text-xs text-muted">{info.question}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">What we found</h2>
        <ol className="mt-4 space-y-4">
          {top.map((finding) => {
            const severity = SEVERITY[finding.severity];
            const evidence = finding.evidence[0];
            return (
              <li key={finding.id} className="rounded-lg border border-line bg-panel p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={severity.tone}>{severity.label}</StatusPill>
                  {finding.source === 'semantic' && <span className="text-xs font-medium text-violet-800">AI-assisted</span>}
                </div>
                <h3 className="mt-2 font-semibold">{finding.title}</h3>
                <p className="mt-1 text-sm text-ink-soft">{finding.detail}</p>
                {evidence && (
                  <p className="mt-2 rounded bg-canvas px-3 py-2 text-xs text-ink-soft">
                    <span className="font-mono">“{evidence.snippet}”</span> <span className="text-muted">— {pathOf(evidence.pageUrl)}</span>
                  </p>
                )}
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-muted">Why it matters</dt>
                    <dd className="mt-0.5">{finding.whyItMatters}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">Proposed fix</dt>
                    <dd className="mt-0.5">{finding.recommendedFix}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
      </section>

      {changes.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold">What EdgeSuite Pro would change</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-line bg-panel">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left text-xs text-muted">
                <tr>
                  <th className="w-1/2 px-4 py-2 font-medium">Current</th>
                  <th className="w-1/2 px-4 py-2 font-medium">Improved</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((finding) => (
                  <tr key={finding.id} className="border-t border-line align-top">
                    <td className="px-4 py-3 text-ink-soft">
                      <span className="block font-medium text-ink">{finding.title}</span>
                      {finding.detail}
                    </td>
                    <td className="px-4 py-3">{finding.recommendedFix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-semibold">Three directions for a better site</h2>
        {concepts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">Concepts have not been generated yet.</p>
        ) : (
          <ul className="mt-4 grid gap-4 md:grid-cols-3">
            {concepts.map((concept) => {
              const definition = STRATEGY_DEFINITIONS[concept.strategy];
              return (
                <li key={concept.id} className="flex flex-col rounded-lg border border-line bg-panel p-5">
                  <p className="text-xs font-medium text-muted">Concept {definition.letter}</p>
                  <h3 className="font-semibold">{definition.name}</h3>
                  <p className="mt-1 flex-1 text-sm text-ink-soft">{definition.summary}</p>
                  <p className="mt-2 text-xs text-muted">Focus: {definition.priorities.slice(0, 3).join(', ')}</p>
                  <a href={`/preview/concept/${concept.id}?mode=clean`} target="_blank" rel="noopener" className="mt-4 inline-block rounded-md bg-steel px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-steel-strong">
                    View concept
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        {concepts.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Concepts use only information found on the current website. Details the site does not state (for example reviews or turnaround times) are
            left for the owner to confirm. They are not invented.
          </p>
        )}
      </section>

      {opportunities.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold">Potential opportunities</h2>
          <p className="mt-1 text-sm text-ink-soft">Requires owner confirmation. Ideas to discuss, not services we assume you offer.</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {opportunities.map((finding) => (
              <li key={finding.id}>{finding.title.replace(/^Potential opportunity — requires owner confirmation: /, '')}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t border-line pt-4 text-xs text-muted">
        Reviewed {audit.run.finishedAt ? new Date(audit.run.finishedAt).toLocaleDateString() : ''} · {audit.run.rulesetVersion}
        {audit.run.semanticPromptVersion ? ` · ${audit.run.semanticPromptVersion}` : ''}
      </footer>
    </main>
  );
}

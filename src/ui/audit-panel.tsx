import type { AuditFindingRecord, AuditView } from '../server/audit/service';
import { ActionButton } from './action-button';
import { StatusPill } from './status-pill';

const SEVERITY: Record<string, { label: string; tone: 'bad' | 'warn' | 'neutral' }> = {
  high: { label: 'High priority', tone: 'bad' },
  medium: { label: 'Medium', tone: 'warn' },
  low: { label: 'Low', tone: 'neutral' },
};

const pathOf = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
};

const fmtPoints = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

function Evidence({ finding }: { finding: AuditFindingRecord }) {
  if (!finding.evidence.length) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted hover:text-ink">Evidence ({finding.evidence.length})</summary>
      <ul className="mt-2 space-y-2">
        {finding.evidence.map((evidence, index) => (
          <li key={index} className="rounded bg-canvas px-3 py-2">
            <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-ink-soft">“{evidence.snippet}”</p>
            <p className="mt-1 text-muted">
              {pathOf(evidence.pageUrl)} · {evidence.locator}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FindingCard({ finding, categoryLabel }: { finding: AuditFindingRecord; categoryLabel: string }) {
  const severity = SEVERITY[finding.severity] ?? SEVERITY.low!;
  const lost = finding.pointsPossible - finding.pointsAwarded;
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!finding.requiresOwnerConfirmation && <StatusPill tone={severity.tone}>{severity.label}</StatusPill>}
        <span className="text-muted">{categoryLabel}</span>
        {lost > 0 && <span className="ml-auto tabular-nums text-muted">−{fmtPoints(lost)} of {fmtPoints(finding.pointsPossible)} pts</span>}
      </div>
      <h4 className="mt-2 font-medium">{finding.title}</h4>
      <p className="mt-1 text-sm text-ink-soft">{finding.detail}</p>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted">Why it matters</dt>
          <dd className="mt-0.5 text-ink-soft">{finding.whyItMatters}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">Recommended fix</dt>
          <dd className="mt-0.5 text-ink-soft">{finding.recommendedFix}</dd>
        </div>
      </dl>
      <Evidence finding={finding} />
    </li>
  );
}

export function AuditPanel({
  view,
  analyzing,
  reAudit,
}: {
  view: AuditView | null;
  analyzing: boolean;
  reAudit: () => Promise<{ error?: string }>;
}) {
  if (!view || view.run.status !== 'completed') {
    return (
      <section className="rounded-lg border border-line bg-panel p-6">
        <h2 className="font-semibold">Website audit</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {view?.run.status === 'failed'
            ? view.run.error ?? 'The audit failed.'
            : analyzing || view?.pending
              ? 'Auditing the website… this page updates automatically.'
              : 'Analyze the website to audit it.'}
        </p>
      </section>
    );
  }

  const { run, findings, categoryInfo } = view;
  const label = (category: string) => categoryInfo[category as keyof typeof categoryInfo]?.label ?? category;
  const scored = (run.categories ?? []).filter((category) => categoryInfo[category.category].weight > 0);
  const problems = findings.filter((finding) => (finding.outcome === 'fail' || finding.outcome === 'partial') && finding.pointsPossible > 0);
  const opportunities = findings.filter((finding) => finding.category === 'revenue_opportunities' && (finding.outcome === 'fail' || finding.outcome === 'partial'));
  const working = findings.filter((finding) => finding.outcome === 'pass');
  const notAssessed = findings.filter((finding) => finding.outcome === 'not_applicable' || finding.outcome === 'unknown');
  const high = problems.filter((finding) => finding.severity === 'high').length;

  return (
    <section className="space-y-6">
      {view.stale && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-5 py-3 text-sm text-signal-warn ring-1 ring-amber-200">
          <span>Business facts changed after this audit ran (re-read or reviewed). Re-run the audit to include them.</span>
          {!view.pending && <ActionButton action={reAudit} label="Re-run audit" pendingLabel="Starting…" />}
        </div>
      )}

      <div className="rounded-lg border border-line bg-panel">
        <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] md:gap-10">
          <div>
            <p className="text-xs font-medium text-muted">{view.scoreName}</p>
            <p className="mt-1 font-semibold leading-none tabular-nums">
              <span className="text-6xl">{run.overallScore ?? '—'}</span>
              <span className="ml-1 text-xl text-muted">/100</span>
            </p>
            <p className="mt-3 text-sm text-ink-soft">
              {problems.length} issue{problems.length === 1 ? '' : 's'} found{high ? `, ${high} high priority` : ''}. {working.length} checks passed.
            </p>
            <p className="mt-3 text-xs leading-5 text-muted">
              An internal EdgeSuite Pro measure of how well this site helps a sharpening business get found and win customers. It is not an
              industry-standard SEO score.
            </p>
          </div>
          <ul className="space-y-3" aria-label="Category scores">
            {scored.map((category) => {
              const info = categoryInfo[category.category];
              const value = category.score;
              return (
                <li key={category.category}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 sm:grid-cols-[150px_minmax(0,1fr)_56px]">
                    <span className="text-sm font-medium">{info.label}</span>
                    <span className="hidden sm:block">
                      <span
                        className="block h-2 rounded-full bg-sky-100"
                        role="meter"
                        aria-label={`${info.label} score`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={value ?? undefined}
                        title={`${category.earned} of ${category.possible} points from ${category.rulesAssessed} checks`}
                      >
                        {value !== null && <span className="block h-2 rounded-full bg-steel" style={{ width: `${Math.max(value, 2)}%` }} />}
                      </span>
                    </span>
                    <span className="text-right text-sm tabular-nums">{value === null ? 'n/a' : value}</span>
                  </div>
                  <span className="mt-1 block h-2 rounded-full bg-sky-100 sm:hidden" aria-hidden="true">
                    {value !== null && <span className="block h-2 rounded-full bg-steel" style={{ width: `${Math.max(value, 2)}%` }} />}
                  </span>
                  <p className="mt-0.5 text-xs text-muted sm:ml-[162px]">{info.question}</p>
                </li>
              );
            })}
          </ul>
        </div>
        {run.caveats.length > 0 && (
          <ul className="border-t border-line px-5 py-3 text-xs text-ink-soft">
            {run.caveats.map((caveat) => (
              <li key={caveat}>Note: {caveat}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-line bg-panel">
        <div className="border-b border-line px-5 py-4">
          <h3 className="font-semibold">What we found</h3>
          <p className="mt-1 text-sm text-ink-soft">Most important first. Each finding shows the evidence and the fix.</p>
        </div>
        {problems.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-soft">No problems found by the automated checks.</p>
        ) : (
          <>
            <ol className="divide-y divide-line">
              {problems
                .filter((finding) => finding.severity !== 'low')
                .map((finding) => (
                  <FindingCard key={finding.id} finding={finding} categoryLabel={label(finding.category)} />
                ))}
            </ol>
            {problems.some((finding) => finding.severity === 'low') && (
              <details className="border-t border-line">
                <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-steel hover:underline">
                  {problems.filter((finding) => finding.severity === 'low').length} lower-priority findings
                </summary>
                <ol className="divide-y divide-line border-t border-line">
                  {problems
                    .filter((finding) => finding.severity === 'low')
                    .map((finding) => (
                      <FindingCard key={finding.id} finding={finding} categoryLabel={label(finding.category)} />
                    ))}
                </ol>
              </details>
            )}
          </>
        )}
      </div>

      {opportunities.length > 0 && (
        <div className="rounded-lg border border-line bg-panel">
          <div className="border-b border-line px-5 py-4">
            <h3 className="font-semibold">Potential opportunities</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Requires owner confirmation. These are ideas to discuss, not services the business is known to offer — they are never added to
              concepts automatically, and they do not affect the score.
            </p>
          </div>
          <ol className="divide-y divide-line">
            {opportunities.map((finding) => (
              <FindingCard key={finding.id} finding={finding} categoryLabel="Revenue opportunity" />
            ))}
          </ol>
        </div>
      )}

      <details className="rounded-lg border border-line bg-panel px-5 py-3">
        <summary className="cursor-pointer text-sm font-semibold">What’s working ({working.length})</summary>
        <ul className="mt-3 divide-y divide-line text-sm">
          {working.map((finding) => (
            <li key={finding.id} className="py-2">
              <p className="font-medium">{finding.title}</p>
              <p className="text-ink-soft">{finding.detail}</p>
              <Evidence finding={finding} />
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-lg border border-line bg-panel px-5 py-3">
        <summary className="cursor-pointer text-sm font-semibold">How this score is calculated</summary>
        <div className="mt-3 space-y-4 text-sm text-ink-soft">
          <p>
            Each check below is a fixed, versioned rule ({run.rulesetVersion}). A check earns all, part or none of its points. A category score is
            points earned divided by points available for the checks that could be assessed; checks that do not apply, or could not be assessed, are
            left out rather than counted against the site. The overall score is the weighted average of the category scores.
          </p>
          {scored.map((category) => {
            const info = categoryInfo[category.category];
            const rows = findings.filter((finding) => finding.category === category.category);
            return (
              <div key={category.category}>
                <p className="font-medium text-ink">
                  {info.label} — weight {info.weight}% — {category.earned} / {category.possible} pts
                  {category.rulesSkipped ? ` (${category.rulesSkipped} not assessed)` : ''}
                </p>
                <table className="mt-1 w-full text-xs">
                  <tbody>
                    {rows.map((finding) => (
                      <tr key={finding.id} className="border-t border-line/70 align-top">
                        <td className="py-1 pr-3">{finding.title}</td>
                        <td className="whitespace-nowrap py-1 pr-3 text-muted">{finding.outcome.replace('_', ' ')}</td>
                        <td className="whitespace-nowrap py-1 text-right tabular-nums">
                          {finding.outcome === 'not_applicable' || finding.outcome === 'unknown' ? '—' : `${fmtPoints(finding.pointsAwarded)} / ${fmtPoints(finding.pointsPossible)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {notAssessed.length > 0 && (
            <div>
              <p className="font-medium text-ink">Not assessed</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {notAssessed.map((finding) => (
                  <li key={finding.id}>
                    {finding.title.replace(/^Potential opportunity — requires owner confirmation: /, '')}: {finding.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>
          Audit {run.id.slice(0, 8)} · {run.rulesetVersion} · {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : ''}
        </span>
        {!view.stale && !view.pending && <ActionButton action={reAudit} label="Re-run audit" pendingLabel="Starting…" />}
      </div>
    </section>
  );
}

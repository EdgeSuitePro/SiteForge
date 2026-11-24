import Link from 'next/link';

import type { ClaimKind } from '../core/concepts/claims';
import { STRATEGY_DEFINITIONS } from '../core/concepts/strategies';
import type { ConceptRecord, ConceptsView } from '../server/concepts/service';
import { ActionButton } from './action-button';
import { StatusPill } from './status-pill';

const KIND_LABEL: Record<ClaimKind, string> = {
  price: 'Price',
  number: 'Number',
  year: 'Year',
  experience: 'Experience',
  turnaround: 'Turnaround',
  guarantee: 'Guarantee',
  credential: 'Credential / award',
  superlative: 'Superlative',
  rating: 'Rating / count',
  testimonial: 'Testimonial',
  place: 'Place',
  service: 'Service',
  service_not_offered: 'Service not offered',
  contact_detail: 'Contact detail',
  copied_text: 'Copied text',
};

const PROVIDER_LABEL: Record<string, { label: string; tone: 'good' | 'warn' | 'neutral' }> = {
  anthropic: { label: 'AI-written copy', tone: 'good' },
  mock: { label: 'Mock (no AI configured): fact-only draft', tone: 'warn' },
  draft: { label: 'Fact-only draft (AI unavailable)', tone: 'warn' },
};

function ConceptCard({ concept, prospectId }: { concept: ConceptRecord; prospectId: string }) {
  const definition = STRATEGY_DEFINITIONS[concept.strategy];
  const report = concept.claimReport;
  const provider = PROVIDER_LABEL[concept.provider ?? ''] ?? { label: concept.provider ?? '—', tone: 'neutral' as const };
  return (
    <li className="flex flex-col rounded-lg border border-line bg-panel">
      <div className="border-b border-line px-5 py-4">
        <p className="text-xs font-medium text-muted">Concept {definition.letter}</p>
        <h3 className="mt-0.5 font-semibold">{definition.name}</h3>
        <p className="mt-1 text-sm text-ink-soft">{definition.summary}</p>
      </div>
      <div className="flex-1 space-y-3 px-5 py-4 text-sm">
        {concept.status === 'completed' ? (
          <>
            <StatusPill tone={provider.tone}>{provider.label}</StatusPill>
            {concept.error && <p className="text-xs text-signal-warn">{concept.error}</p>}
            {concept.content?.rationale && <p className="text-ink-soft">{concept.content.rationale}</p>}
            {report && (
              <p className="text-xs text-muted">
                Claim check: {report.claimsChecked} claims checked · {report.violations.length} unsupported removed · {report.placeholders} operator note
                {report.placeholders === 1 ? '' : 's'}
              </p>
            )}
          </>
        ) : concept.status === 'failed' ? (
          <p className="text-signal-bad">{concept.error ?? 'Generation failed.'}</p>
        ) : (
          <p className="text-ink-soft">{concept.status === 'running' ? 'Writing and checking…' : 'Queued…'}</p>
        )}
      </div>
      {concept.status === 'completed' && (
        <div className="space-y-3 border-t border-line px-5 py-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={`/preview/concept/${concept.id}`} target="_blank" rel="noopener" className="rounded-md bg-steel px-3 py-1.5 font-medium text-white hover:bg-steel-strong">
              Open preview
            </a>
            <a href={`/preview/concept/${concept.id}?mode=clean`} target="_blank" rel="noopener" className="rounded-md px-3 py-1.5 text-ink-soft ring-1 ring-line hover:bg-canvas">
              Without notes
            </a>
            <Link href={`/prospects/${prospectId}/compare?concept=${concept.strategy}`} className="rounded-md px-3 py-1.5 text-ink-soft ring-1 ring-line hover:bg-canvas">
              Compare
            </Link>
          </div>
          {report && (report.violations.length > 0 || report.structural.length > 0) && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted hover:text-ink">What the claim check changed ({report.violations.length + report.structural.length})</summary>
              <ul className="mt-2 space-y-2">
                {report.violations.map((violation, index) => (
                  <li key={`v${index}`} className="rounded bg-canvas px-3 py-2">
                    <span className="font-medium text-signal-bad">{KIND_LABEL[violation.kind]}:</span> “{violation.claim}”
                    <span className="block text-muted">in “{violation.sentence}”</span>
                  </li>
                ))}
                {report.structural.map((issue, index) => (
                  <li key={`s${index}`} className="rounded bg-canvas px-3 py-2 text-ink-soft">
                    {issue.issue}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-[11px] text-muted">
            {concept.rendererVersion} · {concept.promptVersion} · {concept.claimCheckVersion}
          </p>
        </div>
      )}
    </li>
  );
}

export function ConceptsPanel({
  view,
  prospectId,
  generate,
}: {
  view: ConceptsView | null;
  prospectId: string;
  generate: () => Promise<{ error?: string }>;
}) {
  if (!view || (!view.canGenerate && view.concepts.length === 0)) {
    return (
      <section className="rounded-lg border border-line bg-panel p-6">
        <h2 className="font-semibold">Website concepts</h2>
        <p className="mt-1 text-sm text-ink-soft">Analyze the website first. Concepts are built from the verified facts and the audit.</p>
      </section>
    );
  }
  const done = view.concepts.filter((concept) => concept.status === 'completed').length;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-line bg-panel px-5 py-4">
        <div className="max-w-2xl">
          <h2 className="font-semibold">Website concepts</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Three strategically different homepages built only from facts found on the current site. Anything the site does not support is removed
            and marked for the operator. Previews are private and never indexed; the current website is not modified.
          </p>
          {view.generation > 0 && (
            <p className="mt-2 text-xs text-muted">
              Set {view.generation}
              {view.previousGenerations ? ` (${view.previousGenerations} earlier set${view.previousGenerations === 1 ? '' : 's'} kept)` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {done > 0 && (
            <>
              <Link href={`/prospects/${prospectId}/compare`} className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-soft ring-1 ring-line hover:bg-canvas">
                Compare all
              </Link>
              <Link href={`/prospects/${prospectId}/present`} className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-soft ring-1 ring-line hover:bg-canvas">
                Presentation
              </Link>
            </>
          )}
          {view.canGenerate && (
            <ActionButton
              action={generate}
              label={view.generation ? 'Generate new set' : 'Generate 3 concepts'}
              pendingLabel="Starting…"
              variant={view.generation ? 'quiet' : 'primary'}
            />
          )}
        </div>
      </div>
      {view.outdated && (
        <p className="rounded-lg bg-amber-50 px-5 py-3 text-sm text-signal-warn ring-1 ring-amber-200">
          The site has been re-analyzed since these concepts were made. Generate a new set to use the latest facts and audit.
        </p>
      )}
      {view.concepts.length > 0 && (
        <ul className="grid gap-4 lg:grid-cols-3">
          {view.concepts.map((concept) => (
            <ConceptCard key={concept.id} concept={concept} prospectId={prospectId} />
          ))}
        </ul>
      )}
    </section>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { ProfileFact, ProfileField } from '../core/facts/profile';
import type { BusinessProfileView } from '../server/facts/service';
import type { CrawlProgressDto } from './crawl-progress';
import { StatusPill } from './status-pill';

type Jsonified<T> = T extends Date ? string : T extends (infer U)[] ? Jsonified<U>[] : T extends object ? { [K in keyof T]: Jsonified<T[K]> } : T;
export type BusinessProfileDto = Jsonified<BusinessProfileView>;
type FactDto = Jsonified<ProfileFact>;
type FieldDto = Jsonified<ProfileField>;
type ReviewStatus = 'unverified' | 'verified' | 'rejected';

const METHOD_LABEL: Record<string, string> = {
  structured_data: 'structured data',
  markup: 'page markup',
  text_pattern: 'page text',
  ai_extracted: 'AI-assisted reading (quote verified)',
  operator: 'operator',
};

const SERVICE_FIELDS = new Set(['services', 'not_offered']);
const DETAIL_FIELDS = ['pricing', 'turnaround', 'hours', 'service_area', 'reviews', 'faq', 'years', 'booking', 'contact_methods', 'social', 'structured_data'];
const CORE_FIELDS = ['business_name', 'owner', 'phone', 'email', 'address', 'location', 'logo'];

function pathOf(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

/** Only ever link out to http(s) URLs taken from crawled data. */
function SafeExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  const safe = /^https?:\/\//i.test(href);
  if (!safe) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-line underline-offset-2 hover:text-steel">
      {children}
    </a>
  );
}

function sourceSummary(fact: FactDto): string {
  const pages = fact.pageCount === 1 ? '1 page' : `${fact.pageCount} pages`;
  const where = [fact.onHomepage ? 'homepage' : null, fact.inHeader ? 'header' : null].filter(Boolean).join(', ');
  return `From ${METHOD_LABEL[fact.method] ?? fact.method} · ${pages}${where ? ` · ${where}` : ''}`;
}

function FactRow({
  fact,
  onReview,
  pending,
  compact = false,
}: {
  fact: FactDto;
  onReview: (fact: FactDto, status: ReviewStatus) => void;
  pending: boolean;
  compact?: boolean;
}) {
  const verified = fact.status === 'verified';
  const isUrl = fact.type === 'social_profile' && typeof fact.value.url === 'string';
  return (
    <div className={`rounded-md ${compact ? 'py-2' : 'py-2.5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <p className="break-words text-sm text-ink">
            {isUrl ? <SafeExternalLink href={String(fact.value.url)}>{fact.display}</SafeExternalLink> : fact.display}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {sourceSummary(fact)}
            {fact.confidence === 'low' && ' · weak signal'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {verified ? (
            <StatusPill tone="good">Verified</StatusPill>
          ) : (
            <span className="text-xs text-muted">Found on site</span>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => onReview(fact, verified ? 'unverified' : 'verified')}
            className="rounded px-2 py-1 text-xs font-medium text-steel ring-1 ring-line hover:bg-canvas disabled:opacity-50"
            aria-label={verified ? `Undo verification of ${fact.display}` : `Verify ${fact.display}`}
          >
            {verified ? 'Undo' : 'Verify'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onReview(fact, 'rejected')}
            className="rounded px-2 py-1 text-xs font-medium text-ink-soft ring-1 ring-line hover:bg-canvas disabled:opacity-50"
            aria-label={`Reject ${fact.display}`}
          >
            Reject
          </button>
        </div>
      </div>
      <details className="mt-1.5 text-xs">
        <summary className="cursor-pointer text-muted hover:text-ink">Evidence ({fact.evidence.length})</summary>
        <ul className="mt-2 space-y-2">
          {fact.evidence.map((evidence, index) => (
            <li key={index} className="rounded bg-canvas px-3 py-2">
              <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-ink-soft">“{evidence.snippet}”</p>
              <p className="mt-1 text-muted">
                <SafeExternalLink href={evidence.pageUrl}>{pathOf(evidence.pageUrl)}</SafeExternalLink> · {evidence.locator}
              </p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function FieldCard({ field, onReview, pending }: { field: FieldDto; onReview: (fact: FactDto, status: ReviewStatus) => void; pending: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const values = field.kind === 'single' ? (field.primary ? [field.primary] : []) : field.values;
  const alternatives = field.kind === 'single' ? field.values.slice(1) : [];
  const limit = 6;
  const visible = showAll ? values : values.slice(0, limit);

  return (
    <div className="border-b border-line px-5 py-3 last:border-b-0 sm:grid sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6">
      <h4 className="pt-2.5 text-sm font-medium text-ink-soft">{field.label}</h4>
      <div className="min-w-0">
        {values.length === 0 ? (
          <p className="py-2.5 text-sm text-muted">Not found on the website</p>
        ) : (
          <div className="divide-y divide-line/70">
            {visible.map((fact) => (
              <FactRow key={fact.id} fact={fact} onReview={onReview} pending={pending} compact={field.kind === 'list'} />
            ))}
          </div>
        )}
        {values.length > limit && (
          <button type="button" onClick={() => setShowAll(!showAll)} className="mb-2 text-xs font-medium text-steel hover:underline">
            {showAll ? 'Show fewer' : `Show all ${values.length}`}
          </button>
        )}
        {alternatives.length > 0 && (
          <details className="mb-2 text-xs">
            <summary className="cursor-pointer text-muted hover:text-ink">
              {alternatives.length} other value{alternatives.length === 1 ? '' : 's'} found
            </summary>
            <div className="divide-y divide-line/70">
              {alternatives.map((fact) => (
                <FactRow key={fact.id} fact={fact} onReview={onReview} pending={pending} compact />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export function BusinessProfilePanel({
  view,
  crawl,
  review,
  reExtract,
}: {
  view: BusinessProfileDto | null;
  crawl: CrawlProgressDto | null;
  review: (factId: string, status: ReviewStatus) => Promise<{ error?: string }>;
  reExtract: () => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onReview = (fact: FactDto, status: ReviewStatus) =>
    startTransition(async () => {
      setError(null);
      const result = await review(fact.id, status);
      if (result.error) setError(result.error);
      router.refresh();
    });

  if (!view || view.run.status !== 'completed') {
    const working = view?.run.status === 'queued' || view?.run.status === 'running' || crawl?.run.status === 'running' || crawl?.run.status === 'queued';
    return (
      <section className="rounded-lg border border-line bg-panel p-6">
        <h2 className="font-semibold">Business profile</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {working
            ? 'Reading the crawled pages for business information…'
            : view?.run.status === 'failed'
              ? view.run.error ?? 'Fact extraction failed.'
              : 'Analyze the website to build a profile from what it actually says.'}
        </p>
      </section>
    );
  }

  const byField = new Map<string, FieldDto>(view.profile.map((field) => [field.field, field]));
  const fields = (names: string[]) => names.map((name) => byField.get(name)).filter((field): field is FieldDto => Boolean(field));
  const found = view.profile.filter((field) => field.values.length > 0 && !['structured_data', 'not_offered'].includes(field.field)).length;
  const total = view.profile.length - 2;
  const brand = view.run.brand;

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-line bg-panel">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold">Business profile</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Only what the website itself states. {found} of {total} items found. Verify facts you have confirmed with the owner;
              reject anything wrong. Missing items are never filled in automatically.
            </p>
          </div>
          {view.pending ? (
            <StatusPill tone="active">Re-reading pages…</StatusPill>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await reExtract();
                  if (result.error) setError(result.error);
                  router.refresh();
                })
              }
              className="rounded-md px-3 py-1.5 text-sm text-ink-soft ring-1 ring-line hover:bg-canvas disabled:opacity-50"
            >
              Re-read pages
            </button>
          )}
        </div>
        {error && <p role="alert" className="border-b border-line bg-red-50 px-5 py-2 text-sm text-signal-bad">{error}</p>}
        {fields(CORE_FIELDS).map((field) => (
          <FieldCard key={field.field} field={field} onReview={onReview} pending={pending} />
        ))}
      </div>

      <div className="rounded-lg border border-line bg-panel">
        <div className="border-b border-line px-5 py-4">
          <h3 className="font-semibold">Services</h3>
          <p className="mt-1 text-sm text-ink-soft">
            Mentions matched against the sharpening service vocabulary ({view.run.taxonomyVersion}). A mention is not proof the
            service is offered — check the evidence.
          </p>
          {view.conflicts.length > 0 && (
            <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-sm text-signal-warn">
              The site both mentions and disclaims: {view.conflicts.join(', ').replace(/_/g, ' ')}. Confirm with the owner.
            </p>
          )}
        </div>
        {fields([...SERVICE_FIELDS]).map((field) => (
          <FieldCard key={field.field} field={field} onReview={onReview} pending={pending} />
        ))}
      </div>

      <div className="rounded-lg border border-line bg-panel">
        <h3 className="border-b border-line px-5 py-4 font-semibold">Customer journey details</h3>
        {fields(DETAIL_FIELDS).map((field) => (
          <FieldCard key={field.field} field={field} onReview={onReview} pending={pending} />
        ))}
      </div>

      {brand && (
        <div className="rounded-lg border border-line bg-panel px-5 py-4">
          <h3 className="font-semibold">Brand</h3>
          <p className="mt-1 text-sm text-ink-soft">Colours and fonts used across the site’s styles, most used first.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted">Brand colours</p>
              {brand.brandColors.length === 0 ? (
                <p className="mt-1 text-sm text-muted">Not found</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {brand.brandColors.map((hex) => (
                    <li key={hex} className="flex items-center gap-2 rounded bg-canvas py-1 pl-1 pr-2 text-xs">
                      <span className="size-5 rounded ring-1 ring-black/10" style={{ backgroundColor: hex }} aria-hidden="true" />
                      <span className="font-mono">{hex}</span>
                    </li>
                  ))}
                </ul>
              )}
              {brand.neutrals.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Neutral colours">
                  {brand.neutrals.map((hex) => (
                    <li key={hex} className="flex items-center gap-2 rounded bg-canvas py-1 pl-1 pr-2 text-xs text-muted">
                      <span className="size-4 rounded ring-1 ring-black/10" style={{ backgroundColor: hex }} aria-hidden="true" />
                      <span className="font-mono">{hex}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-muted">Fonts</p>
              <p className="mt-1 text-sm">{brand.fonts.length ? brand.fonts.join(', ') : 'Not found'}</p>
              {brand.themeColor && <p className="mt-2 text-xs text-muted">Browser theme colour: <span className="font-mono">{brand.themeColor}</span></p>}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        Extraction {view.run.id.slice(0, 8)} · {view.run.extractorVersion} · {view.run.factsVersion} · {view.run.brandVersion} ·{' '}
        {view.run.stats?.pages ?? 0} pages · {view.run.finishedAt ? new Date(view.run.finishedAt).toLocaleString() : ''}
      </p>
    </section>
  );
}

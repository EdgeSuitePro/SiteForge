'use client';

import { useState } from 'react';

export interface CompareConcept {
  id: string;
  strategy: string;
  letter: string;
  name: string;
  summary: string;
}

export interface CurrentSite {
  url: string;
  domain: string;
  score: number | null;
  problems: { title: string; severity: string }[];
}

type View = 'current' | string;
type Device = 'desktop' | 'mobile';

const DEVICE_WIDTH: Record<Device, string> = { desktop: '100%', mobile: '390px' };

/**
 * Concepts are shown in iframes sandboxed WITHOUT allow-same-origin or allow-scripts: the preview
 * pages contain no scripts anyway, and the sandbox gives them an opaque origin so they could never
 * read SiteForge's cookies or DOM even if that changed.
 */
function Frame({ concept, device, notes, title }: { concept: CompareConcept; device: Device; notes: boolean; title: string }) {
  return (
    <iframe
      title={title}
      src={`/preview/concept/${concept.id}${notes ? '' : '?mode=clean'}`}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      loading="lazy"
      className="block h-[760px] rounded-md border border-line bg-white"
      style={{ width: DEVICE_WIDTH[device], maxWidth: '100%' }}
    />
  );
}

export function ConceptCompare({ concepts, current, initial }: { concepts: CompareConcept[]; current: CurrentSite; initial: string | null }) {
  const [view, setView] = useState<View>(concepts.find((concept) => concept.strategy === initial)?.strategy ?? concepts[0]?.strategy ?? 'current');
  const [device, setDevice] = useState<Device>('desktop');
  const [notes, setNotes] = useState(true);
  const [sideBySide, setSideBySide] = useState(false);
  const selected = concepts.find((concept) => concept.strategy === view);

  const tab = (key: View, label: string) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={!sideBySide && view === key}
      onClick={() => {
        setSideBySide(false);
        setView(key);
      }}
      className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${!sideBySide && view === key ? 'border-steel text-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line">
        <div role="tablist" aria-label="Website versions" className="flex overflow-x-auto">
          {tab('current', 'Current website')}
          {concepts.map((concept) => tab(concept.strategy, `${concept.letter} — ${concept.name}`))}
          <button
            type="button"
            onClick={() => setSideBySide(true)}
            aria-pressed={sideBySide}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${sideBySide ? 'border-steel text-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}
          >
            All on mobile
          </button>
        </div>
        <div className="flex items-center gap-3 pb-2 text-sm">
          {!sideBySide && view !== 'current' && (
            <div role="group" aria-label="Device" className="inline-flex rounded-md ring-1 ring-line">
              {(['desktop', 'mobile'] as Device[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={device === option}
                  onClick={() => setDevice(option)}
                  className={`px-3 py-1 capitalize ${device === option ? 'bg-steel text-white' : 'text-ink-soft hover:bg-canvas'} first:rounded-l-md last:rounded-r-md`}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <label className="inline-flex items-center gap-2 text-ink-soft">
            <input type="checkbox" checked={notes} onChange={(event) => setNotes(event.target.checked)} />
            Operator notes
          </label>
        </div>
      </div>

      {sideBySide ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {concepts.map((concept) => (
            <div key={concept.id} className="shrink-0">
              <p className="mb-2 text-sm font-medium">
                {concept.letter} — {concept.name}
              </p>
              <Frame concept={concept} device="mobile" notes={notes} title={`Concept ${concept.letter} on mobile`} />
            </div>
          ))}
        </div>
      ) : view === 'current' || !selected ? (
        <div className="rounded-lg border border-line bg-panel p-6">
          <p className="text-xs font-medium text-muted">Current website</p>
          <p className="mt-1 break-all font-semibold">{current.url}</p>
          <p className="mt-3 text-sm text-ink-soft">
            The current site is not embedded here and has not been modified.{' '}
            <a href={current.url} target="_blank" rel="noopener noreferrer nofollow" className="text-steel underline">
              Open it in a new tab
            </a>
            .
          </p>
          {current.score !== null && (
            <p className="mt-4 text-sm">
              ESP Website Opportunity Score: <span className="text-2xl font-semibold tabular-nums">{current.score}</span>
              <span className="text-muted">/100</span>
            </p>
          )}
          {current.problems.length > 0 && (
            <>
              <p className="mt-4 text-sm font-medium">Biggest problems the concepts address</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {current.problems.map((problem) => (
                  <li key={problem.title}>{problem.title}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div>
          <p className="mb-3 text-sm text-ink-soft">{selected.summary}</p>
          <div className="flex justify-center rounded-lg bg-canvas p-3">
            <Frame concept={selected} device={device} notes={notes} title={`Concept ${selected.letter} — ${selected.name}`} />
          </div>
          <p className="mt-2 text-right text-xs">
            <a href={`/preview/concept/${selected.id}${notes ? '' : '?mode=clean'}`} target="_blank" rel="noopener" className="text-steel underline">
              Open full page
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

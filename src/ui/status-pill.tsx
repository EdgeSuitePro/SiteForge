const TONE: Record<string, string> = {
  good: 'bg-emerald-50 text-signal-good ring-emerald-200',
  warn: 'bg-amber-50 text-signal-warn ring-amber-200',
  bad: 'bg-red-50 text-signal-bad ring-red-200',
  active: 'bg-sky-50 text-steel ring-sky-200',
  neutral: 'bg-canvas text-ink-soft ring-line',
};

export function StatusPill({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function prospectTone(status: string): keyof typeof TONE {
  if (status === 'analyzed') return 'good';
  if (status === 'analyzing') return 'active';
  if (status === 'failed') return 'bad';
  return 'neutral';
}

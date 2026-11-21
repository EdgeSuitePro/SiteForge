'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** A button that runs a server action, shows errors inline, and refreshes the page. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  variant = 'quiet',
}: {
  action: () => Promise<{ error?: string }>;
  label: string;
  pendingLabel: string;
  variant?: 'primary' | 'quiet';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const styles =
    variant === 'primary'
      ? 'bg-steel text-white hover:bg-steel-strong'
      : 'text-ink-soft ring-1 ring-line hover:bg-canvas';
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await action();
            if (result.error) setError(result.error);
            router.refresh();
          })
        }
        className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles}`}
      >
        {pending ? pendingLabel : label}
      </button>
      {error && <span role="alert" className="text-xs text-signal-bad">{error}</span>}
    </span>
  );
}

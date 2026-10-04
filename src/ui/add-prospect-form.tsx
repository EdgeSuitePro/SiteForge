'use client';

import { useActionState } from 'react';

import type { ActionState } from '../../app/(operator)/prospects/actions';

const input =
  'mt-1 block w-full rounded-md border border-line bg-panel px-3 py-2 text-sm shadow-sm placeholder:text-muted focus:border-steel focus:outline-none';

export function AddProspectForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="rounded-lg border border-line bg-panel p-5" noValidate>
      <h2 className="font-semibold">Add a sharpening business</h2>
      <p className="mt-1 text-sm text-ink-soft">
        SiteForge reads the public website only. The existing site is never changed.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium sm:col-span-2">
          Website URL
          <input name="websiteUrl" type="url" inputMode="url" required placeholder="example-sharpener.com" className={input} autoComplete="off" />
        </label>
        <label className="block text-sm font-medium">
          Business name <span className="font-normal text-muted">(optional)</span>
          <input name="businessName" maxLength={200} className={input} />
        </label>
        <label className="block text-sm font-medium">
          City / service area <span className="font-normal text-muted">(optional)</span>
          <input name="city" maxLength={200} className={input} />
        </label>
        <label className="block text-sm font-medium sm:col-span-2">
          Notes <span className="font-normal text-muted">(optional, internal)</span>
          <textarea name="notes" rows={2} maxLength={4000} className={input} />
        </label>
      </div>

      {state.error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-signal-bad">
          {state.error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-steel px-4 py-2 text-sm font-medium text-white hover:bg-steel-strong disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Add and analyze'}
        </button>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="analyze" defaultChecked className="size-4 accent-steel" />
          Start analyzing immediately
        </label>
      </div>
    </form>
  );
}

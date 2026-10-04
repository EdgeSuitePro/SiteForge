import { serverEnv } from '@/server/env';

import { devSignInAction } from './actions';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const env = serverEnv();

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <p className="text-xs font-semibold tracking-wide text-muted">EdgeSuite Pro</p>
      <h1 className="mt-1 text-2xl font-semibold">SiteForge</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Website visibility audits and working concepts for sharpening businesses.
      </p>

      <div className="mt-8 rounded-lg border border-line bg-panel p-5">
        {env.auth.mode === 'dev' ? (
          <form action={devSignInAction}>
            <input type="hidden" name="next" value={next ?? ''} />
            <p className="text-sm text-ink-soft">
              Local development mode. You will be signed in as{' '}
              <span className="font-medium text-ink">{env.auth.devOperatorEmail}</span>.
            </p>
            <button
              type="submit"
              className="mt-4 w-full rounded-md bg-steel px-4 py-2.5 text-sm font-medium text-white hover:bg-steel-strong"
            >
              Continue
            </button>
          </form>
        ) : (
          <p className="text-sm text-ink-soft">
            Operator sign-in uses the SiteForge Supabase project, which is not connected yet.
          </p>
        )}
      </div>
    </main>
  );
}

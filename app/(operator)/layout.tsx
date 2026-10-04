import Link from 'next/link';

import { signOutAction } from '@/app-actions/sign-out';
import { requireOperator } from '@/server/auth/operator';

export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const operator = await requireOperator();

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/prospects" className="font-semibold tracking-tight">
              SiteForge
            </Link>
            <nav aria-label="Primary" className="text-sm text-ink-soft">
              <Link href="/prospects" className="hover:text-ink">
                Prospects
              </Link>
            </nav>
          </div>
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <span className="hidden truncate text-muted sm:inline">
              {operator.workspaceName} · {operator.email}
            </span>
            <form action={signOutAction}>
              <button type="submit" className="rounded-md px-2 py-1 text-ink-soft hover:bg-canvas hover:text-ink">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
    </div>
  );
}

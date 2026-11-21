'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-render the server page periodically while background work is in progress. */
export function AutoRefresh({ active, intervalMs = 3_000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}

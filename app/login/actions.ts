'use server';

import { redirect } from 'next/navigation';

import { devSignIn } from '@/server/auth/operator';

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : '';
  // Only allow same-site relative paths (no protocol-relative or absolute URLs).
  return next.startsWith('/') && !next.startsWith('//') ? next : '/prospects';
}

export async function devSignInAction(formData: FormData) {
  await devSignIn();
  redirect(safeNext(formData.get('next')));
}

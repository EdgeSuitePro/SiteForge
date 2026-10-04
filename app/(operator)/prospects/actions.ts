'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';

import { requireOperator } from '@/server/auth/operator';
import { cancelCrawl, createProspect, ServiceError, startCrawl } from '@/server/crawl/service';
import { getDb } from '@/server/db/client';
import { isUuid } from '@/server/http';
import { processJobsInBackground } from '@/server/jobs/runner';
import { log } from '@/server/log';

export interface ActionState {
  error?: string;
}

function messageFor(error: unknown): string {
  if (error instanceof ServiceError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? 'Check the form and try again.';
  log.error('action.failed', { error });
  return 'Something went wrong. Please try again.';
}

export async function createProspectAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const operator = await requireOperator();
  let prospectId: string;
  try {
    const db = await getDb();
    const { prospect } = await createProspect(db, operator, {
      websiteUrl: String(formData.get('websiteUrl') ?? ''),
      businessName: String(formData.get('businessName') ?? ''),
      city: String(formData.get('city') ?? ''),
      notes: String(formData.get('notes') ?? ''),
    });
    prospectId = prospect.id;
    if (formData.get('analyze') === 'on') {
      await startCrawl(db, operator, prospect.id);
      after(() => processJobsInBackground(db, 240_000));
    }
  } catch (error) {
    return { error: messageFor(error) };
  }
  revalidatePath('/prospects');
  redirect(`/prospects/${prospectId}`);
}

export async function analyzeAction(prospectId: string): Promise<ActionState> {
  const operator = await requireOperator();
  if (!isUuid(prospectId)) return { error: 'Prospect not found.' };
  try {
    const db = await getDb();
    await startCrawl(db, operator, prospectId);
    after(() => processJobsInBackground(db, 240_000));
  } catch (error) {
    return { error: messageFor(error) };
  }
  revalidatePath(`/prospects/${prospectId}`);
  return {};
}

export async function cancelAction(prospectId: string): Promise<ActionState> {
  const operator = await requireOperator();
  if (!isUuid(prospectId)) return { error: 'Prospect not found.' };
  try {
    await cancelCrawl(await getDb(), operator, prospectId);
  } catch (error) {
    return { error: messageFor(error) };
  }
  revalidatePath(`/prospects/${prospectId}`);
  return {};
}

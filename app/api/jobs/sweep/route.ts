import { after } from 'next/server';

import { getDb } from '@/server/db/client';
import { serverEnv } from '@/server/env';
import { errorResponse, hasBearerSecret } from '@/server/http';
import { hasDueJobs, processJobsInBackground } from '@/server/jobs/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Vercel Cron safety net (every minute): resumes queued work and jobs whose lease expired
 * because a worker invocation died. Vercel sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  try {
    const env = serverEnv();
    if (!hasBearerSecret(request, env.cronSecret ?? (env.isDeployed ? undefined : env.jobSecret))) {
      return Response.json({ error: 'Unauthorized.' }, { status: 401 });
    }
    const db = await getDb();
    const due = await hasDueJobs(db);
    if (due) after(() => processJobsInBackground(db, 240_000));
    return Response.json({ ok: true, due });
  } catch (error) {
    return errorResponse(error);
  }
}

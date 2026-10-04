import { after } from 'next/server';

import { getDb } from '@/server/db/client';
import { serverEnv } from '@/server/env';
import { errorResponse, hasBearerSecret } from '@/server/http';
import { processJobsInBackground } from '@/server/jobs/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Internal: start a worker invocation. Authenticated by JOB_SECRET, not by operator session. */
export async function POST(request: Request) {
  try {
    if (!hasBearerSecret(request, serverEnv().jobSecret)) {
      return Response.json({ error: 'Unauthorized.' }, { status: 401 });
    }
    const db = await getDb();
    after(() => processJobsInBackground(db, 240_000));
    return Response.json({ accepted: true }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

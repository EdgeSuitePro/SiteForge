import { after } from 'next/server';

import { requireApiOperator } from '@/server/auth/operator';
import { getLatestCrawlProgress } from '@/server/crawl/service';
import { getDb } from '@/server/db/client';
import { errorResponse, isUuid } from '@/server/http';
import { hasDueJobs, processJobsInBackground } from '@/server/jobs/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Crawl progress for the operator UI (polled while a crawl is active). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const operator = await requireApiOperator();
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: 'Prospect not found.' }, { status: 404 });
    const db = await getDb();
    const progress = await getLatestCrawlProgress(db, operator.workspaceId, id);

    // Safety net: if work is due but no worker holds it (e.g. a lost hand-off), start one.
    if (progress && (progress.run.status === 'queued' || progress.run.status === 'running') && (await hasDueJobs(db))) {
      after(() => processJobsInBackground(db, 240_000));
    }
    return Response.json({ progress });
  } catch (error) {
    return errorResponse(error);
  }
}

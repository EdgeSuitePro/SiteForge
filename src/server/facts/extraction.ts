import 'server-only';

import { gunzipSync } from 'node:zlib';

import { and, desc, eq, inArray, ne } from 'drizzle-orm';

import { analyzeBrand, BRAND_VERSION, type CssSource } from '../../core/brand/brand';
import { fetchStylesheets } from '../../core/brand/stylesheets';
import type { SafeFetcher } from '../../core/crawl/fetcher';
import { EXTRACTOR_VERSION, parseDocument } from '../../core/extract/document';
import { extractFacts, FACTS_VERSION, TAXONOMY_VERSION } from '../../core/facts';
import type { SourcePage } from '../../core/facts/types';
import { recordActivity } from '../activity';
import type { Database } from '../db/client';
import {
  businessFacts,
  crawlPageBodies,
  crawlPages,
  crawlRuns,
  extractionRuns,
  pageExtractions,
  prospects,
  type ExtractionStats,
} from '../db/schema';
import { enqueueJob } from '../jobs/queue';
import { log } from '../log';

export const EXTRACT_JOB = 'extract';

export const extractionVersions = () => ({
  extractorVersion: EXTRACTOR_VERSION,
  factsVersion: FACTS_VERSION,
  taxonomyVersion: TAXONOMY_VERSION,
  brandVersion: BRAND_VERSION,
});

/** Create an extraction run for a crawl and queue its job (idempotent per active run). */
export async function queueExtraction(
  db: Database,
  input: { workspaceId: string; prospectId: string; crawlRunId: string; requestedBy?: string | null },
) {
  const [run] = await db
    .insert(extractionRuns)
    .values({ ...input, requestedBy: input.requestedBy ?? null, ...extractionVersions() })
    .returning();
  if (!run) throw new Error('Extraction run insert failed');
  await enqueueJob(db, {
    kind: EXTRACT_JOB,
    payload: { extractionRunId: run.id },
    workspaceId: input.workspaceId,
    dedupeKey: `extract:${run.id}`,
    priority: 5,
  });
  return run;
}

/** Execute an extraction run: parse stored HTML, extract facts and brand, persist. */
export async function runExtraction(db: Database, extractionRunId: string, createFetcher: () => SafeFetcher): Promise<void> {
  const [run] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, extractionRunId));
  if (!run || run.status === 'completed') return;
  await db.update(extractionRuns).set({ status: 'running', startedAt: new Date(), error: null }).where(eq(extractionRuns.id, run.id));

  const rows = await db
    .select({ id: crawlPages.id, url: crawlPages.url, depth: crawlPages.depth, body: crawlPageBodies.body })
    .from(crawlPages)
    .innerJoin(crawlPageBodies, eq(crawlPageBodies.pageId, crawlPages.id))
    .where(and(eq(crawlPages.crawlRunId, run.crawlRunId), eq(crawlPages.state, 'fetched')))
    .orderBy(crawlPages.depth, desc(crawlPages.priority));

  const pages: SourcePage[] = [];
  for (const row of rows) {
    try {
      pages.push({ pageId: row.id, url: row.url, depth: row.depth, doc: parseDocument(gunzipSync(row.body).toString('utf8'), row.url) });
    } catch (error) {
      log.warn('extract.page.unparseable', { pageId: row.id, error });
    }
  }

  const facts = extractFacts(pages);

  const cssSources: CssSource[] = pages.map((page) => ({ css: page.doc.inlineCss, weight: page.depth === 0 ? 3 : 2 }));
  const fetcher = createFetcher();
  let sheets: Array<{ href: string; css: string }> = [];
  try {
    sheets = await fetchStylesheets(fetcher, pages.flatMap((page) => page.doc.stylesheets));
  } finally {
    await fetcher.close();
  }
  const brand = analyzeBrand({
    sources: [...cssSources, ...sheets.map((sheet) => ({ css: sheet.css, weight: 1 }))],
    themeColors: pages.map((page) => page.doc.themeColor).filter((value): value is string => Boolean(value)),
    googleFonts: [...new Set(pages.flatMap((page) => page.doc.googleFonts))],
  });

  const byType: Record<string, number> = {};
  for (const fact of facts) byType[fact.type] = (byType[fact.type] ?? 0) + 1;
  const stats: ExtractionStats = { pages: pages.length, facts: facts.length, byType, stylesheetsFetched: sheets.length };

  await db.transaction(async (tx) => {
    // Idempotent on retry.
    await tx.delete(businessFacts).where(eq(businessFacts.extractionRunId, run.id));
    await tx.delete(pageExtractions).where(eq(pageExtractions.extractionRunId, run.id));

    if (pages.length) {
      await tx.insert(pageExtractions).values(
        pages.map((page) => {
          const { inlineCss: _css, ...document } = page.doc;
          return { extractionRunId: run.id, pageId: page.pageId, workspaceId: run.workspaceId, url: page.url, depth: page.depth, document };
        }),
      );
    }
    if (facts.length) {
      await tx.insert(businessFacts).values(
        facts.map((fact) => ({
          workspaceId: run.workspaceId,
          prospectId: run.prospectId,
          extractionRunId: run.id,
          factType: fact.type,
          factKey: fact.key,
          value: fact.value,
          display: fact.display,
          method: fact.method,
          confidence: fact.confidence,
          occurrences: fact.occurrences,
          pageCount: fact.pageCount,
          onHomepage: fact.onHomepage,
          inHeader: fact.inHeader,
          evidence: fact.evidence,
        })),
      );
    }

    // Carry operator decisions forward from the previous completed run for the same facts.
    const [previous] = await tx
      .select({ id: extractionRuns.id })
      .from(extractionRuns)
      .where(and(eq(extractionRuns.prospectId, run.prospectId), eq(extractionRuns.status, 'completed'), ne(extractionRuns.id, run.id)))
      .orderBy(desc(extractionRuns.createdAt))
      .limit(1);
    if (previous) {
      const reviewed = await tx
        .select()
        .from(businessFacts)
        .where(and(eq(businessFacts.extractionRunId, previous.id), inArray(businessFacts.status, ['verified', 'rejected'])));
      for (const decision of reviewed) {
        await tx
          .update(businessFacts)
          .set({ status: decision.status, reviewedBy: decision.reviewedBy, reviewedAt: decision.reviewedAt, reviewNote: decision.reviewNote })
          .where(and(eq(businessFacts.extractionRunId, run.id), eq(businessFacts.factType, decision.factType), eq(businessFacts.factKey, decision.factKey)));
      }
    }

    await tx
      .update(extractionRuns)
      .set({ status: 'completed', brand, stats, finishedAt: new Date() })
      .where(eq(extractionRuns.id, run.id));
    await tx.update(prospects).set({ status: 'analyzed' }).where(eq(prospects.id, run.prospectId));
  });

  await recordActivity(db, {
    workspaceId: run.workspaceId,
    prospectId: run.prospectId,
    kind: 'facts.extracted',
    detail: { extractionRunId: run.id, crawlRunId: run.crawlRunId, facts: facts.length, pages: pages.length },
  });
  log.info('extract.completed', { extractionRunId: run.id, ...stats });
}

export async function failExtraction(db: Database, extractionRunId: string, message: string): Promise<void> {
  const [run] = await db
    .update(extractionRuns)
    .set({ status: 'failed', error: message, finishedAt: new Date() })
    .where(eq(extractionRuns.id, extractionRunId))
    .returning();
  if (run) await db.update(prospects).set({ status: 'failed' }).where(eq(prospects.id, run.prospectId));
}

/** Latest completed crawl that has fetched pages, for (re-)extraction. */
export async function latestExtractableCrawl(db: Database, prospectId: string) {
  const [crawl] = await db
    .select()
    .from(crawlRuns)
    .where(and(eq(crawlRuns.prospectId, prospectId), eq(crawlRuns.status, 'completed')))
    .orderBy(desc(crawlRuns.createdAt))
    .limit(1);
  return crawl ?? null;
}

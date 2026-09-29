/**
 * Daily SEO health — OBSERVE-ONLY. See src/lib/seo-health/run.ts.
 *
 * Crawls a rotating sample of sitemap URLs plus canaries, inspects a rotating sample
 * with Google URL Inspection, records Search Console stratum trends, stores everything
 * in the seo_health_* tables, and posts a digest to SEO_SLACK_CHANNEL. It never edits
 * the sitemap, noindex, pages or caches, and never calls IndexNow or BigQuery
 * (guard.unit.test.ts enforces this on the import graph and on every outbound request).
 *
 * Scheduling: a `cron_jobs` row (dispatcher), inserted only AFTER this route is deployed
 * and verified returning 200 + real JSON in production. No vercel.json cron.
 * Auth: `Authorization: Bearer CRON_SECRET` only (what the cron_jobs dispatcher sends). Not x-vercel-cron
 * (caller-controlled) and not ?password= (secrets
 * in URLs leak into logs). Completion is monitored by /api/cron/seo-health-watchdog,
 * because this job outlives the dispatcher's 55s await cap.
 *
 * HTTP: 200 for ok/partial (details in the body), 500 for failed, so the dispatcher's
 * last_status reflects a run that could not observe or could not record.
 */
import { NextRequest, NextResponse } from 'next/server';
import { gscInspectUrl, gscQuery } from '@/lib/gsc/client';
import { seoLiveBqEnabled } from '@/lib/seo/live-bq';
import { postSlackMessage } from '@/lib/slack/post-message';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { runSeoHealth } from '@/lib/seo-health/run';
import { cronBearerAuthorized } from '@/lib/seo-health/auth';
import { fetchDatePageRowsPaged } from '@/lib/seo-health/observe';
import { createStore } from '@/lib/seo-health/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronBearerAuthorized(req.headers)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const channel = process.env.SEO_SLACK_CHANNEL || '#seo';
  const result = await runSeoHealth({
    fetch,
    gsc: {
      datePageRows: (startDate, endDate) => fetchDatePageRowsPaged((body) => gscQuery(body), startDate, endDate),
      inspect: gscInspectUrl,
    },
    store: createStore(getWriteClient()),
    postSlack: (text, blocks) => postSlackMessage({ channel, text, blocks }),
    now: Date.now,
    liveBqEnabled: seoLiveBqEnabled,
  });

  return NextResponse.json(result, { status: result.status === 'failed' ? 500 : 200 });
}

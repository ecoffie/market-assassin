/**
 * Daily SEO health — OBSERVE-ONLY. See src/lib/seo-health/run.ts.
 *
 * Crawls a rotating sample of sitemap URLs plus canaries, inspects a rotating sample
 * with Google URL Inspection, records Search Console section trends, stores everything
 * in the seo_health_* tables, and posts a digest to SEO_SLACK_CHANNEL. It never edits
 * the sitemap, noindex, pages or caches, and never calls IndexNow or BigQuery
 * (guard.unit.test.ts enforces this on the import graph and on every outbound request).
 *
 * Scheduling: a `cron_jobs` row (dispatcher), inserted only AFTER this route is deployed
 * and verified returning 200 + real JSON in production. No vercel.json cron.
 * Auth mirrors the dispatcher: x-vercel-cron, Bearer CRON_SECRET, or ?password=ADMIN_PASSWORD.
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
import { createStore } from '@/lib/seo-health/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && auth === process.env.CRON_SECRET) return true;
  const password = new URL(req.url).searchParams.get('password');
  return !!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const channel = process.env.SEO_SLACK_CHANNEL || '#seo';
  const result = await runSeoHealth({
    fetch,
    gsc: {
      datePageRows: async (startDate, endDate) =>
        (await gscQuery<{ rows?: Array<{ keys: string[]; clicks: number; impressions: number }> }>({ startDate, endDate, dimensions: ['date', 'page'], rowLimit: 25000 })).rows ?? [],
      inspect: gscInspectUrl,
    },
    store: createStore(getWriteClient()),
    postSlack: (text, blocks) => postSlackMessage({ channel, text, blocks }),
    now: Date.now,
    liveBqEnabled: seoLiveBqEnabled,
  });

  return NextResponse.json(result, { status: result.status === 'failed' ? 500 : 200 });
}

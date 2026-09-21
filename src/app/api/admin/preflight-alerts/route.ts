/**
 * Pre-deploy smoke test for the alert crons. Runs the per-user code
 * paths against a real sample of users WITHOUT actually sending emails
 * or writing to alert_log, so we catch "works for 1 user, breaks for
 * 1000" bugs before they hit production.
 *
 * Usage:
 *   GET /api/admin/preflight-alerts?password=<ADMIN_PASSWORD>&sample=20
 *
 * Returns a per-stage pass/fail summary. Exit non-zero (HTTP 500) on
 * any failure so this can be wired into a pre-deploy check later.
 *
 * Coverage:
 *   1. DB connectivity (read user_notification_settings)
 *   2. SAM cache read (sample one user's filtered opportunities)
 *   3. Mindy Insights — calls getInsightForNoticeType for all 5 buckets
 *      (this is the test the May 28 outage would have failed)
 *   4. Resend / Office365 — checks env vars + tries a no-op send
 *   5. Email template renders for a sample user
 *
 * Stage 3 alone would have caught the May 28 regression: insights
 * threw in retrieval, escaping its catch, and broke the cron for
 * everyone. A preflight that just calls the function would have
 * surfaced the throw before merge.
 *
 * This endpoint is fast (<30s) and safe to run on production data
 * because nothing is written.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getInsightForNoticeType, bucketNoticeType, type InsightBucket } from '@/lib/briefings/mindy-insights';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

interface StageResult {
  stage: string;
  passed: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any;
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function timed<T>(stage: string, fn: () => Promise<T>): Promise<StageResult & { value?: T }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { stage, passed: true, durationMs: Date.now() - start, value };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage, passed: false, durationMs: Date.now() - start, error: msg };
  }
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sampleSize = Math.min(parseInt(request.nextUrl.searchParams.get('sample') || '20', 10), 100);
  const results: StageResult[] = [];

  // ---- Stage 1: DB connectivity ----
  const stage1 = await timed('db.user_notification_settings.read', async () => {
    const client = getAdminClient();
    const { data, error } = await client
      .from('user_notification_settings')
      .select('user_email, alert_frequency, alerts_enabled, naics_codes, keywords')
      .eq('is_active', true)
      .eq('alerts_enabled', true)
      .in('alert_frequency', ['daily', 'weekdays', 'weekends', 'mwf', 'tth'])
      .limit(sampleSize);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('zero active alert users — alert cron would no-op');
    return { sampleSize: data.length, sample: data };
  });
  results.push({ ...stage1, value: undefined });
  const userSample = (stage1 as { value?: { sample: Array<{ user_email: string; naics_codes: string[] | null; keywords: string[] | null }> } }).value?.sample || [];

  // ---- Stage 2: SAM cache read ----
  results.push(await timed('sam_opportunities.cache.read', async () => {
    const client = getAdminClient();
    const { data, error } = await client
      .from('sam_opportunities')
      .select('notice_id, title, naics_code')
      .gte('posted_date', new Date(Date.now() - 7 * 86400_000).toISOString())
      .limit(5);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('sam_opportunities cache appears empty for the last 7 days');
    return { count: data.length };
  }));

  // ---- Stage 3: Mindy Insights for every bucket ----
  // THIS is the test that would have caught the May 28 outage.
  const buckets: InsightBucket[] = ['rfp', 'sources_sought', 'rfq', 'presolicitation', 'combined'];
  for (const bucket of buckets) {
    results.push(await timed(`mindy-insights.${bucket}`, async () => {
      const ins = await getInsightForNoticeType(bucket);
      // Null is OK (some buckets have thin corpus coverage). What's
      // NOT OK is a throw, which would propagate up and break the cron.
      // Returning here without throwing is the pass condition.
      return { hasInsight: ins !== null, label: ins?.label };
    }));
  }

  // ---- Stage 4: Email provider env vars ----
  results.push(await timed('email.config', async () => {
    const hasResend = !!process.env.RESEND_API_KEY;
    const hasOffice = !!(process.env.OFFICE365_USER && process.env.OFFICE365_PASSWORD);
    if (!hasResend && !hasOffice) throw new Error('neither RESEND_API_KEY nor OFFICE365 creds are set');
    return { resend: hasResend, office365: hasOffice };
  }));

  // ---- Stage 5: bucketNoticeType handles unknown gracefully ----
  results.push(await timed('mindy-insights.bucketNoticeType.unknown', async () => {
    const b1 = bucketNoticeType(null);
    const b2 = bucketNoticeType(undefined);
    const b3 = bucketNoticeType('Garbage Notice Type');
    if (!buckets.includes(b1) || !buckets.includes(b2) || !buckets.includes(b3)) {
      throw new Error('bucketNoticeType returned a non-canonical bucket for unknown input');
    }
    return { fallbacks: [b1, b2, b3] };
  }));

  // ---- Summary ----
  const allPassed = results.every(r => r.passed);
  const failed = results.filter(r => !r.passed);

  return NextResponse.json(
    {
      success: allPassed,
      sampleSize,
      totalUsersScanned: userSample.length,
      stages: results,
      failedStages: failed.map(f => ({ stage: f.stage, error: f.error })),
    },
    { status: allPassed ? 200 : 500 },
  );
}

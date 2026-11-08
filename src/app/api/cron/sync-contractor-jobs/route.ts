/**
 * Cron: daily contractor + federal job postings → contractor_job_postings.
 *   GET /api/cron/sync-contractor-jobs   (auth: ?password=ADMIN_PASSWORD  OR  Bearer CRON_SECRET)
 *
 * Schedule = a cron_jobs row (migration 20261108_contractor_jobs_cron.sql), NOT vercel.json.
 * Deploy this route first, set JSEARCH_API_KEY + USAJOBS_API_KEY in Vercel, curl it 200 with
 * rows, THEN apply the schedule migration.
 *
 * JSearch is paid per request: default 6 queries × 2 pages per day. Tune with JOBS_SYNC_QUERIES /
 * JOBS_SYNC_PAGES (see src/lib/jobs/sync.ts).
 *
 * Outcomes: nothing written → 500 'error' (a key missing, both sources down, or the table write
 * failing must never look like a quiet day). Rows written but a source or query failed → 200
 * 'partial'. Everything worked → 200 'success'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncContractorJobs } from '@/lib/jobs/sync';
import { reportCronOutcome } from '@/lib/cron-self-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const JOB = 'sync-contractor-jobs';

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const isAuthorized =
    (!!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) ||
    (!!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET);
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  try {
    const r = await syncContractorJobs(supabase);
    if (!r.written) {
      const msg = `wrote 0 postings: ${r.errors.join('; ') || 'both sources returned nothing'}`.slice(0, 500);
      await reportCronOutcome(JOB, 'error', msg).catch(() => {});
      return NextResponse.json({ success: false, error: msg, ...r }, { status: 500 });
    }
    if (r.errors.length) {
      await reportCronOutcome(JOB, 'partial', r.errors.join('; ').slice(0, 500)).catch(() => {});
      return NextResponse.json({ success: true, partial: true, ...r });
    }
    await reportCronOutcome(JOB, 'success').catch(() => {});
    return NextResponse.json({ success: true, ...r });
  } catch (e) {
    const msg = (e as Error).message;
    await reportCronOutcome(JOB, 'error', msg).catch(() => {});
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

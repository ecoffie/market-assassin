/**
 * Activate the semantic-corpus dispatcher jobs (idempotent).
 *
 * Registers sow-catalog + embed-sow-corpus as recurring cron_jobs so the embedded-
 * opportunity corpus climbs over time (it had stalled at ~9.5K because the jobs
 * only ran when triggered manually). Mirrors
 * supabase/migrations/20260624_register_sow_semantic_crons.sql, but runnable now
 * without a separate migration apply. (Eric, Jun 24 2026.)
 *
 * GET  /api/admin/register-sow-crons?password=$ADMIN_PASSWORD   → show current rows
 * POST /api/admin/register-sow-crons?password=$ADMIN_PASSWORD   → upsert + enable
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const JOBS = [
  {
    job_name: 'sow-catalog',
    route: '/api/cron/sow-catalog?limit=25',
    cron_expr: '0,15,30,45 * * * *',
    timeout_ms: 120000,
    enabled: true,
    notes: 'Extract SOW/PWS scope text from opps with attachments -> sow_text. Feeds the semantic corpus.',
  },
  {
    job_name: 'embed-sow-corpus',
    route: '/api/cron/embed-sow-corpus?limit=150',
    cron_expr: '5,20,35,50 * * * *',
    timeout_ms: 120000,
    enabled: true,
    notes: 'Embed sow_text (else description) -> sow_embedding for hidden-match. limit=150 to drain the ~90K description backlog. Offset 5 min after sow-catalog.',
  },
];

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
}

function authed(request: NextRequest): boolean {
  return Boolean(ADMIN_PASSWORD) && request.nextUrl.searchParams.get('password') === ADMIN_PASSWORD;
}

export async function GET(request: NextRequest) {
  if (!authed(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('cron_jobs')
    .select('job_name, route, cron_expr, enabled, last_status, last_run_at')
    .in('job_name', JOBS.map((j) => j.job_name));
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, registered: data || [] });
}

export async function POST(request: NextRequest) {
  if (!authed(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('cron_jobs')
    .upsert(JOBS, { onConflict: 'job_name' })
    .select('job_name, route, cron_expr, enabled');
  if (error) {
    return NextResponse.json({ success: false, error: error.message, hint: 'cron_jobs table missing? apply 20260604_cron_dispatcher.sql' }, { status: 500 });
  }
  return NextResponse.json({ success: true, message: 'Semantic-corpus crons registered + enabled.', jobs: data });
}

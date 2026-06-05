/**
 * Admin: manage Cron Dispatcher jobs (docs/PRD-cron-dispatcher.md, Phase 1).
 *
 *   GET  ?password=...                      → list all jobs + their last run
 *   GET  ?password=...&runs=<job_name>      → recent runs for one job
 *   POST ?password=...  body { action, ... }
 *     action 'upsert'  { job_name, route, cron_expr, enabled?, timeout_ms?, payload?, notes? }
 *     action 'enable'  { job_name }
 *     action 'disable' { job_name }
 *     action 'delete'  { job_name }
 *     action 'unlock'  { job_name }   — clear a stuck lock
 *
 * Adding/scheduling a job is an INSERT here — no vercel.json edit, no deploy.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateCron } from '@/lib/cron/cron-expr';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

  const runsFor = searchParams.get('runs');
  if (runsFor) {
    const { data, error } = await supabase
      .from('cron_job_runs')
      .select('*')
      .eq('job_name', runsFor)
      .order('started_at', { ascending: false })
      .limit(50);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, job_name: runsFor, runs: data || [] });
  }

  const { data, error } = await supabase
    .from('cron_jobs')
    .select('*')
    .order('job_name', { ascending: true });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, count: (data || []).length, jobs: data || [] });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '');
  const jobName = String(body.job_name || '').trim();

  if (action === 'upsert') {
    if (!jobName || !body.route || !body.cron_expr) {
      return NextResponse.json({ success: false, error: 'job_name, route, cron_expr required' }, { status: 400 });
    }
    const check = validateCron(String(body.cron_expr));
    if (!check.valid) {
      return NextResponse.json({ success: false, error: `Invalid cron_expr: ${check.error}` }, { status: 400 });
    }
    // update-if-exists / insert-if-not (job_name is UNIQUE in the schema).
    const row = {
      job_name: jobName,
      route: String(body.route),
      cron_expr: String(body.cron_expr),
      enabled: body.enabled !== false,
      timeout_ms: Number.isFinite(body.timeout_ms) ? Number(body.timeout_ms) : 60000,
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
      notes: body.notes ? String(body.notes) : null,
    };
    const { data: existing } = await supabase.from('cron_jobs').select('id').eq('job_name', jobName).maybeSingle();
    const res = existing
      ? await supabase.from('cron_jobs').update(row).eq('job_name', jobName).select().maybeSingle()
      : await supabase.from('cron_jobs').insert(row).select().maybeSingle();
    if (res.error) return NextResponse.json({ success: false, error: res.error.message }, { status: 500 });
    return NextResponse.json({ success: true, action: existing ? 'updated' : 'created', job: res.data });
  }

  if (action === 'enable' || action === 'disable') {
    if (!jobName) return NextResponse.json({ success: false, error: 'job_name required' }, { status: 400 });
    const { data, error } = await supabase
      .from('cron_jobs')
      .update({ enabled: action === 'enable' })
      .eq('job_name', jobName)
      .select('job_name, enabled')
      .maybeSingle();
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, job: data });
  }

  if (action === 'unlock') {
    if (!jobName) return NextResponse.json({ success: false, error: 'job_name required' }, { status: 400 });
    const { error } = await supabase.from('cron_jobs').update({ locked_at: null }).eq('job_name', jobName);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, message: `Unlocked ${jobName}` });
  }

  if (action === 'delete') {
    if (!jobName) return NextResponse.json({ success: false, error: 'job_name required' }, { status: 400 });
    const { error } = await supabase.from('cron_jobs').delete().eq('job_name', jobName);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, message: `Deleted ${jobName}` });
  }

  return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
}

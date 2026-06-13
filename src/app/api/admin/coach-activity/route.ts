/**
 * Coach activity CRUD — Coach Signal Loop queue for Ryan, Zach, Randie, Tavin.
 *
 * GET    ?password=... [&coach=Ryan] [&status=queued] [&type=partner_bd]
 * POST   { coach, activity_type, target_org?, ... }
 * PATCH  ?password=...&id=<uuid>  { status?, notes?, next_action?, ... }
 * DELETE ?password=...&id=<uuid>
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  COACH_ACTIVITY_TYPES,
  COACH_OWNERS,
} from '@/lib/mindy/coach-operating-model';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD || password === 'galata-assassin-2026';
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const coach = params.get('coach');
  const status = params.get('status');
  const activityType = params.get('type');
  const limit = Math.min(parseInt(params.get('limit') || '200', 10) || 200, 500);

  const supabase = getSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from('internal_coach_activity')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (coach) q = q.eq('coach', coach);
  if (status) q = q.eq('status', status);
  if (activityType) q = q.eq('activity_type', activityType);

  const { data, error } = await q;
  if (error) {
    const missing = error.message?.includes('internal_coach_activity') || error.code === '42P01';
    return NextResponse.json({
      success: false,
      error: error.message,
      migrationNeeded: missing,
      hint: missing ? 'Run supabase/migrations/20260611_internal_coach_activity.sql in Supabase' : undefined,
    }, { status: missing ? 503 : 500 });
  }

  const rows = data || [];
  const byCoach: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const row of rows) {
    byCoach[row.coach] = (byCoach[row.coach] || 0) + 1;
    byType[row.activity_type] = (byType[row.activity_type] || 0) + 1;
  }

  return NextResponse.json({
    success: true,
    count: rows.length,
    activities: rows,
    summary: { byCoach, byType, open: rows.filter((r: { status: string }) => !['won', 'lost'].includes(r.status)).length },
    owners: COACH_OWNERS,
    activityTypes: COACH_ACTIVITY_TYPES,
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const coach = String(body.coach || '').trim();
  const activityType = String(body.activity_type || '').trim();
  if (!coach || !COACH_OWNERS.includes(coach as typeof COACH_OWNERS[number])) {
    return NextResponse.json({ error: `coach must be one of: ${COACH_OWNERS.join(', ')}` }, { status: 400 });
  }
  if (!activityType || !COACH_ACTIVITY_TYPES.includes(activityType as typeof COACH_ACTIVITY_TYPES[number])) {
    return NextResponse.json({ error: `activity_type must be one of: ${COACH_ACTIVITY_TYPES.join(', ')}` }, { status: 400 });
  }

  const payload: Record<string, unknown> = {
    coach,
    activity_type: activityType,
    status: body.status || 'queued',
  };
  for (const key of [
    'target_name', 'target_org', 'target_email', 'channel', 'segment',
    'objective', 'customer_signal', 'notes', 'next_action', 'escalation_needed',
  ]) {
    if (body[key] !== undefined) payload[key] = body[key];
  }

  const { data, error } = await getSupabase()
    .from('internal_coach_activity')
    .insert(payload)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, activity: data });
}

export async function PATCH(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const key of [
    'coach', 'activity_type', 'target_name', 'target_org', 'target_email',
    'channel', 'segment', 'objective', 'status', 'customer_signal',
    'notes', 'next_action', 'escalation_needed',
  ]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await getSupabase()
    .from('internal_coach_activity')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, activity: data });
}

export async function DELETE(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await getSupabase().from('internal_coach_activity').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

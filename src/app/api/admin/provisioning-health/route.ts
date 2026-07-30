import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Provisioning health — answers "are new buyers actually getting access?"
 *
 * WHY: on 2026-07-30 staff reported having to grant access by hand for "many new people".
 * That could not be verified: grant endpoints wrote KV and recorded nothing, so a manual
 * rescue and a working webhook left identical state. This route reads the access_grants
 * audit trail and reports the ONE number that matters — how many grants were manual.
 *
 * GET /api/admin/provisioning-health?password=...&days=30
 */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await sb
    .from('access_grants')
    .select('email, capability, action, source, actor, reason, created_at, stripe_session_id')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data || [];
  const bySource: Record<string, number> = {};
  for (const r of rows) bySource[r.source] = (bySource[r.source] || 0) + 1;

  const manual = rows.filter((r) => r.source === 'admin_manual');
  const auto = rows.filter((r) => r.source === 'stripe_webhook');

  // The headline signal: a manual grant for an email that ALSO has an automatic grant means
  // provisioning ran but didn't stick. A manual grant with NO automatic grant means the
  // webhook never got there at all — a different failure, worth separating.
  const autoEmails = new Set(auto.map((r) => r.email));
  const rescuedAfterAuto = manual.filter((r) => autoEmails.has(r.email));
  const manualWithNoAuto = manual.filter((r) => !autoEmails.has(r.email));

  return NextResponse.json({
    window_days: days,
    since,
    total_grants: rows.length,
    by_source: bySource,
    // Automatic provisioning failure rate. Only meaningful once both paths are audited —
    // rows written before this feature shipped (2026-07-30) do not exist, so a small
    // sample here means "not enough data yet", NOT "no problem".
    automatic_grants: auto.length,
    manual_grants: manual.length,
    manual_rate: auto.length + manual.length > 0
      ? `${((manual.length / (auto.length + manual.length)) * 100).toFixed(1)}%`
      : 'n/a',
    breakdown: {
      rescued_after_automatic: rescuedAfterAuto.length,
      manual_with_no_automatic: manualWithNoAuto.length,
    },
    recent_manual_grants: manual.slice(0, 50).map((r) => ({
      email: r.email,
      capability: r.capability,
      actor: r.actor,
      reason: r.reason,
      at: r.created_at,
      had_automatic_grant: autoEmails.has(r.email),
    })),
    note: rows.length === 0
      ? 'No audit rows yet. The audit trail starts at deploy time (2026-07-30) — it cannot see historical grants.'
      : undefined,
  });
}

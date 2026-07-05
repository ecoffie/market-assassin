/**
 * /api/app/pursuit-changes
 *
 * In-app feed of detected changes/amendments on the user's tracked pursuits
 * (written by the pursuit-changes cron). Drives the "⚠️ Amendment" badge on
 * pursuit cards + a "what changed" list.
 *
 * GET ?email=          → unacknowledged changes grouped by pursuit_id.
 * POST { email, pursuit_id? }  → acknowledge (clear badge) for a pursuit, or all.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { saveSnapshot, readSnapshot, freshMeta, degradedMeta, isUpstreamOutage } from '@/lib/resilience/last-good';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sb(): any {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Graceful-degradation snapshot key: this feed is per-user, so key by email
// (see src/lib/resilience/last-good.ts). Only the GET (read) path is snapshotted.
function pursuitChangesSnapshotKey(email: string): string {
  return `pursuit-changes:email=${email.toLowerCase()}`;
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await sb()
      .from('pursuit_change_log')
      .select('id, pursuit_id, notice_id, change_type, summary, old_value, new_value, detected_at')
      .eq('user_email', email)
      .eq('acknowledged', false)
      .order('detected_at', { ascending: false });

    if (error) {
      // A real infra outage (DB unreachable/timeout) → serve last-good with an
      // "as of {time}" banner instead of hiding the badge behind an empty feed.
      if (isUpstreamOutage(error)) {
        const snap = await readSnapshot<Record<string, unknown>>(pursuitChangesSnapshotKey(email!));
        if (snap) return NextResponse.json({ ...snap.data, ...degradedMeta(snap.savedAt) });
      }
      // Otherwise (e.g. table may not exist pre-migration) → degrade to empty
      // (no badge), no crash — preserved existing behavior.
      return NextResponse.json({ success: true, byPursuit: {}, total: 0 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byPursuit: Record<string, any[]> = {};
    for (const row of (data || [])) {
      (byPursuit[row.pursuit_id] ||= []).push(row);
    }
    const response = { success: true, byPursuit, total: (data || []).length };
    saveSnapshot(pursuitChangesSnapshotKey(email!), response as Record<string, unknown>).catch(() => {});
    return NextResponse.json({ ...response, ...freshMeta() });
  } catch (err) {
    // Thrown connection error (DB unreachable) → serve last-good if we have it.
    if (isUpstreamOutage(err)) {
      const snap = await readSnapshot<Record<string, unknown>>(pursuitChangesSnapshotKey(email!));
      if (snap) return NextResponse.json({ ...snap.data, ...degradedMeta(snap.savedAt) });
    }
    // No snapshot / non-outage → preserve the original degrade-to-empty behavior.
    return NextResponse.json({ success: true, byPursuit: {}, total: 0 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  let q = sb().from('pursuit_change_log').update({ acknowledged: true }).eq('user_email', email).eq('acknowledged', false);
  if (body.pursuit_id) q = q.eq('pursuit_id', body.pursuit_id);
  const { error } = await q;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

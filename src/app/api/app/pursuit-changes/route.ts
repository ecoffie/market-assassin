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
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';

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

  // Coach Mode: the change log is owner-attributed for tracked CLIENT pursuits, so
  // read the client's feed (synthetic email) when acting as a client — else the
  // coach sees their own changes and the client's badge never clears.
  const { workspaceId, asClient } = await resolveActiveWorkspace(email || '', request);
  const scopedEmail = asClient ? clientNotificationEmail(workspaceId) : email!;

  try {
    const { data, error } = await sb()
      .from('pursuit_change_log')
      .select('id, pursuit_id, notice_id, change_type, summary, old_value, new_value, detected_at')
      .eq('user_email', scopedEmail)
      .eq('acknowledged', false)
      .order('detected_at', { ascending: false });

    if (error) {
      // A real infra outage (DB unreachable/timeout) → serve last-good with an
      // "as of {time}" banner instead of hiding the badge behind an empty feed.
      if (isUpstreamOutage(error)) {
        const snap = await readSnapshot<Record<string, unknown>>(pursuitChangesSnapshotKey(scopedEmail));
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
    saveSnapshot(pursuitChangesSnapshotKey(scopedEmail), response as Record<string, unknown>).catch(() => {});
    return NextResponse.json({ ...response, ...freshMeta() });
  } catch (err) {
    // Thrown connection error (DB unreachable) → serve last-good if we have it.
    if (isUpstreamOutage(err)) {
      const snap = await readSnapshot<Record<string, unknown>>(pursuitChangesSnapshotKey(scopedEmail));
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

  // Ack the CLIENT's changes when in Coach Mode (mirrors GET scoping).
  const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
  const scopedEmail = asClient ? clientNotificationEmail(workspaceId) : email;

  let q = sb().from('pursuit_change_log').update({ acknowledged: true }).eq('user_email', scopedEmail).eq('acknowledged', false);
  if (body.pursuit_id) q = q.eq('pursuit_id', body.pursuit_id);
  const { error } = await q;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

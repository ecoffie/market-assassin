/**
 * /api/cron/pursuit-changes
 *
 * Monitors every tracked pursuit (user_pipeline, non-archived, with a SAM
 * notice_id) for changes/amendments and alerts the owner (Eric: "notify me of
 * any changes/amendments to pursuits I'm tracking, pursuing, or bidding").
 *
 * Detects, by diffing the live SAM state (sam_opportunities cache) against the
 * last snapshot in pursuit_monitor_state:
 *   - deadline      response_deadline moved
 *   - amendment     SAM last_modified bumped (a new amendment posted)
 *   - notice_type   e.g. Sources Sought → Solicitation (went live)
 *   - documents     docs_count increased (new attachments / Q&A / revised SOW)
 *   - cancelled / awarded  notice_type indicates the pursuit is over
 *
 * Each change → a pursuit_change_log row (drives the in-app badge) + a per-user
 * email digest via the shared sendEmail() (Resend primary). Registerable on the
 * cron dispatcher; also fireable manually (?test=1&email=).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sb(): any {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

interface Change { change_type: string; summary: string; old_value: string | null; new_value: string | null }

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

// Diff a pursuit's live SAM state against its last snapshot.
function detectChanges(
  prev: { last_deadline?: string | null; last_notice_type?: string | null; last_modified?: string | null; last_docs_count?: number | null } | null,
  live: { response_deadline?: string | null; notice_type?: string | null; last_modified?: string | null; docs_count?: number | null },
): Change[] {
  const out: Change[] = [];
  if (!prev) return out; // first sight — just snapshot, don't alert.

  if (live.response_deadline && prev.last_deadline && live.response_deadline !== prev.last_deadline) {
    out.push({ change_type: 'deadline', summary: `Deadline moved ${fmtDate(prev.last_deadline)} → ${fmtDate(live.response_deadline)}`, old_value: prev.last_deadline, new_value: live.response_deadline });
  }
  const nt = (live.notice_type || '').toLowerCase();
  if (live.notice_type && prev.last_notice_type && live.notice_type !== prev.last_notice_type) {
    if (nt.includes('cancel')) out.push({ change_type: 'cancelled', summary: 'Opportunity CANCELLED', old_value: prev.last_notice_type, new_value: live.notice_type });
    else if (nt.includes('award')) out.push({ change_type: 'awarded', summary: 'Award posted — this pursuit is decided', old_value: prev.last_notice_type, new_value: live.notice_type });
    else out.push({ change_type: 'notice_type', summary: `Notice type changed: ${prev.last_notice_type} → ${live.notice_type}`, old_value: prev.last_notice_type, new_value: live.notice_type });
  }
  if (live.last_modified && prev.last_modified && live.last_modified !== prev.last_modified) {
    // last_modified bump that isn't already captured as a deadline/type change.
    if (!out.length) out.push({ change_type: 'amendment', summary: `Amendment posted (updated ${fmtDate(live.last_modified)})`, old_value: prev.last_modified, new_value: live.last_modified });
  }
  if (typeof live.docs_count === 'number' && typeof prev.last_docs_count === 'number' && live.docs_count > prev.last_docs_count) {
    out.push({ change_type: 'documents', summary: `${live.docs_count - prev.last_docs_count} new document(s) added`, old_value: String(prev.last_docs_count), new_value: String(live.docs_count) });
  }
  return out;
}

// BATCH + RESUMABLE (Eric: this can hit the 1000s fast — must scale like
// daily-alerts). Each invocation processes up to BATCH_SIZE pursuits, picking
// the LEAST-recently-checked first (via pursuit_monitor_state.last_checked_at),
// and returns `remaining` so the dispatcher fires it across a window until the
// whole pipeline is swept. A soft time budget guarantees we never get killed
// mid-run. Tunable via env without a deploy.
const BATCH_SIZE = parseInt(process.env.PURSUIT_CHANGES_BATCH_SIZE || '100', 10);
const TIME_BUDGET_MS = 45_000; // stay well under the 60s function cap

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const supabase = sb();
  const testEmail = request.nextUrl.searchParams.get('email');

  // ?stats=1&password=<ADMIN_PASSWORD> — read-only health view of pursuit_change_log
  // (total changes ever logged, how many were emailed/acknowledged, and the
  // 10 most-recent emailed rows). Proves real alerts have actually fired.
  if (request.nextUrl.searchParams.get('stats') === '1') {
    if (request.nextUrl.searchParams.get('password') !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const totalRes = await supabase.from('pursuit_change_log').select('id', { count: 'exact', head: true });
    const emailedRes = await supabase.from('pursuit_change_log').select('id', { count: 'exact', head: true }).eq('emailed', true);
    const ackedRes = await supabase.from('pursuit_change_log').select('id', { count: 'exact', head: true }).eq('acknowledged', true);
    const total = totalRes.count ?? 0;
    const emailed = emailedRes.count ?? 0;
    const acked = ackedRes.count ?? 0;
    const { data: recent } = await supabase
      .from('pursuit_change_log')
      .select('user_email, change_type, summary, detected_at, emailed')
      .eq('emailed', true)
      .order('detected_at', { ascending: false })
      .limit(10);

    // ROOT-CAUSE DIAGNOSTICS: is detection silent because nothing changed, or
    // because the inputs are missing? Check (1) how many snapshots exist, and
    // (2) whether the SAM cache has the compare fields (last_modified /
    // response_deadline) populated for the actually-tracked notice_ids.
    const snapCountRes = await supabase.from('pursuit_monitor_state').select('pursuit_id', { count: 'exact', head: true });
    const { data: trackedRows } = await supabase
      .from('user_pipeline')
      .select('notice_id')
      .not('notice_id', 'is', null)
      .limit(500);
    const trackedNotices = Array.from(new Set((trackedRows || []).map((r: { notice_id: string }) => r.notice_id)));
    const { data: samRows } = await supabase
      .from('sam_opportunities')
      .select('notice_id, last_modified, response_deadline, notice_type')
      .in('notice_id', trackedNotices.slice(0, 300));
    const inCache = (samRows || []).length;
    const withLastMod = (samRows || []).filter((r: { last_modified: string | null }) => r.last_modified).length;
    const withDeadline = (samRows || []).filter((r: { response_deadline: string | null }) => r.response_deadline).length;

    return NextResponse.json(
      {
        stats: { total, emailed, acknowledged: acked },
        recentEmailed: recent || [],
        diagnostics: {
          snapshotsStored: snapCountRes.count ?? 0,
          trackedNoticeIds: trackedNotices.length,
          ofThoseInSamCache: inCache,
          cacheHasLastModified: withLastMod,   // ← if low/0, detection can't see amendments
          cacheHasResponseDeadline: withDeadline,
          note: 'If ofThoseInSamCache is low → tracked notices not in cache. If cacheHasLastModified is low → amendment detection is blind.',
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // All monitorable pursuits (has SAM notice_id, not archived).
  let pq = supabase
    .from('user_pipeline')
    .select('id, user_email, owner_email, notice_id, title, stage, response_deadline, docs_count')
    .not('notice_id', 'is', null)
    .neq('is_archived', true);
  if (testEmail) pq = pq.eq('user_email', testEmail);
  const { data: allPursuits } = await pq;
  const totalMonitorable = allPursuits?.length || 0;

  if (!totalMonitorable) {
    return NextResponse.json({ success: true, monitored: 0, changes: 0, remaining: 0 });
  }

  // Order by least-recently-checked: pursuits with no snapshot first, then
  // oldest last_checked_at. One cheap read of the cursor table.
  const { data: stateRows } = await supabase
    .from('pursuit_monitor_state')
    .select('pursuit_id, last_checked_at');
  const checkedAt = new Map<string, string>();
  for (const s of (stateRows || [])) checkedAt.set(s.pursuit_id, s.last_checked_at);
  const ordered = [...allPursuits].sort((a: { id: string }, b: { id: string }) => {
    const ta = checkedAt.get(a.id) || ''; // '' (never checked) sorts first
    const tb = checkedAt.get(b.id) || '';
    return ta.localeCompare(tb);
  });
  const pursuits = ordered.slice(0, BATCH_SIZE);
  const remaining = Math.max(0, totalMonitorable - pursuits.length);

  // Batch-load live SAM state for all notice_ids in one query.
  const noticeIds = Array.from(new Set(pursuits.map((p: { notice_id: string }) => p.notice_id)));
  const { data: samRows } = await supabase
    .from('sam_opportunities')
    .select('notice_id, response_deadline, notice_type, last_modified')
    .in('notice_id', noticeIds);
  const samByNotice = new Map<string, { response_deadline: string; notice_type: string; last_modified: string }>();
  for (const r of (samRows || [])) samByNotice.set(r.notice_id, r);

  // Existing snapshots.
  const pursuitIds = pursuits.map((p: { id: string }) => p.id);
  const { data: snaps } = await supabase.from('pursuit_monitor_state').select('*').in('pursuit_id', pursuitIds);
  const snapById = new Map<string, { last_deadline: string; last_notice_type: string; last_modified: string; last_docs_count: number }>();
  for (const s of (snaps || [])) snapById.set(s.pursuit_id, s);

  const changesByUser = new Map<string, Array<{ title: string; changes: Change[] }>>();
  let totalChanges = 0;
  let processed = 0;

  for (const p of pursuits) {
    // Soft time budget: stop cleanly before the function cap; the remaining
    // pursuits get swept on the next dispatcher fire (they're least-recently-
    // checked, so they bubble to the front).
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    processed++;
    const sam = samByNotice.get(p.notice_id);
    // Live state — prefer SAM cache; fall back to the pursuit's own fields.
    const live = {
      response_deadline: sam?.response_deadline || p.response_deadline,
      notice_type: sam?.notice_type || null,
      last_modified: sam?.last_modified || null,
      docs_count: p.docs_count ?? null,
    };
    const prev = snapById.get(p.id) || null;
    const changes = detectChanges(prev, live);

    if (changes.length) {
      totalChanges += changes.length;
      // Attribute to the OWNER (workspace pursuits may have owner_email ≠
      // user_email) so both the email AND the in-app badge go to the same
      // person — the one actually working the pursuit.
      const owner = p.owner_email || p.user_email;
      await supabase.from('pursuit_change_log').insert(
        changes.map(c => ({
          pursuit_id: p.id, user_email: owner, notice_id: p.notice_id,
          change_type: c.change_type, summary: c.summary, old_value: c.old_value, new_value: c.new_value,
        }))
      );
      if (!changesByUser.has(owner)) changesByUser.set(owner, []);
      changesByUser.get(owner)!.push({ title: p.title || 'Untitled pursuit', changes });
    }

    // Upsert the snapshot to the current live state.
    await supabase.from('pursuit_monitor_state').upsert({
      pursuit_id: p.id,
      notice_id: p.notice_id,
      last_deadline: live.response_deadline,
      last_notice_type: live.notice_type,
      last_modified: live.last_modified,
      last_docs_count: live.docs_count,
      last_checked_at: new Date().toISOString(),
    });
  }

  // Email each affected user a digest.
  let emailsSent = 0;
  for (const [email, items] of changesByUser) {
    const rows = items.map(it => `
      <div style="margin:0 0 14px;padding:12px;border:1px solid #e2e8f0;border-radius:8px">
        <div style="font-weight:600;color:#1e293b;margin-bottom:6px">${it.title}</div>
        ${it.changes.map(c => `<div style="font-size:14px;color:#475569">• ${c.summary}</div>`).join('')}
      </div>`).join('');
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1e293b">⚠️ Changes to your tracked pursuits</h2>
        <p style="color:#64748b;font-size:14px">Mindy detected updates on ${items.length} pursuit${items.length === 1 ? '' : 's'} you're tracking. Review before your bid.</p>
        ${rows}
        <p style="margin-top:18px"><a href="https://getmindy.ai/app" style="background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open My Pursuits →</a></p>
      </div>`;
    const ok = await sendEmail({
      to: email,
      subject: `⚠️ ${items.reduce((n, it) => n + it.changes.length, 0)} update(s) on your tracked pursuits`,
      html,
      emailType: 'pursuit_change_alert',
      eventSource: 'pursuit-changes-cron',
    });
    if (ok) {
      emailsSent++;
      // Mark those rows emailed.
      await supabase.from('pursuit_change_log').update({ emailed: true }).eq('user_email', email).eq('emailed', false);
    }
  }

  // `remaining` = pursuits not yet touched this run (batch cap) PLUS any
  // skipped by the time budget. The dispatcher re-fires until remaining hits 0.
  const remainingThisRun = remaining + (pursuits.length - processed);
  return NextResponse.json({
    success: true,
    totalMonitorable,
    processed,
    changes: totalChanges,
    emailsSent,
    remaining: remainingThisRun,
    batchSize: BATCH_SIZE,
  });
}

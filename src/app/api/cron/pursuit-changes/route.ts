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
 *   - notice_type   e.g. Sources Sought → Solicitation (went live)
 *   - cancelled / awarded  notice_type indicates the pursuit is over
 *   - closed        active went true → false (archived/closed)
 *   - amendment     posted_date changed (SAM re-posts a notice when amended —
 *                   this is the PROXY: SAM's API has NO real last-modified field,
 *                   verified, so we use postedDate. Catches re-posts, may miss a
 *                   quiet text-only amendment.)
 *   - documents     docs_count increased (new attachments / Q&A / revised SOW)
 *
 * Each change → a pursuit_change_log row (drives the in-app badge) + a per-user
 * email digest via the shared sendEmail() (Resend primary). Registerable on the
 * cron dispatcher; also fireable manually (?test=1&email=).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';
import { sendRawSMS } from '@/lib/briefings/delivery/sender';

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
//
// IMPORTANT: SAM's opportunities API does NOT publish a per-notice last-modified
// timestamp (verified — the v2 /search response has only postedDate, archiveDate,
// responseDeadLine, active; no modified/amendment/version field anywhere). So we
// CANNOT diff on last_modified — it's null cache-wide. Instead we detect on the
// real fields SAM does return, and use a re-posted `postedDate` as the amendment
// proxy (SAM signals an amendment by re-posting the notice).
function detectChanges(
  prev: { last_deadline?: string | null; last_notice_type?: string | null; last_posted?: string | null; last_active?: boolean | null; last_docs_count?: number | null } | null,
  live: { response_deadline?: string | null; notice_type?: string | null; posted_date?: string | null; active?: boolean | null; docs_count?: number | null },
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
  // Became inactive/archived = the pursuit closed.
  if (typeof prev.last_active === 'boolean' && live.active === false && prev.last_active === true) {
    out.push({ change_type: 'closed', summary: 'Opportunity is no longer active (archived/closed)', old_value: 'active', new_value: 'inactive' });
  }
  // AMENDMENT PROXY: SAM re-posts a notice when it amends it → postedDate changes.
  // Only flag if not already captured as a deadline/type/close change above.
  if (!out.length && live.posted_date && prev.last_posted && live.posted_date !== prev.last_posted) {
    out.push({ change_type: 'amendment', summary: `Notice updated/re-posted (${fmtDate(live.posted_date)})`, old_value: prev.last_posted, new_value: live.posted_date });
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

  // Batch-load live SAM state for all notice_ids in one query. We diff on the
  // fields SAM actually publishes (deadline, notice_type, posted_date, active) —
  // NOT last_modified, which SAM never returns (always null cache-wide).
  const noticeIds = Array.from(new Set(pursuits.map((p: { notice_id: string }) => p.notice_id)));
  const { data: samRows } = await supabase
    .from('sam_opportunities')
    .select('notice_id, response_deadline, notice_type, posted_date, active')
    .in('notice_id', noticeIds);
  const samByNotice = new Map<string, { response_deadline: string; notice_type: string; posted_date: string; active: boolean }>();
  for (const r of (samRows || [])) samByNotice.set(r.notice_id, r);

  // Existing snapshots.
  const pursuitIds = pursuits.map((p: { id: string }) => p.id);
  const { data: snaps } = await supabase.from('pursuit_monitor_state').select('*').in('pursuit_id', pursuitIds);
  // The `last_modified` column now stores posted_date (see upsert note). Map it
  // to last_posted for detectChanges; last_active is the new migration column.
  const snapById = new Map<string, { last_deadline: string; last_notice_type: string; last_posted: string; last_active: boolean | null; last_docs_count: number }>();
  for (const s of (snaps || [])) snapById.set(s.pursuit_id, {
    last_deadline: s.last_deadline,
    last_notice_type: s.last_notice_type,
    last_posted: s.last_modified, // reused column
    last_active: typeof s.last_active === 'boolean' ? s.last_active : null,
    last_docs_count: s.last_docs_count,
  });

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
      posted_date: sam?.posted_date || null,
      active: typeof sam?.active === 'boolean' ? sam.active : null,
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

    // Upsert the snapshot to the current live state. NOTE: we reuse the existing
    // `last_modified` TEXT column to store SAM's posted_date (SAM has no real
    // last-modified; postedDate is the amendment proxy) — avoids a migration for
    // that field. `last_active` is a new column (migration 20260629).
    await supabase.from('pursuit_monitor_state').upsert({
      pursuit_id: p.id,
      notice_id: p.notice_id,
      last_deadline: live.response_deadline,
      last_notice_type: live.notice_type,
      last_modified: live.posted_date,   // reused column = posted_date snapshot
      last_active: live.active,
      last_docs_count: live.docs_count,
      last_checked_at: new Date().toISOString(),
    });
  }

  // SMS opt-in: amendment/deadline changes are time-sensitive, so users who
  // turned on SMS get the same digest as a text. Batch-fetch prefs for just the
  // affected owners (sms_enabled + phone_number live in the canonical
  // user_notification_settings table). Owner-attributed like the email/badge.
  const affectedOwners = Array.from(changesByUser.keys());
  const smsPrefs = new Map<string, string>(); // email → E.164-ish phone
  if (affectedOwners.length) {
    const { data: prefRows } = await supabase
      .from('user_notification_settings')
      .select('user_email, sms_enabled, phone_number')
      .in('user_email', affectedOwners)
      .eq('sms_enabled', true);
    for (const r of (prefRows || []) as Array<{ user_email: string; phone_number: string | null }>) {
      if (r.phone_number) smsPrefs.set(r.user_email, r.phone_number);
    }
  }

  // Email each affected user a digest.
  let emailsSent = 0;
  let smsSent = 0;
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

    // SMS (opt-in): a short text with the most urgent change(s). The email is the
    // full digest; the SMS is the nudge. 160-char-friendly — list up to 2 changes,
    // then a count + deep link.
    const phone = smsPrefs.get(email);
    if (phone) {
      const flat = items.flatMap(it => it.changes.map(c => `${it.title.slice(0, 40)}: ${c.summary}`));
      const total = flat.length;
      const head = flat.slice(0, 2).join(' | ');
      const more = total > 2 ? ` (+${total - 2} more)` : '';
      const smsBody = `Mindy: ${total} update${total === 1 ? '' : 's'} on your tracked pursuit${total === 1 ? '' : 's'}. ${head}${more}. getmindy.ai/app`;
      const res = await sendRawSMS(phone, smsBody);
      if (res.success) smsSent++;
      else console.warn(`[pursuit-changes] SMS failed for ${email}: ${res.error}`);
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
    smsSent,
    remaining: remainingThisRun,
    batchSize: BATCH_SIZE,
  });
}

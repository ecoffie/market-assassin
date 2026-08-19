/**
 * Throughput Digest — "did the pipelines produce NORMAL VOLUME?"
 *
 * GET /api/cron/throughput-digest[?password=...][&force=1]
 *
 * WHY THIS EXISTS. There were already SEVEN health crons (sam-sync-watchdog,
 * briefing-watchdog, check-briefing-health, check-fms-health, check-provider-health,
 * db-health-watch, health-check-email) and every one of them reported GREEN through a
 * six-day outage in which the nightly SAM sync ingested 1,000 of ~23,000 opportunities.
 *
 * They all measure LIVENESS — did the job run, is the cache fresh, is the provider up.
 * None measured THROUGHPUT — of the work that should have been produced, how much
 * actually was. Every bug in the 2026-08-03 customer escalation hid in that gap:
 *
 *   SAM sync        watchdog said healthy      1,000 of 23,000 fetched   (4%)
 *   Daily alerts    cron said success            880 of 1,594 users      (55%)
 *   Send guard      alert_log said 'skipped'      48 alerts never sent
 *   Briefings       112 sent, no error           594 entitled users invisible
 *
 * Not one reported an error. A customer found them instead, and asked whether the app
 * was ready for production. This is the check that should have found them first.
 *
 * POSTS DAILY REGARDLESS OF STATE, deliberately. A monitor that only speaks up when
 * something breaks is indistinguishable from a monitor that has itself broken — which
 * is precisely how the seven above failed. A green number every morning is what makes
 * a red one legible.
 *
 * THRESHOLDS ARE STARTING GUESSES, not derived values. Tune them once there is a week
 * of real readings; the constants are named and grouped so that is a one-line edit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOpsAlert } from '@/lib/ops-alert';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * PostgREST caps an un-ranged select at 1,000 rows and reports no error.
 *
 * This monitor was written to catch pipelines that "succeed" while delivering a
 * fraction of their output — and then did exactly that itself. On 2026-08-04 it
 * reported "Alert coverage 63% — 1,000 of 1,596". The 1,000 was the cap; the real
 * figure was 1,433 users, and true coverage was 100%. It cried wolf on a healthy
 * pipeline for a day, which is the fastest way to teach people to ignore a monitor.
 *
 * Every list-shaped read in this file goes through here. A count is fine un-paged
 * (head:true returns a number, not rows) — it is the row fetches that truncate.
 */
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  cap = 200_000
): Promise<{ rows: T[]; error: { message: string } | null }> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { rows, error };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return { rows, error: null };
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Alert when a pipeline delivers less than this share of what it should have. */
const MIN_COMPLETENESS = 0.9;
/** Alert when more than this many alerts are blocked by the send guard in 24h. */
const MAX_GUARD_BLOCKS = 5;
/** Alert when more than this many users are entitled but unreachable by the job. */
const MAX_ORPHANED_ENTITLEMENTS = 20;
// MCP activation: of the users who AUTHENTICATED to an MCP surface, what share hold a
// credit row? Below this, the activation wall is back. Starting guess like the others —
// it should sit at ~100% once the first-touch grant is live, so anything under 95% means
// a grant path stopped firing.
const MIN_MCP_CREDITED = 0.95;

interface Check {
  name: string;
  detail: string;
  value: string;
  ok: boolean;
}

/** SAM ingest: did the last full sync fetch what SAM said was available? */
async function checkSamIngest(sb: ReturnType<typeof getSupabase>): Promise<Check> {
  const { data, error } = await sb
    .from('sam_sync_runs')
    .select('total_fetched, total_available, status, started_at')
    .eq('sync_type', 'full')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { name: 'SAM ingest', detail: `query failed: ${error.message}`, value: 'unknown', ok: false };
  }
  if (!data || !data.total_available) {
    return { name: 'SAM ingest', detail: 'no full sync on record', value: 'unknown', ok: false };
  }
  const ratio = (data.total_fetched || 0) / data.total_available;
  return {
    name: 'SAM ingest',
    detail: `${(data.total_fetched || 0).toLocaleString()} of ${data.total_available.toLocaleString()} available (status ${data.status})`,
    value: `${Math.round(ratio * 100)}%`,
    ok: ratio >= MIN_COMPLETENESS,
  };
}

/** Daily alerts: did every eligible user get processed today? */
async function checkAlertCoverage(sb: ReturnType<typeof getSupabase>): Promise<Check> {
  const today = new Date().toISOString().slice(0, 10);

  // DENOMINATOR = users the job will actually TRY to send to.
  //
  // Counting every alerts_enabled+daily profile manufactured a false alarm: 277 of
  // them have no NAICS, no keywords and no agencies, so daily-alerts deliberately
  // skips them (they are unmatchable — see the 2026-07-27 fix that stopped mailing
  // them a generic default profile). Holding the pipeline responsible for users it
  // is correctly declining to mail reported 63% coverage on a day the real figure
  // was 100%. A denominator that includes work nobody intends to do is not a
  // completeness measure.
  const { rows: eligibleRows, error: eErr } = await fetchAllRows<{
    user_email: string; naics_codes: string[] | null; keywords: string[] | null; agencies: string[] | null;
  }>((from, to) => sb
    .from('user_notification_settings')
    .select('user_email, naics_codes, keywords, agencies')
    .eq('is_active', true)
    .eq('alerts_enabled', true)
    .eq('alert_frequency', 'daily')
    .range(from, to));

  const { rows, error: rErr } = await fetchAllRows<{ user_email: string }>((from, to) => sb
    .from('alert_log')
    .select('user_email')
    .eq('alert_date', today)
    .eq('alert_type', 'daily')
    .range(from, to));

  if (eErr || rErr) {
    return { name: 'Alert coverage', detail: `query failed: ${(eErr || rErr)?.message}`, value: 'unknown', ok: false };
  }
  // A zero-length eligible list is a HARD failure, not 0/0 = 100%. The original
  // guarded the same trap on a null count; the paged read has to guard the empty
  // case for the same reason — an unreadable table must never look like a green light.
  if (eligibleRows.length === 0) {
    return { name: 'Alert coverage', detail: 'no eligible users found — table missing, unreadable, or every profile disabled', value: 'unknown', ok: false };
  }
  const targetable = eligibleRows.filter(u =>
    (u.naics_codes?.length || 0) > 0 || (u.keywords?.length || 0) > 0 || (u.agencies?.length || 0) > 0);
  const unmatchable = eligibleRows.length - targetable.length;
  const targetableEmails = new Set(targetable.map(u => u.user_email));

  // Numerator counts only users who are in the denominator, so a stray alert to
  // someone outside the daily cohort can never push this above 100%.
  const processed = new Set(rows.map(r => r.user_email).filter(e => targetableEmails.has(e))).size;
  const total = targetable.length;
  const ratio = total > 0 ? processed / total : 1;
  return {
    name: 'Alert coverage',
    // Name the exclusion in the message. A denominator that silently shrinks is how
    // the opposite bug hides — if `unmatchable` ever jumps, that is its own signal.
    detail: `${processed.toLocaleString()} of ${total.toLocaleString()} targetable daily-alert users processed today`
      + (unmatchable > 0 ? ` (${unmatchable.toLocaleString()} excluded: no NAICS, keywords or agencies — unmatchable by design)` : ''),
    value: `${Math.round(ratio * 100)}%`,
    // Runs through the morning, so a partial figure early in the day is normal —
    // this is a digest, not a real-time gauge. Read it against the posting hour.
    ok: ratio >= MIN_COMPLETENESS,
  };
}

/** Send guard: how many real alerts were suppressed by the per-recipient daily cap? */
async function checkSendGuard(sb: ReturnType<typeof getSupabase>): Promise<Check> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { count, error } = await sb
    .from('alert_log')
    .select('id', { count: 'exact', head: true })
    .eq('error_message', 'send_guard_blocked')
    .gte('alert_date', since);

  if (error) {
    return { name: 'Send guard', detail: `query failed: ${error.message}`, value: 'unknown', ok: false };
  }
  // A missing table returns count=null with error=null and HTTP 204 — no error at all.
  // `count ?? 0` would turn "I don't know" into "zero blocked", i.e. this monitor
  // fabricating the exact healthy-looking number it exists to catch. UNKNOWN is a
  // failure, not a pass.
  if (count === null || count === undefined) {
    return { name: 'Send guard', detail: 'count came back NULL — table missing or unreadable', value: 'unknown', ok: false };
  }
  const n = count;
  return {
    name: 'Send guard',
    detail: n === 0 ? 'no alerts suppressed' : `${n} alert(s) generated but never sent (suppression or daily cap)`,
    value: String(n),
    ok: n <= MAX_GUARD_BLOCKS,
  };
}

/** Briefings: users entitled in one table but invisible to the job's audience query. */
async function checkBriefingEntitlements(sb: ReturnType<typeof getSupabase>): Promise<Check> {
  // Both reads are paged: 779 briefings_enabled profiles and 1,732 classification
  // rows both exceed the 1,000 cap as they grow, and a truncated `entitled` set
  // would invent orphans that do not exist.
  const { rows: enabled, error: eErr } = await fetchAllRows<{ user_email: string }>((from, to) => sb
    .from('user_notification_settings')
    .select('user_email')
    .eq('briefings_enabled', true)
    .eq('is_active', true)
    .range(from, to));
  const { rows: classified, error: cErr } = await fetchAllRows<{ email: string; briefings_access: string }>((from, to) => sb
    .from('customer_classifications')
    .select('email, briefings_access')
    .in('briefings_access', ['lifetime', '1_year', '6_month', 'subscription', 'beta_preview'])
    .range(from, to));

  if (eErr || cErr) {
    return { name: 'Briefing entitlement', detail: `query failed: ${(eErr || cErr)?.message}`, value: 'unknown', ok: false };
  }
  const entitled = new Set(classified.map(r => String(r.email).toLowerCase()));
  const allOrphans = enabled.filter(r => !entitled.has(String(r.user_email).toLowerCase()));

  // Synthetic accounts are not a customer-facing problem. 171 of the 586 orphans on
  // 2026-08-04 were healthcheck-*/@test.* rows this repo creates itself; counting
  // them inflates the number a human is asked to act on by ~40%.
  const isSynthetic = (e: string) => /@test\.|^healthcheck-|@example\./i.test(e);
  const realOrphans = allOrphans.filter(r => !isSynthetic(String(r.user_email)));
  const synthetic = allOrphans.length - realOrphans.length;
  const orphaned = realOrphans.length;

  return {
    name: 'Briefing entitlement',
    detail: orphaned === 0
      ? 'every briefings-enabled user is reachable by the cron'
      : `${orphaned} real user(s) have briefings_enabled but NO customer_classifications row — the cron cannot see them`
        + (synthetic > 0 ? ` (+${synthetic} test/healthcheck accounts ignored)` : ''),
    value: String(orphaned),
    ok: orphaned <= MAX_ORPHANED_ENTITLEMENTS,
  };
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const isCron = Boolean(request.headers.get('x-vercel-cron'))
    || request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron && password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

/**
 * MCP activation funnel: authenticated → credited → actually called a tool.
 *
 * THE BUG THIS EXISTS TO CATCH (2026-08-19). A user reported that two signups "didn't
 * work". He had added the Claude connector FIRST and signed up SECOND — the natural
 * order for a Claude user — and credits were only granted at OAuth token exchange and
 * API-key mint, both of which assume the account already exists. He ended with an
 * account, a zero balance, and insufficient_credits on every call.
 *
 * 116 of 133 signups in 14 days (87%) had no credit row. Nothing was erroring. Every
 * existing check was green, because this is the same LIVENESS-vs-THROUGHPUT gap the rest
 * of this digest was built for: the grant path RAN fine, it just never ran for these
 * users.
 *
 * Measured off AUTHENTICATED users, not signups, deliberately. Signups include imported
 * and dormant accounts that may never connect; counting them would report a permanent
 * false failure. The question that matters is: of the people who actually reached MCP,
 * how many can spend?
 */
async function checkMcpActivation(sb: ReturnType<typeof getSupabase>): Promise<Check> {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();

  // Authenticated = left a real MCP artifact. A key, a token, or a logged call each
  // prove the user reached an authenticated surface.
  // PAGED, not a bare select. PostgREST silently caps an unranged list read at
  // 1,000 rows — so a bare select would quietly undercount BOTH sides of this
  // ratio as the tables grow, and a monitor that under-reports its own inputs is
  // worse than no monitor. (The repo's accuracy test caught exactly this.)
  type Row = { user_email: string };
  const [keys, tokens, calls, credited] = await Promise.all([
    fetchAllRows<Row>((from, to) => sb.from('mcp_api_keys').select('user_email').gte('created_at', since).range(from, to)),
    fetchAllRows<Row>((from, to) => sb.from('mcp_oauth_tokens').select('user_email').gte('created_at', since).range(from, to)),
    fetchAllRows<Row>((from, to) => sb.from('mcp_call_log').select('user_email').gte('created_at', since).range(from, to)),
    fetchAllRows<Row>((from, to) => sb.from('mcp_credit_balance').select('user_email').range(from, to)),
  ]);

  const err = keys.error || tokens.error || calls.error || credited.error;
  if (err) {
    return { name: 'MCP activation', detail: `query failed: ${err.message}`, value: 'unknown', ok: false };
  }

  const norm = (r: { user_email?: string | null }) => (r.user_email || '').toLowerCase().trim();
  const authed = new Set<string>();
  for (const r of [...keys.rows, ...tokens.rows]) { const e = norm(r); if (e) authed.add(e); }
  const callers = new Set<string>();
  for (const r of calls.rows) { const e = norm(r); if (e) { authed.add(e); callers.add(e); } }
  const hasCredits = new Set(credited.rows.map(norm).filter(Boolean));

  if (authed.size === 0) {
    // Nobody authenticated in the window. Not a failure — say so rather than divide by zero.
    return { name: 'MCP activation', detail: 'no MCP authentications in the last 14 days', value: 'n/a', ok: true };
  }

  const uncredited = [...authed].filter((e) => !hasCredits.has(e));
  const ratio = (authed.size - uncredited.length) / authed.size;

  return {
    name: 'MCP activation',
    detail:
      `${authed.size} authenticated → ${authed.size - uncredited.length} credited → ${callers.size} made a tool call` +
      (uncredited.length ? ` · ${uncredited.length} authenticated with NO credit row` : ''),
    value: `${Math.round(ratio * 100)}% credited`,
    ok: ratio >= MIN_MCP_CREDITED,
  };
}

  const sb = getSupabase();
  const checks = await Promise.all([
    checkSamIngest(sb),
    checkAlertCoverage(sb),
    checkSendGuard(sb),
    checkBriefingEntitlements(sb),
    checkMcpActivation(sb),
  ]);

  const failing = checks.filter(c => !c.ok);
  const subject = failing.length === 0
    ? 'Throughput OK — all pipelines at expected volume'
    : `Throughput: ${failing.length} pipeline(s) below expected volume`;

  const rows = checks.map(c => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;">${c.ok ? '✅' : '⚠️'} <strong>${c.name}</strong></td>
      <td style="padding:8px;border:1px solid #ddd;"><strong>${c.value}</strong></td>
      <td style="padding:8px;border:1px solid #ddd;">${c.detail}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;">
      <p>Volume produced vs volume expected. A pipeline can run "successfully" and still
      deliver a fraction of its output — that is what this catches.</p>
      <table style="border-collapse:collapse;width:100%;max-width:640px;">${rows}</table>
      <p style="color:#666;font-size:12px;margin-top:12px;">
        Thresholds: completeness ≥ ${Math.round(MIN_COMPLETENESS * 100)}%,
        send-guard blocks ≤ ${MAX_GUARD_BLOCKS}, orphaned entitlements ≤ ${MAX_ORPHANED_ENTITLEMENTS}.
      </p>
    </div>`;

  // Posted every day, healthy or not — see the header for why silence is not a signal.
  await sendOpsAlert({ subject, html }).catch(err =>
    console.error('[throughput-digest] slack post failed:', err));

  return NextResponse.json({ success: true, failing: failing.length, checks });
}

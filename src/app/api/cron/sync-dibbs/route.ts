/**
 * Cron: sync DLA DIBBS RFQs via the Apify actor. Steady-state refresh of recent
 * small-buy solicitations into dibbs_rfqs. Schedule via cron_jobs row (rule #5).
 * Needs a VALID paid-tier APIFY_TOKEN — note a dead token still reads as
 * `present:true` to Vercel's env check, so verify with
 * `GET https://api.apify.com/v2/users/me` (that 401 was the whole Jul-2026 outage).
 *   GET /api/cron/sync-dibbs?maxItems=2500&daysBack=2
 *
 * Tuning (2026-07-28): maxItems 1000 → 2500 and the cron row moved daysBack 7 → 2.
 * DLA posts ~400–800 new RFQs/weekday, so 1000 truncated on busy days; and daysBack=7
 * spent most of each run re-walking a week of index files it already had. The response
 * now reports `truncated` and `starved` so neither failure hides behind success:true.
 *
 * Escalation (2026-07-30): reporting `starved` in a 200 body was not enough — nothing
 * READ it. A starved run now returns HTTP 500 (so the dispatcher records last_status
 * 'error' and the watchdog pages) and fires a Slack ops alert. `truncated` stays a 200:
 * it is a partial success the next daily run finishes via dedupe, not a failure.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ingestDibbs } from '@/lib/dibbs/ingest';
import { sendOpsAlert } from '@/lib/ops-alert';
import { reportCronOutcome } from '@/lib/cron-self-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  // AUTH FIRST — this route SPENDS REAL MONEY on every call (~$36 per 2500-item
  // Apify run). It shipped with no auth check at all while sibling cron routes
  // gated on CRON_SECRET, so anyone with the URL could bill the Apify account
  // repeatedly and pin it at its cap — which starves DIBBS ingest for days
  // (see the Jul 29-30 2026 outage). Found 2026-07-30 when an unauthenticated
  // curl meant as a deploy check executed a full $35.85 run.
  // Same pattern as sync-sam-opportunities: admin password OR cron secret.
  const password = request.nextUrl.searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const isAuthorized =
    (!!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) ||
    (!!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET);
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.APIFY_TOKEN) {
    return NextResponse.json({ success: false, error: 'APIFY_TOKEN not set — DIBBS pilot disabled' }, { status: 503 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Accumulate pattern (like the SAM cache): pull wide, upsert into the durable
  // table, dedupe by solicitation_number. Default to a big maxItems + ALL available
  // files (daysBack omitted) so the table grows instead of tracking a rolling window.
  // Pass ?daysBack=N to narrow; ?maxItems=N to cap.
  // Cap raised 1000 → 2500 (2026-07-28). MEASURED: DLA posts ~400–800 new RFQs on a normal
  // weekday (from raw.indexFileDate: Jul 22 = 433, Jul 24 = 260, Jul 26 = 664/520-unique),
  // and the actor returns ~22% duplicates across index files. At the old 1000 cap a busy day
  // TRUNCATED — silently, since a capped run looks like a successful one. 2500 clears the
  // observed ceiling with headroom. Bounded by maxDuration=120s above, not by this number:
  // a 5000-item pull measured ~40s locally, so 2500 has ample budget.
  const maxItems = Math.min(parseInt(request.nextUrl.searchParams.get('maxItems') || '2500', 10), 2500);
  const daysBackParam = request.nextUrl.searchParams.get('daysBack');
  const daysBack = daysBackParam == null ? null : Math.min(parseInt(daysBackParam, 10), 30);
  try {
    // ?forceApify=1 bypasses the cost guard for a large pull (see APIFY_USD_PER_ITEM
    // in lib/dibbs/ingest.ts — the actor bills per result-item, so 2,500 items is
    // ~$35.85). Only reach for this when the direct path is genuinely blocked; the
    // guard exists because a handful of wide pulls ate a $300 monthly cap.
    const forceApify = request.nextUrl.searchParams.get('forceApify') === '1';
    const result = await ingestDibbs(supabase, { maxItems, daysBack, forceApify });
    // Two silent-failure modes this surfaces, because BOTH previously returned success:true
    // and looked identical to a healthy run in the cron_jobs row:
    //  • truncated — hit maxItems exactly, so current RFQs were left unfetched.
    //  • starved   — the actor committed ~1 item. This is what made Jul 9–15 look like 7
    //    successful runs while the table gained 1–2 rows/day.
    //
    // ⚠️ A STARVED RESULT HAS TWO INDISTINGUISHABLE CAUSES. CHECK BILLING FIRST.
    //    1. APIFY SPEND CAP — the account hit its usage limit, so Apify refuses real work.
    //       Waiting does NOT fix this; it clears only on the billing-period reset or a limit
    //       raise. Check https://console.apify.com/billing/current-period — if "Usage" shows
    //       $N/$N in red, this is the cause. `Proxy: $0.00` there also proves the proxy was
    //       never involved.
    //    2. DIBBS WAF throttling the residential proxy mid-scrape — a timed block that does
    //       clear on its own.
    //    2026-07-28: an earlier version of this comment asserted (2) as THE cause. It was
    //    actually (1) — the account was pinned at $200/$200 — and the wrong explanation got
    //    reported hourly for 37 hours while the console showed the answer the whole time.
    //    Never diagnose starved from this route alone; the account is the authoritative source.
    //
    // Either way: do NOT retry or burst. Retrying deepens a WAF block AND burns more budget.
    const truncated = result.fetched >= maxItems;

    // NO-DATA WINDOW ≠ STARVED. DLA publishes ONE index file per BUSINESS day, so a
    // window covering only weekend/holiday dates legitimately has nothing to fetch:
    // the actor logs "Filtering to last N day(s): 0 files" and returns 0 records.
    //
    // Verified 2026-08-02 (a Sunday): daysBack=2 spanned Sat+Sun -> 0 files -> 0 records,
    // which the old `fetched <= 1` rule reported as STARVED, returned HTTP 500, flipped
    // the cron row to 'error' and told the operator to go check Apify billing. Nothing
    // was wrong. Widening to daysBack=3 on the same deploy pulled 228 records fine.
    //
    // With the cron's daysBack=2 that false alarm fires EVERY Sunday and Monday — the
    // fastest way to teach everyone to ignore the watchdog. So: when the whole lookback
    // window contains no business days, a zero result is EXPECTED, not a failure.
    //
    // Deliberately conservative — this only suppresses the alarm when the window is
    // ENTIRELY non-business days. A weekday returning 0 is still STARVED and still
    // pages, because on a weekday that genuinely means the spend cap or the WAF.
    // Federal holidays are NOT modeled: a holiday-only window still alarms. That is
    // the safe direction to be wrong in (a rare false page beats a silent outage), and
    // it avoids dragging a holiday calendar into this route.
    const noBusinessDayInWindow = (() => {
      if (daysBack == null || daysBack <= 0) return false; // null = all files; never expected empty
      for (let i = 0; i < daysBack; i++) {
        const d = new Date(Date.now() - i * 86_400_000);
        const dow = d.getUTCDay(); // 0 Sun, 6 Sat
        if (dow !== 0 && dow !== 6) return false; // found a business day -> a real fetch was expected
      }
      return true;
    })();

    // Threshold MUST match `starved` below (<= 1, not === 0). The actor occasionally
    // commits a single stray record on a no-business-day window, and a `=== 0` test
    // let that lone item fall through to the starved branch — a Sunday false alarm
    // with an ops email telling the operator to go check Apify billing while nothing
    // was wrong. Seen 2026-08-09 and 2026-08-16 (both Sundays, daysBack=2 = Sat+Sun,
    // "STARVED: fetched 1"). Any lower threshold reopens the same gap.
    //
    // Still conservative — `noBusinessDayInWindow` is unchanged, so this only ever
    // applies when EVERY day in the lookback is Sat/Sun. Verified against the real
    // Aug 6-9 spend-cap outage: Aug 8 (Sat) had Friday in its window and Aug 6-7 were
    // weekdays, so all three still alarm. Only the two Sundays go quiet.
    const noDataWindow = result.fetched <= 1 && noBusinessDayInWindow;
    const starved = result.fetched <= 1 && !noDataWindow;
    if (truncated) console.warn(`[sync-dibbs] TRUNCATED at maxItems=${maxItems} — more current RFQs exist; the daily run will accumulate the rest via dedupe.`);

    // A STARVED RUN MUST FAIL LOUDLY. It used to return HTTP 200 + success:true,
    // so the dispatcher recorded last_status='dispatched' and the watchdog never
    // paged — Jul 29–30 2026 ran two full days at 1 row/day looking perfectly
    // healthy, and the cause (Apify pinned at $199.99/$200) sat visible in the
    // console the whole time. The dispatcher flips a job to 'error' on a non-OK
    // status (see dispatch/route.ts), so a starved run returns 500 to become
    // visible, plus a Slack ops alert naming the FIRST thing to check.
    if (starved) {
      // SR-002 — LOST EXECUTION PROVENANCE.
      //
      // ingestDibbs already computes `attempts[]` (every path entered, its outcome, its
      // error) plus the cost-guard decision, the vendor build and the Apify quota. All of it
      // was discarded here: the run recorded `STARVED: fetched 1` and nothing else, so four
      // days of business-day failures could not be attributed to direct, to Apify, or to
      // both. The postmortem field existed and never reached the postmortem.
      //
      // Persisted verbatim below. Behaviour is unchanged — this commit only stops throwing
      // the evidence away.
      const provenance = (result.attempts ?? [])
        .map((a) => `${a.path}:${a.outcome}(${a.records} in ${a.ms}ms${a.error ? ` — ${a.error}` : ''})`)
        .join(' → ') || 'NO PATH ENTERED';

      // PATH-AWARE MESSAGE. "CHECK APIFY BILLING FIRST" is contextually WRONG at
      // maxItems=2500: the cost guard routes to the FREE direct fetcher first, so Apify may
      // never have been called and billing cannot be the cause. Telling an operator to check
      // a bill that was never charged sends them to the wrong system — the same misdirection
      // SR-001 caused by defaulting `source` to 'apify'.
      const apifyWasReached = (result.attempts ?? []).some((a) => a.path === 'apify');
      const firstCheck = apifyWasReached
        ? `<b>CHECK BILLING:</b> console.apify.com/billing/current-period<br>` +
          `A spend cap is indistinguishable from WAF throttling from here, and it does NOT clear ` +
          `by waiting (only on the billing-cycle reset or a limit raise).`
        : `<b>APIFY WAS NOT REACHED.</b> The cost guard routed to the free direct fetcher ` +
          `(requested ${maxItems} > threshold), so billing is not the cause. ` +
          `Inspect the direct attempt outcome below before checking Apify.`;

      const detail =
        `Fetched only <b>${result.fetched}</b> item(s) — nothing was committed.<br><br>` +
        `<b>Execution path:</b> ${provenance}<br>` +
        (result.costGuard ? `<b>Cost guard:</b> ${result.costGuard}<br>` : '') +
        (result.vendorBuild ? `<b>Vendor build:</b> ${result.vendorBuild}<br>` : '') +
        `<br>${firstCheck}<br><br>` +
        `<b>Do NOT retry or burst</b> — retrying deepens a WAF block and burns budget.`;
      console.error(`[sync-dibbs] STARVED: fetched only ${result.fetched}. CHECK APIFY BILLING FIRST (console.apify.com/billing/current-period) — a spend cap looks identical to WAF throttling. Do NOT retry/burst either way.`);
      // Never let a failed alert mask the failed sync.
      await sendOpsAlert({ subject: 'DIBBS sync STARVED — check Apify billing', html: detail })
        .catch((e) => console.error('[sync-dibbs] ops alert failed:', (e as Error).message));
      // The 500 below is NOT enough on its own: this job's timeout_ms (120s)
      // exceeds the dispatcher's 55s await cap, so it is fire-and-forget and the
      // dispatcher has already closed the connection and written 'dispatched'
      // (a status the watchdog ignores). Report the failure directly or the
      // watchdog stays blind — which is exactly how Jul 29-30 went unnoticed.
      // The provenance goes in the STORED error, not just the Slack alert — an alert is read
      // once, cron_job_runs is what a postmortem four days later actually queries.
      await reportCronOutcome(
        'sync-dibbs',
        'error',
        `STARVED: fetched ${result.fetched} | path: ${provenance}${result.costGuard ? ` | guard: ${result.costGuard}` : ''}`,
      );
      return NextResponse.json({
        success: false, ...result, truncated, starved,
        error: `STARVED: fetched ${result.fetched} via ${provenance}. `
          + (apifyWasReached
            ? 'Check Apify billing (spend cap) before assuming WAF. Do not retry.'
            : 'Apify was NOT reached — the cost guard used the direct fetcher. Billing is not the cause.'),
      }, { status: 500 });
    }

    // Weekend/holiday no-op. Reported as a SUCCESS (nothing is wrong) but flagged
    // explicitly, so "0-1 rows because DLA published nothing" never reads as either a
    // failure OR a silently-healthy run that quietly fetched nothing.
    //
    // ⚠️ A WEEKEND PASS IS "NOT EXPECTED", NOT "HEALTHY". Measured 2026-08-24: the last real
    // ingest was Thu 08-20; Fri 08-21 and Mon 08-24 both STARVED; Sat/Sun passed under this
    // rule. Read as a run sequence that is success-error-success-success-error, which looks
    // intermittent. Read against BUSINESS DAYS it is 2 of 2 failed — continuous. Freshness
    // must therefore be measured from the last expected-business-day success, never from the
    // last calendar run. `lastSyncAgeHours` below carries that so the caller cannot mistake a
    // weekend for health.
    if (noDataWindow) {
      console.log(`[sync-dibbs] NO-DATA WINDOW: last ${daysBack} day(s) are all weekend — DLA publishes one index file per business day, so ${result.fetched} record(s) is expected.`);
      await reportCronOutcome('sync-dibbs', 'success');
      // How stale is the CORPUS, independent of whether today's run was expected to find
      // anything. A weekend pass with a 4-day-old corpus is not health.
      let lastSyncAgeHours: number | null = null;
      try {
        const { data: fresh } = await supabase
          .from('dibbs_rfqs').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle();
        if (fresh?.synced_at) {
          lastSyncAgeHours = Math.round((Date.now() - new Date(fresh.synced_at).getTime()) / 3_600_000);
        }
      } catch { /* best-effort — never fail a healthy run on a freshness read */ }
      if (lastSyncAgeHours != null && lastSyncAgeHours > 72) {
        console.warn(`[sync-dibbs] NO-DATA WINDOW but corpus is ${lastSyncAgeHours}h stale — weekend pass is NOT health`);
      }

      return NextResponse.json({
        success: true, ...result, truncated, starved: false, noDataWindow: true, lastSyncAgeHours,
        message: `DIBBS: no business days in the last ${daysBack} day(s) — DLA publishes per business day, so ${result.fetched} record(s) is expected (not starved).`,
      });
    }

    // Healthy run — overwrite the dispatcher's 'dispatched' with the real
    // outcome so a genuine success is distinguishable from "we never found out".
    await reportCronOutcome('sync-dibbs', 'success');
    return NextResponse.json({
      success: true, ...result, truncated, starved,
      message: `DIBBS: fetched ${result.fetched}, upserted ${result.upserted}${truncated ? ' (TRUNCATED)' : ''}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DIBBS sync failed';
    console.error('[sync-dibbs]', message);
    // Same reasoning as the starved path: past the 12s ack window the HTTP 500
    // reaches nobody, so record the failure where the watchdog will see it.
    await reportCronOutcome('sync-dibbs', 'error', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

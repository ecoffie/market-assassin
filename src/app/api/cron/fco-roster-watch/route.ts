/**
 * Weekly GSA Acquisition Gateway (FCO) roster + currentness watch.
 *
 * Automates the NOTICING while the INGEST stays manual (supported CSV export). Writes only the
 * machine fields of `forecast_gsa_gateway` in `data_source_instances`, then routes alerts through
 * the SHARED ops-alert stack — no FCO-specific Slack logic.
 *
 * ⚠️ IT MUST NEVER WRITE `agency_forecasts`. Enforced by test.
 *
 * WHY WEEKLY: Department of State joined FCO on 2026-08-19/20 and went unnoticed for ~3.5 weeks.
 * Weekly bounds that at 7 days. `?dry=1` plans without persisting anything.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runFcoWatch } from '@/lib/forecasts/fco-watch-run';
import { sendOpsAlert } from '@/lib/ops-alert';
import { shouldSendAlert, fingerprint } from '@/lib/ops-alert-dedup';
import { reportCronOutcome } from '@/lib/cron-self-report';

// Fired by exactly ONE cron_jobs row.
const CRON_JOB_NAME = 'fco-roster-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const pw = request.nextUrl.searchParams.get('password');
  const authorized =
    auth === `Bearer ${process.env.CRON_SECRET}` || pw === process.env.ADMIN_PASSWORD;
  if (!authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // DRY = ZERO persistent writes: no clocks, no alert state, no alert send.
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  try {
    // Tunable without a redeploy — the source throttles datacenter egress harder than a laptop.
    const conc = Number(request.nextUrl.searchParams.get('concurrency'));
    const budget = Number(request.nextUrl.searchParams.get('budgetMs'));
    const run = await runFcoWatch(sb, {
      dry,
      concurrency: Number.isFinite(conc) && conc > 0 ? conc : undefined,
      budgetMs: Number.isFinite(budget) && budget > 0 ? budget : undefined,
    });

    // Alert only on conditions worth a human's attention, deduped on WHICH things are affected.
    const worth = run.events.filter((e) => e.severity !== 'info');
    let alerted = false;
    let reason = worth.length ? 'none' : 'no_actionable_events';

    if (worth.length && !dry) {
      const gate = await shouldSendAlert(sb, 'fco-roster-watch', fingerprint(worth.map((e) => e.dedupeKey)));
      reason = gate.reason;
      if (gate.send) {
        const critical = worth.filter((e) => e.severity === 'critical');
        await sendOpsAlert({
          subject: critical.length
            ? `FCO roster: ${critical.length} CRITICAL change(s)`
            : `FCO watch: ${worth.length} condition(s)`,
          html: [
            `upstream ${run.census.uniqueListingIds} ids across ${run.census.departments} departments · held canonical ${run.heldCanonical}`,
            `MAX(changed) ${run.census.maxChanged ?? 'unknown'}`,
            ...worth.map((e) => `${e.severity.toUpperCase()} · ${e.message}`),
          ].join('<br>'),
        });
        alerted = true;
      }
    }

    // TERMINAL SELF-REPORT. Its one run in the preceding 30 days (weekly schedule) was
    // recorded `dispatched` with http_status NULL — the roster crawl runs to a 240s budget,
    // 20× the dispatcher's 12s ack. The catch below says "a watch that dies silently is
    // exactly what this replaces", but its 500 was landing on a closed connection, so the
    // watch could in fact die silently. It can't now.
    //
    // EXECUTION vs ADVANCEMENT: a census that saw NO upstream listings completed while
    // establishing nothing about the roster — partial, never success. Finding zero
    // actionable EVENTS is the healthy case and stays a success.
    if (!dry) {
      const sawNothing = !run.census.uniqueListingIds;
      await reportCronOutcome(
        CRON_JOB_NAME,
        sawNothing ? 'partial' : 'success',
        sawNothing ? 'upstream census returned 0 listing ids — roster not established' : undefined,
      );
    }

    return NextResponse.json({ success: true, alerted, reason, ...run });
  } catch (e) {
    // Surface it — a watch that dies silently is exactly what this replaces.
    if (!dry) await reportCronOutcome(CRON_JOB_NAME, 'error', (e as Error).message);
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}

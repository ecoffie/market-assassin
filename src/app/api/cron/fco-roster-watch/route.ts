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
 *
 * RUN TRUTH: a run is `success` ONLY when the census completed. A partial census (time budget or a
 * 503 mid-walk) is `partial` (HTTP 503) and a census that read nothing is `error` (HTTP 500) —
 * reported through the shared self-report (`reportCronOutcome`) because the dispatcher
 * fire-and-forgets this long job, and mirrored in the HTTP status (`cronOutcomeHttpStatus`) so a
 * lost self-report still records not-success. Same convention as saved-search-alerts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runFcoWatch } from '@/lib/forecasts/fco-watch-run';
import { sendOpsAlert } from '@/lib/ops-alert';
import { shouldSendAlert, fingerprint } from '@/lib/ops-alert-dedup';
import { hasValidCronSecret } from '@/lib/cron/cron-request-auth';
import { cronOutcomeHttpStatus, reportCronOutcome, type CronOutcome } from '@/lib/cron-self-report';

const JOB_NAME = 'fco-roster-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const pw = request.nextUrl.searchParams.get('password');
  const cronAuthed = hasValidCronSecret(request);
  const authorized = cronAuthed || pw === process.env.ADMIN_PASSWORD;
  if (!authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // DRY = ZERO persistent writes: no clocks, no alert state, no alert send.
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // Only a cron-secret (dispatcher) run that persists may write cron status — never a dry run or a manual
  // admin-password curl. Decided from the verified auth, never from a caller-set header
  // (header-grant-guard.unit.test.ts: nothing but the saved-search-alerts post-auth hint reads x-cron-dispatch).
  const selfReport = cronAuthed && !dry;

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

    // A completed census is the only success. A partial read is degraded, not dead (error is
    // reserved for a source we could not read at all).
    const outcome: CronOutcome = run.census.complete ? 'success'
      : run.census.pagesFetched > 0 ? 'partial' : 'error';
    const outcomeNote = outcome === 'success' ? undefined
      : `census incomplete: ${run.census.uniqueRows} of ${run.census.reportedTotal} rows, ${run.census.pagesFetched} pages read, ${run.census.pagesFailed} failed`;
    if (selfReport) await reportCronOutcome(JOB_NAME, outcome, outcomeNote);

    return NextResponse.json(
      { success: outcome === 'success', outcome, ...(outcomeNote ? { note: outcomeNote } : {}), alerted, reason, ...run },
      { status: cronOutcomeHttpStatus(outcome) },
    );
  } catch (e) {
    // Surface it — a watch that dies silently is exactly what this replaces.
    const message = (e as Error).message;
    if (selfReport) await reportCronOutcome(JOB_NAME, 'error', message);
    return NextResponse.json({ success: false, outcome: 'error', error: message }, { status: 500 });
  }
}

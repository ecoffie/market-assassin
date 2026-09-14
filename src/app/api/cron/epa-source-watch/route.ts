/**
 * EPA reachability watch — automates the NOTICING while ingest stays controlled.
 *
 * ⚠️ NEVER MUTATES agency_forecasts. The 50 held EPA rows (27 of them carrying Mindy
 * geocoding) are not touched by this job under any outcome.
 *
 * ⚠️ A BLOCKED RESULT IS A SUCCESSFUL WATCH. The job's purpose is to measure a known
 * unavailable source, so it returns 200 with `sourceReachability: '<failure class>'`
 * rather than failing the cron daily. Job success != source health.
 *
 * ⚠️ RECOVERY IS NOT PERMISSION TO INGEST. Even when the APEX app comes back, the live
 * schema, population, identity stability across releases and lifecycle vocabulary are
 * all unverified — so a reachable probe sets `unmeasured` + `required`, never `current`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { probeEpaReachability, EPA_SOURCE_KEY, EPA_DISCOVERY_URL } from '@/lib/forecasts/epa-reachability';
import { sendOpsAlert } from '@/lib/ops-alert';
import { shouldSendAlert, fingerprint } from '@/lib/ops-alert-dedup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const pw = request.nextUrl.searchParams.get('password');
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const apply = request.nextUrl.searchParams.get('dry') !== '1';
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const nowIso = new Date().toISOString();

  try {
    const probe = await probeEpaReachability();

    const { data: rows, error: readErr } = await sb.from('data_source_instances')
      .select('*').eq('source_key', EPA_SOURCE_KEY).limit(1);
    if (readErr) return NextResponse.json({ success: false, failure: `instance_read: ${readErr.message}` }, { status: 500 });
    const inst = rows?.[0];
    if (!inst) return NextResponse.json({ success: false, failure: 'instance_missing' }, { status: 500 });

    // Blocked -> unreachable. Reachable -> `unmeasured`, NEVER `current`: nothing about
    // the live source has been verified yet. intervention stays `required` either way.
    const sourceState = probe.blocked ? 'unreachable' : 'unmeasured';
    const interventionState = 'required';

    // §8 — ONLY last_poll moves. Every other clock and both measurements are preserved.
    const patch: Record<string, unknown> = {
      last_poll: nowIso, source_state: sourceState,
      intervention_state: interventionState, updated_at: nowIso,
    };
    if (apply) {
      const { error } = await sb.from('data_source_instances').update(patch).eq('source_key', EPA_SOURCE_KEY);
      if (error) return NextResponse.json({ success: false, failure: `instance_update: ${error.message}` }, { status: 500 });
    }

    let alerted = false, alertReason = 'not_attempted';
    const alertKey = probe.blocked ? 'epa_source_blocked' : 'epa_source_recovered';
    const fp = fingerprint([EPA_SOURCE_KEY, probe.reachability, String(probe.finalStatus ?? probe.discoveryStatus ?? 'none')]);
    if (apply) {
      const gate = await shouldSendAlert(sb, alertKey, fp);
      alertReason = gate.reason;
      if (gate.send) {
        const body = probe.blocked
          ? [
              'EPA’s canonical Acquisition Forecast APEX application is currently unreachable/intermittent.',
              `Probe: ${probe.reachability} after ${probe.attempts} attempt(s). ${probe.detail}`,
              'Mindy holds:',
              `• ${inst.held_population} EPA forecast records`,
              '• source-native EPA Record Number identity (50/50 reproducible)',
              '• intact source raw_data (50/50 valid objects)',
              '• 27 rows with Mindy geocoding',
              'Current upstream population and currentness CANNOT be measured while the source is down.',
              'Required action: wait for EPA source recovery, then perform a controlled read-only verification BEFORE enabling automated ingest.',
              `Runbook: ${inst.runbook_path}`,
            ]
          : [
              'EPA source is reachable again. Run a controlled read-only source audit/reconciliation before enabling ingestion.',
              `Probe: ${probe.reachability}. ${probe.detail}`,
              'The current source schema, population, lifecycle, identity stability and parsing semantics remain UNVERIFIED.',
              'A reachable page is not permission to run an untested producer.',
              `Runbook: ${inst.runbook_path}`,
            ];
        await sendOpsAlert({
          subject: probe.blocked
            ? 'ACTION REQUIRED — EPA Acquisition Forecast source is unreachable'
            : 'EPA source is reachable again — controlled audit required before ingest',
          html: body.map((l) => `<p>${l}</p>`).join(''),
        });
        alerted = true;
      }
    }

    return NextResponse.json({
      success: true,                      // the WATCH executed
      dry: !apply,
      watchExecution: probe.watchExecution,
      sourceReachability: probe.blocked ? 'blocked' : 'reachable',
      failureClass: probe.reachability,
      probe: {
        discoveryUrl: EPA_DISCOVERY_URL, discoveryStatus: probe.discoveryStatus,
        finalUrl: probe.finalUrl, finalStatus: probe.finalStatus,
        attempts: probe.attempts, detail: probe.detail, markersFound: probe.markersFound,
      },
      sourceState, interventionState, ingestMode: inst.ingest_mode,
      preserved: {
        heldPopulation: inst.held_population,
        upstreamPopulation: inst.upstream_population,       // NULL — never inferred from held rows
        upstreamFingerprint: inst.upstream_fingerprint,     // NULL — no source pull ever recorded one
        lastSourceAdvance: inst.last_source_advance,        // NULL — EPA exposes no source clock
        lastSuccessfulCheck: inst.last_successful_check,
        lastVerifiedIngest: inst.last_verified_ingest,
        lastDataAdvance: inst.last_data_advance,
      },
      clocks: { lastPollAdvanced: apply, otherClocksPinned: true },
      alert: { alerted, reason: alertReason, key: alertKey },
      forecastsMutated: false,
      plannedInstancePatch: apply ? undefined : patch,
    });
  } catch (e) {
    return NextResponse.json({ success: false, watchExecution: 'error', failure: (e as Error).message }, { status: 500 });
  }
}

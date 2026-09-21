/**
 * SSA reachability watch — automates the NOTICING while ingest stays controlled.
 *
 * ⚠️ NEVER MUTATES agency_forecasts. It measures whether production can reach SSA.
 *
 * ⚠️ A BLOCKED RESULT IS A SUCCESSFUL WATCH. The job's purpose is to measure a known
 * blocked condition, so it returns 200 with `reachability: 'blocked'` rather than
 * failing the cron every day. Job success != source health.
 *
 * ⚠️ CLOCKS: only `last_poll` advances on a blocked run. `last_successful_check`,
 * `last_verified_ingest`, `last_data_advance` and `last_source_advance` stay pinned,
 * and the last successfully measured fingerprint/populations are retained — today's
 * inability to fetch is not evidence the upstream changed or emptied.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { probeSsaReachability, SSA_SOURCE_KEY, SSA_DISCOVERY_URL } from '@/lib/forecasts/ssa-reachability';
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
    const probe = await probeSsaReachability();

    const { data: instRows, error: readErr } = await sb.from('data_source_instances')
      .select('*').eq('source_key', SSA_SOURCE_KEY).limit(1);
    if (readErr) return NextResponse.json({ success: false, failure: `instance_read: ${readErr.message}` }, { status: 500 });
    const inst = instRows?.[0];
    if (!inst) return NextResponse.json({ success: false, failure: 'instance_missing' }, { status: 500 });

    // Recovery is never silent: a reachable probe does NOT re-enable automated ingest.
    // There is no `reachable_pending_verification` state in the schema, so we keep the
    // conservative pair (unmeasured + required) and say so in the receipt.
    const sourceState =
      probe.reachability === 'blocked' || probe.reachability === 'retired' ? 'unreachable'
      : probe.reachability === 'reachable' ? 'unmeasured'   // reachable, but NOT yet verified
      : 'unmeasured';
    const interventionState = 'required';

    // §5 — ONLY last_poll moves. Everything else is preserved verbatim.
    const patch: Record<string, unknown> = {
      last_poll: nowIso,
      source_state: sourceState,
      intervention_state: interventionState,
      updated_at: nowIso,
    };
    if (apply) {
      const { error } = await sb.from('data_source_instances').update(patch).eq('source_key', SSA_SOURCE_KEY);
      if (error) return NextResponse.json({ success: false, failure: `instance_update: ${error.message}` }, { status: 500 });
    }

    // One alert per distinct condition; the shared gate fails OPEN and re-reminds at 72h.
    let alerted = false, alertReason = 'not_attempted';
    const alertKey = `ssa_source_${probe.reachability}`;
    const fp = fingerprint([SSA_SOURCE_KEY, probe.reachability, String(probe.httpStatus ?? 'none')]);
    if (apply) {
      const gate = await shouldSendAlert(sb, alertKey, fp);
      alertReason = gate.reason;
      if (gate.send) {
        const subject = probe.reachability === 'reachable'
          ? 'SSA is reachable from production again — verify before re-enabling ingest'
          : 'ACTION REQUIRED — SSA production source access is blocked';
        const body = probe.reachability === 'reachable'
          ? [
              'SSA is reachable from Mindy production again.',
              'Run the production dry reconciliation BEFORE re-enabling automated ingest.',
              'Do not flip ingest_mode to automated until a dry run is verified.',
              `Runbook: ${inst.runbook_path}`,
            ]
          : [
              'SSA production source access is blocked by Akamai from Mindy’s Vercel egress.',
              `Probe: HTTP ${probe.httpStatus ?? 'n/a'} after ${probe.attempts} attempt(s). ${probe.detail}`,
              'Stored SSA data was last successfully verified against:',
              `• ${inst.upstream_population} current upstream records`,
              `• fingerprint ${inst.upstream_fingerprint}`,
              `• source clock ${inst.last_source_advance}`,
              'Automated production refresh is paused. Stored data is unchanged and remains valid.',
              'Required action: resolve/allowlist production egress, or run a controlled verified refresh from an approved reachable environment.',
              `Runbook: ${inst.runbook_path}`,
            ];
        await sendOpsAlert({ subject, html: body.map((l) => `<p>${l}</p>`).join('') });
        alerted = true;
      }
    }

    return NextResponse.json({
      success: true,                       // the WATCH executed
      dry: !apply,
      watchExecution: probe.watchExecution,
      sourceReachability: probe.reachability,
      probe: {
        discoveryUrl: SSA_DISCOVERY_URL, httpStatus: probe.httpStatus,
        attempts: probe.attempts, detail: probe.detail,
        discoveryFingerprint: probe.discoveryFingerprint, bytes: probe.bytes,
      },
      sourceState, interventionState,
      ingestMode: inst.ingest_mode,
      preserved: {
        upstreamFingerprint: inst.upstream_fingerprint,
        upstreamPopulation: inst.upstream_population,
        heldPopulation: inst.held_population,
        lastSourceAdvance: inst.last_source_advance,
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

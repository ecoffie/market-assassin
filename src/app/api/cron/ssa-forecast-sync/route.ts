/**
 * SSA OSDBU forecast sync — steady-state automated source.
 *
 * ⚠️ DRY MEANS ZERO PERSISTENT WRITES, including the clocks. A read-only check that
 * mutates the row it inspects is unfalsifiable.
 *
 * ⚠️ A SOURCE FAILURE MUST NEVER READ AS "current" OR "0 forecasts". SSA sits behind an
 * Akamai WAF that can answer HTTP 200 with an HTML body, so the producer validates the
 * XLSM signature separately and reports a typed failure instead of an empty success.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runSsaIngest, SSA_SOURCE_KEY, SSA_DISCOVERY_URL } from '@/lib/forecasts/ssa-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** A blocked or malformed source is never "current" — it is unreachable/unmeasured. */
function stateForFailure(f?: string): 'unreachable' | 'unmeasured' {
  return f === 'source_access_blocked' || f === 'source_retired' || f === 'not_xlsm'
    ? 'unreachable' : 'unmeasured';
}

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
    const r = await runSsaIngest(sb, { apply });

    if (!r.ok) {
      const sourceState = stateForFailure(r.failure);
      if (apply) {
        await sb.from('data_source_instances').update({
          last_poll: nowIso, source_state: sourceState, updated_at: nowIso,
        }).eq('source_key', SSA_SOURCE_KEY);
      }
      return NextResponse.json({
        success: false, dry: !apply, failure: r.failure, failureDetail: r.failureDetail,
        source: { discoveryUrl: r.discoveryUrl, selectedUrl: r.selectedUrl, fingerprint: r.fingerprint },
        sourceState, interventionState: 'required', detail: r,
      }, { status: 500 });
    }

    const patch: Record<string, unknown> = {
      last_poll: nowIso, last_successful_check: nowIso,
      upstream_fingerprint: r.fingerprint,
      upstream_population: r.distinctSourceIds,
      held_population: r.matched + r.inserted,
      source_state: 'current', intervention_state: 'none_required', updated_at: nowIso,
    };
    if (apply) patch.last_verified_ingest = nowIso;
    if (r.dataAdvanced) patch.last_data_advance = nowIso;
    if (apply && r.sourceLastModified) {
      const t = Date.parse(r.sourceLastModified);
      if (Number.isFinite(t)) patch.last_source_advance = new Date(t).toISOString();
    }
    if (apply) {
      const { error } = await sb.from('data_source_instances').update(patch).eq('source_key', SSA_SOURCE_KEY);
      if (error) {
        return NextResponse.json({ success: false, failure: `instance_update: ${error.message}`, detail: r }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true, applied: r.applied, dry: !apply,
      plannedInstancePatch: apply ? undefined : patch,
      source: {
        discoveryUrl: SSA_DISCOVERY_URL, selectedUrl: r.selectedUrl, selectedLabel: r.selectedLabel,
        fingerprint: r.fingerprint, sourceLastModified: r.sourceLastModified, sourceEtag: r.sourceEtag,
        rawUpstream: r.rawUpstream, distinctSourceIds: r.distinctSourceIds,
        rejectedNoIdentity: r.rejectedNoIdentity, duplicateSourceIds: r.duplicateSourceIds,
      },
      reconciliation: {
        matched: r.matched, newProven: r.newProven, changed: r.changed, unchanged: r.unchanged,
        historicalRetained: r.historicalRetained, physicalRows: r.physicalRows, rejected: r.rejectedNoIdentity,
        nullProtectedRows: r.nullProtectedRows, nullProtectedValues: r.nullProtectedValues,
      },
      receipts: {
        insertAttempted: r.insertAttempted, inserted: r.inserted,
        updateAttempted: r.updateAttempted, updated: r.updated,
        failures: r.insertFailed + r.updateFailed,
      },
      rawData: { malformedHeld: r.malformedHeldRawData, repairsNeeded: r.rawDataRepairsNeeded },
      legacySetAsideRepairsNeeded: r.legacySetAsideRepairsNeeded,
      dataAdvanced: r.dataAdvanced, sourceState: 'current', interventionState: 'none_required',
    });
  } catch (e) {
    return NextResponse.json({ success: false, failure: (e as Error).message, sourceState: 'unmeasured' }, { status: 500 });
  }
}

/**
 * NASA forecast sync — steady-state automated source.
 *
 * ⚠️ DRY MEANS ZERO PERSISTENT WRITES, including the clocks. A read-only check
 * that mutates the row it inspects is unfalsifiable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runNasaIngest } from '@/lib/forecasts/nasa-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
    const r = await runNasaIngest(sb, { apply });
    if (!r.ok) {
      if (apply) {
        await sb.from('data_source_instances').update({
          last_poll: nowIso,
          source_state: r.fingerprint ? 'unreachable' : 'unmeasured',
          updated_at: nowIso,
        }).eq('source_key', 'forecast_nasa_naf');
      }
      return NextResponse.json({ success: false, dry: !apply, failure: r.failure, detail: r }, { status: 500 });
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
      const { error } = await sb.from('data_source_instances').update(patch).eq('source_key', 'forecast_nasa_naf');
      if (error) return NextResponse.json({ success: false, failure: `instance_update: ${error.message}`, detail: r }, { status: 500 });
    }

    return NextResponse.json({
      success: true, applied: r.applied, dry: !apply,
      plannedInstancePatch: apply ? undefined : patch,
      source: {
        rawUpstream: r.rawUpstream, distinctSourceIds: r.distinctSourceIds,
        rejectedNoIdentity: r.rejectedNoIdentity, duplicateSourceIds: r.duplicateSourceIds,
        fingerprint: r.fingerprint, sourceLastModified: r.sourceLastModified, sourceEtag: r.sourceEtag,
      },
      reconciliation: {
        matched: r.matched, newProven: r.newProven, changed: r.changed, unchanged: r.unchanged,
        inserted: r.inserted, updated: r.updated,
        historicalRetained: r.historicalRetained, physicalRows: r.physicalRows,
        nullProtectedRows: r.nullProtectedRows, nullProtectedValues: r.nullProtectedValues,
      },
      receipts: { insertAttempted: r.insertAttempted, insertFailed: r.insertFailed, updateAttempted: r.updateAttempted, updateFailed: r.updateFailed },
      dataAdvanced: r.dataAdvanced, sourceState: 'current', interventionState: 'none_required',
    });
  } catch (e) {
    return NextResponse.json({ success: false, failure: (e as Error).message }, { status: 500 });
  }
}

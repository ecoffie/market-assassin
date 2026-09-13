/**
 * HHS SBCX forecast sync — a fully automated living source.
 *
 * Unlike Navy (manual/controlled, identity unresolved), HHS publishes a real
 * per-record `uuid` that the held corpus already stores as external_id, so
 * reconciliation is deterministic and ingest can be automated end to end.
 *
 * ⚠️ THE RESPONSE IS SEMANTIC, NOT A BARE 200. A source failure must never be
 * indistinguishable from "0 new records" — every outcome below names itself.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runHhsIngest } from '@/lib/forecasts/hhs-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const pw = request.nextUrl.searchParams.get('password');
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // ?dry=1 runs the full plan and writes nothing — for production smoke.
  const apply = request.nextUrl.searchParams.get('dry') !== '1';

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const nowIso = new Date().toISOString();

  try {
    const r = await runHhsIngest(sb, { apply });

    // A failed source is NEVER recorded as a quiet, current one.
    if (!r.ok) {
      // DRY observes and reports; it never records a verdict about the source.
      if (apply) {
        await sb.from('data_source_instances').update({
          last_poll: nowIso,
          source_state: r.failure === 'fingerprint_unmeasured' ? 'unmeasured' : 'unreachable',
          updated_at: nowIso,
        }).eq('source_key', 'forecast_hhs_sbcx');
      }
      return NextResponse.json({ success: false, dry: !apply, failure: r.failure, detail: r }, { status: 500 });
    }

    // held_population = CURRENT source records represented, NOT the physical row
    // count. The 164 historical rows are retained and reported separately, so a
    // growing archive can never make HHS look behind upstream.
    // ⚠️ DRY MEANS ZERO PERSISTENT WRITES — including the CLOCKS. The first draft
    // gated only last_verified_ingest on `apply`, so a dry smoke still advanced
    // last_poll/last_successful_check and rewrote fingerprint, populations and
    // state. A read-only check that mutates the row it is checking is
    // unfalsifiable: it would report "nothing changed" about state it had just
    // written itself.
    const patch: Record<string, unknown> = {
      last_poll: nowIso,
      last_successful_check: nowIso,
      upstream_fingerprint: r.fingerprint,
      upstream_population: r.usableUpstream,
      held_population: r.usableUpstream,
      source_state: 'current',
      intervention_state: 'none_required',
      updated_at: nowIso,
    };
    if (apply) patch.last_verified_ingest = nowIso;
    // ⚠️ ONLY a real mutation advances the data clock. Reconciliation running is
    // not data advancing.
    if (r.dataAdvanced) patch.last_data_advance = nowIso;

    if (apply) {
      const { error: upErr } = await sb.from('data_source_instances')
        .update(patch).eq('source_key', 'forecast_hhs_sbcx');
      if (upErr) {
        return NextResponse.json({ success: false, failure: `instance_update: ${upErr.message}`, detail: r }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      applied: r.applied,
      dry: !apply,
      plannedInstancePatch: apply ? undefined : patch,   // what a real run WOULD write
      source: {
        rawUpstream: r.upstreamTotal,
        usableUpstream: r.usableUpstream,
        parseRejected: r.parseRejected,
        duplicateSourceIds: r.duplicateSourceIds,
        fingerprint: r.fingerprint,
      },
      reconciliation: {
        matchedExisting: r.matchedExisting,
        inserted: r.inserted,
        updated: r.updated,
        unchanged: r.unchanged,
        newProven: r.newProven,
        changed: r.changed,
        historicalRetained: r.historicalRetained,
      },
      receipts: {
        insertAttempted: r.insertAttempted, insertFailed: r.insertFailed,
        updateAttempted: r.updateAttempted, updateFailed: r.updateFailed,
      },
      dataAdvanced: r.dataAdvanced,
      sourceState: 'current',
      interventionState: 'none_required',
    });
  } catch (e) {
    return NextResponse.json({ success: false, failure: (e as Error).message }, { status: 500 });
  }
}

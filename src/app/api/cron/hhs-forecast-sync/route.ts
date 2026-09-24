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
import { forecastWriterClient } from '@/lib/forecasts/writer';
import { sendOpsAlert } from '@/lib/ops-alert';
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

  // Declares itself the DAILY SYNC to the agency_forecasts floor guard (src/lib/forecasts/writer.ts).
  const sb = forecastWriterClient('daily_sync');
  const nowIso = new Date().toISOString();

  try {
    const r = await runHhsIngest(sb, { apply });
    // A refused bulk of NEW rows is a FAILED run (ops must route it through a publisher backfill), never a quiet success.
    if (r.insertRefused) {
      console.error(`[forecast-sync] new-row guard refused inserts: ${r.insertRefused}`);
      // The interval is NOT skipped silently: zero new rows were written, the payload is quarantined (or the alert
      // says it is not), and operations must suspend → replay → reconcile → explicitly activate the floor.
      await sendOpsAlert({
        subject: 'Forecast sync — HHS bulk of NEW rows refused (publisher floor active)',
        html: `<p>${r.insertRefused}</p><p>${r.insertQuarantined ? 'Rows quarantined in forecast_refused_loads — replay with scripts/forecast-refused-load.ts.' : 'QUARANTINE FAILED — the rows must be re-fetched from the source during the backfill.'}</p>`,
      }).catch(() => {});
      return NextResponse.json({ success: false, failure: `insert_refused: ${r.insertRefused}`, detail: r }, { status: 500 });
    }

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

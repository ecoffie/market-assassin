/**
 * DOJ forecast sync — an automated living source.
 *
 * ⚠️ THE RESPONSE IS SEMANTIC, NOT A BARE 200. A source failure must never be
 * indistinguishable from "0 new records", and the 21 rows DOJ identifies too
 * ambiguously to represent stay visible in every reply.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forecastWriterClient } from '@/lib/forecasts/writer';
import { sendOpsAlert } from '@/lib/ops-alert';
import { runDojIngest } from '@/lib/forecasts/doj-ingest';

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

  // Declares itself the DAILY SYNC to the agency_forecasts floor guard (src/lib/forecasts/writer.ts).
  const sb = forecastWriterClient('daily_sync');
  const nowIso = new Date().toISOString();

  try {
    const r = await runDojIngest(sb, { apply });
    // A refused bulk of NEW rows is a FAILED run (ops must route it through a publisher backfill), never a quiet success.
    if (r.insertRefused) {
      console.error(`[forecast-sync] new-row guard refused inserts: ${r.insertRefused}`);
      // The interval is NOT skipped silently: zero new rows were written, the payload is quarantined (or the alert
      // says it is not), and operations must suspend → replay → reconcile → explicitly activate the floor.
      await sendOpsAlert({
        subject: 'Forecast sync — DOJ bulk of NEW rows refused (publisher floor active)',
        html: `<p>${r.insertRefused}</p><p>${r.insertQuarantined ? 'Rows quarantined in forecast_refused_loads — replay with scripts/forecast-refused-load.ts.' : 'QUARANTINE FAILED — the rows must be re-fetched from the source during the backfill.'}</p>`,
      }).catch(() => {});
      return NextResponse.json({ success: false, failure: `insert_refused: ${r.insertRefused}`, detail: r }, { status: 500 });
    }

    if (!r.ok) {
      // ⚠️ DRY observes and reports; it never records a verdict about the source.
      if (apply) {
        await sb.from('data_source_instances').update({
          last_poll: nowIso,
          source_state: r.fingerprint ? 'unreachable' : 'unmeasured',
          updated_at: nowIso,
        }).eq('source_key', 'forecast_doj_live');
      }
      return NextResponse.json({ success: false, dry: !apply, failure: r.failure, detail: r }, { status: 500 });
    }

    // held_population tracks the SAFE CURRENT population (446), never the 619
    // physical rows — historical and quarantined rows must not make a healthy
    // source look behind upstream.
    const patch: Record<string, unknown> = {
      last_poll: nowIso,
      last_successful_check: nowIso,
      upstream_fingerprint: r.fingerprint,
      upstream_population: r.safeCurrentUpstream,
      held_population: r.safeCurrentUpstream,
      source_state: 'current',
      intervention_state: 'none_required',
      updated_at: nowIso,
    };
    if (apply) patch.last_verified_ingest = nowIso;
    // Only a REAL mutation advances the data clock.
    if (r.dataAdvanced) patch.last_data_advance = nowIso;
    // Advance the source clock only from the FINAL-200 Last-Modified.
    if (apply && r.sourceLastModified) {
      const t = Date.parse(r.sourceLastModified);
      if (Number.isFinite(t)) patch.last_source_advance = new Date(t).toISOString();
    }

    if (apply) {
      const { error: upErr } = await sb.from('data_source_instances')
        .update(patch).eq('source_key', 'forecast_doj_live');
      if (upErr) return NextResponse.json({ success: false, failure: `instance_update: ${upErr.message}`, detail: r }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      applied: r.applied,
      dry: !apply,
      plannedInstancePatch: apply ? undefined : patch,
      source: {
        rawUpstream: r.rawUpstream,
        safeCurrentUpstream: r.safeCurrentUpstream,
        withinWorkbookIdentityRejected: r.withinWorkbookIdentityRejected,
        duplicateAtnGroups: r.duplicateAtnGroups,
        crossEditionIdentitySuspect: r.crossEditionIdentitySuspect,
        identityRejectedTotal: r.withinWorkbookIdentityRejected + r.crossEditionIdentitySuspect,
        blankAtnRows: r.blankAtnRows,
        fingerprint: r.fingerprint,
        sourceLastModified: r.sourceLastModified,
      },
      reconciliation: {
        matchedSafe: r.matchedSafe,
        newProven: r.newProven,
        changedSafe: r.changedSafe,
        unchangedSafe: r.unchangedSafe,
        inserted: r.inserted,
        updated: r.updated,
        historicalRetained: r.absentRetained,
        heldAmbiguous: r.heldAmbiguous,
        corruptLegacyIdentity: r.corruptLegacyIdentity,
        nullProtectedRows: r.nullProtectedRows,
        nullProtectedValues: Object.values(r.nullProtectedFields).reduce((a, b) => a + b, 0),
        nullProtectedFields: r.nullProtectedFields,
      },
      suspects: r.suspects,
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

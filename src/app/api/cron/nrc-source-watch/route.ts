/**
 * NRC source watch — access + secondary edition signal. NEVER ingests.
 *
 * ⚠️ Does not mutate agency_forecasts. The 89 held rows (all geocoded, provenance
 * repaired from the originating snapshot) are untouched under every outcome.
 *
 * ⚠️ A gated result is a SUCCESSFUL watch. Job success != source health.
 *
 * ⚠️ The PDF is an EDITION SIGNAL ONLY. It must never populate upstream_population,
 * held_population or last_source_advance, and is never OCR'd into forecast records.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { probeNrcSource, NRC_SOURCE_KEY, NRC_DISCOVERY_URL, NRC_PDF_URL } from '@/lib/forecasts/nrc-reachability';
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
    const { data: rows, error: readErr } = await sb.from('data_source_instances')
      .select('*').eq('source_key', NRC_SOURCE_KEY).limit(1);
    if (readErr) return NextResponse.json({ success: false, failure: `instance_read: ${readErr.message}` }, { status: 500 });
    const inst = rows?.[0];
    if (!inst) return NextResponse.json({ success: false, failure: 'instance_missing' }, { status: 500 });

    const probe = await probeNrcSource();

    // Recovery is conservative: `unmeasured` + `required`, never `current`.
    const sourceState = probe.canonicalRecovered ? 'unmeasured' : 'unreachable';
    const interventionState = 'required';

    // §11 — ONLY last_poll moves. Populations/fingerprint/clocks are preserved.
    const patch: Record<string, unknown> = {
      last_poll: nowIso, source_state: sourceState,
      intervention_state: interventionState, updated_at: nowIso,
    };
    if (apply) {
      const { error } = await sb.from('data_source_instances').update(patch).eq('source_key', NRC_SOURCE_KEY);
      if (error) return NextResponse.json({ success: false, failure: `instance_update: ${error.message}` }, { status: 500 });
    }

    let alerted = false, alertReason = 'not_attempted';
    const alertKey = probe.canonicalRecovered ? 'nrc_source_recovered' : 'nrc_source_auth_gated';
    const fp = fingerprint([NRC_SOURCE_KEY, probe.canonical.state, probe.pdf.fingerprint ?? 'no-pdf']);
    if (apply) {
      const gate = await shouldSendAlert(sb, alertKey, fp);
      alertReason = gate.reason;
      if (gate.send) {
        const body = probe.canonicalRecovered
          ? [
              'NRC canonical forecast source is machine-readable again. Run a fresh read-only audit before enabling automated ingestion.',
              `Probe: ${probe.canonical.detail}`,
              'Re-establish schema, population, identity uniqueness, historical ID stability, field semantics, lifecycle semantics and fingerprint/currentness BEFORE building or enabling ingest.',
              `Runbook: ${inst.runbook_path}`,
            ]
          : [
              'NRC’s canonical GSA Acquisition Gateway FCO source now requires Login.gov/AAL2 authentication.',
              `Probe: ${probe.canonical.state} — ${probe.canonical.detail}`,
              'Mindy holds:',
              `• ${inst.held_population} FY2026 NRC forecasts`,
              '• source-native NRC IDs (89/89 verified)',
              '• 89/89 geocoded',
              '• provenance reconstructed from the exact originating snapshot',
              'Current live upstream population and currentness CANNOT be measured.',
              'Required action: resolve authorized GSA access, or perform a controlled refresh from an approved authenticated source.',
              `Secondary signal — NRC public PDF: ${probe.pdf.reachable ? `reachable, Last-Modified ${probe.pdf.lastModified}` : 'not reachable'} (edition signal only; never OCR’d into records).`,
              `Runbook: ${inst.runbook_path}`,
            ];
        await sendOpsAlert({
          subject: probe.canonicalRecovered
            ? 'NRC canonical forecast source is machine-readable again — audit required'
            : 'ACTION REQUIRED — NRC canonical forecast source is authentication-gated',
          html: body.map((l) => `<p>${l}</p>`).join(''),
        });
        alerted = true;
      }
    }

    return NextResponse.json({
      success: true, dry: !apply,
      watchExecution: probe.watchExecution,
      canonicalSource: probe.canonical.state,       // auth_gated while blocked
      publicShellAcceptedAsData: false,             // never
      canonicalRecovered: probe.canonicalRecovered,
      canonical: { ...probe.canonical, discoveryUrl: NRC_DISCOVERY_URL },
      pdfSignal: { url: NRC_PDF_URL, ...probe.pdf, role: 'secondary_edition_signal_only' },
      sourceState, interventionState, ingestMode: inst.ingest_mode,
      preserved: {
        heldPopulation: inst.held_population,
        upstreamPopulation: inst.upstream_population,     // NULL
        upstreamFingerprint: inst.upstream_fingerprint,   // NULL
        lastSourceAdvance: inst.last_source_advance,      // NULL
        lastSuccessfulCheck: inst.last_successful_check,  // NULL
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

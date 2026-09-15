/**
 * GET /api/cron/institute-gao-sync — the scheduled Mindy Institute GAO collector.
 *
 * Runs the pipeline proven in Potato 1 (PR #1466):
 *   GAO RSS -> Institute source record -> canonical agency -> evidence retained
 *           -> optional defensible pain point -> immutable change history
 *
 * ⚠️ SCHEDULING MUST NOT WEAKEN THE INTEGRITY SEMANTICS. Five clocks stay distinct
 * on data_source_instances[institute_gao] (notes-sentinel is no longer authority):
 *
 *   last_poll              every real RSS check
 *   last_successful_check  only successful complete feed read
 *   last_verified_ingest   successful verified canonical reconciliation
 *   last_data_advance      only when held Institute / derived data actually changes
 *   last_source_advance    newest defensible GAO publication date (never Mindy time)
 *
 * Failure modes report as THEMSELVES — never as a quiet upstream.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  fetchGaoReports,
  ingestInstituteDocument,
  reconcileUnresolvedGaoAgencies,
} from '@/lib/institute/sources';
import { deriveFromInstituteSource } from '@/lib/strategic-intel/derive';
import {
  GAO_SOURCE_KEY,
  measureGaoHeldPopulation,
  measureGaoResolutionRate,
  stampGaoInstance,
  sourceAdvanceWithoutHeldAlert,
  type GaoAlertCandidate,
} from '@/lib/institute/gao-instance';
import { encodeGaoClocks, classifyGaoFreshness, type GaoClocks } from '@/lib/institute/source-clocks';
import { sendOpsAlert } from '@/lib/ops-alert';
import { shouldSendAlert, fingerprint } from '@/lib/ops-alert-dedup';
import CODES from '@/data/agency-toptier-codes.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function dispatchAlerts(db: ReturnType<typeof sb>, alerts: GaoAlertCandidate[]) {
  const fired: string[] = [];
  for (const a of alerts) {
    const fp = fingerprint(a.fingerprintParts);
    const gate = await shouldSendAlert(db, `institute_gao:${a.kind}`, fp);
    if (!gate.send) continue;
    await sendOpsAlert({
      subject: a.subject,
      html: a.bodyLines.map((l) => `<p>${l}</p>`).join(''),
    });
    fired.push(a.kind);
  }
  return fired;
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasSecret = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const { searchParams } = new URL(request.url);
  const hasPassword = Boolean(process.env.ADMIN_PASSWORD)
    && searchParams.get('password') === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !hasPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = searchParams.get('mode') === 'preview' ? 'preview' : 'execute';
  const budgetMs = Number.parseInt(searchParams.get('budgetMs') || '240000', 10);
  const started = Date.now();
  const pollAt = new Date().toISOString();
  const db = sb();
  const names = Object.keys(CODES as Record<string, unknown>);

  // Prior instance state (for degradation + source-advance-without-held).
  const { data: priorInst } = await db.from('data_source_instances')
    .select('last_source_advance, held_population, notes')
    .eq('source_key', GAO_SOURCE_KEY)
    .maybeSingle();
  const priorSourceAdvance = (priorInst?.last_source_advance as string) ?? null;
  const priorResolutionRate = await measureGaoResolutionRate(db);

  // ── 1. POLL ──────────────────────────────────────────────────────────────
  let docs: Awaited<ReturnType<typeof fetchGaoReports>> = [];
  try {
    docs = await fetchGaoReports();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const held = await measureGaoHeldPopulation(db);
    let alertsFired: string[] = [];
    try {
      const stamped = await stampGaoInstance(db, {
        pollAt, pollOk: false, verifiedComplete: false, dataAdvanced: false,
        sourceAdvanceAt: null, heldPopulation: held, priorResolutionRate,
      });
      alertsFired = await dispatchAlerts(db, stamped.alerts);
    } catch (stampErr) {
      console.error('[institute-gao-sync] stamp after poll failure:', stampErr);
    }
    return NextResponse.json({
      success: false, pollOk: false, status: 'ingest_broken',
      reason: 'source_fetch_failed', error: message,
      documentsSeen: null, evidenceInserted: 0, intelligenceChanges: 0,
      sourceWatermark: null,
      alertsFired,
      note: 'Source fetch failed. This is NOT "0 new reports" and NOT upstream_quiet.',
    }, { status: 502 });
  }

  if (docs.length === 0) {
    const held = await measureGaoHeldPopulation(db);
    let alertsFired: string[] = [];
    try {
      const stamped = await stampGaoInstance(db, {
        pollAt, pollOk: false, verifiedComplete: false, dataAdvanced: false,
        sourceAdvanceAt: null, heldPopulation: held, priorResolutionRate,
        // pollOk=false because a real GAO feed always carries items — treat as failure.
      });
      // Override alert kind to poll_failure semantics via extra candidate.
      alertsFired = await dispatchAlerts(db, [
        ...stamped.alerts,
        {
          kind: 'poll_failure',
          fingerprintParts: [GAO_SOURCE_KEY, 'feed_parsed_zero', pollAt.slice(0, 10)],
          subject: '[GAO] Feed parsed zero documents',
          bodyLines: [
            'The feed responded but yielded no parseable documents.',
            'A real GAO feed always carries items — this is a parse/shape failure.',
          ],
        },
      ]);
    } catch (stampErr) {
      console.error('[institute-gao-sync] stamp after empty feed:', stampErr);
    }
    return NextResponse.json({
      success: false, pollOk: true, feedMalformed: true, status: 'ingest_broken',
      reason: 'feed_parsed_zero_documents',
      documentsSeen: 0, evidenceInserted: 0, intelligenceChanges: 0,
      sourceWatermark: null, alertsFired,
      note: 'The feed responded but yielded no parseable documents. A real GAO feed always carries items, so this is a parse/shape failure — not a quiet upstream.',
    }, { status: 502 });
  }

  // Watermark comes ONLY from documents we actually parsed — never Mindy time.
  const sourceWatermark = docs.map((d) => d.publicationDate).filter(Boolean).sort().at(-1) ?? null;

  if (mode === 'preview') {
    return NextResponse.json({
      success: true, mode, pollOk: true, documentsSeen: docs.length, sourceWatermark,
      note: 'preview — nothing written',
    });
  }

  // ── 2. INSTITUTE INGEST + 3. DERIVATION ─────────────────────────────────
  let evidenceInserted = 0, alreadyHeld = 0, resolved = 0, unresolved = 0;
  let painPointsCreated = 0, evidenceOnly = 0, blocked = 0, failed = 0;
  let processed = 0, partial = false;

  for (const doc of docs) {
    if (Date.now() - started > budgetMs) { partial = true; break; }
    processed++;
    const ing = await ingestInstituteDocument(db, doc, names);
    if (ing.error) { failed++; continue; }
    if (ing.inserted) evidenceInserted++; else alreadyHeld++;
    if (ing.resolution.resolved) resolved++; else unresolved++;

    const der = await deriveFromInstituteSource(db, {
      instituteSourceId: ing.instituteSourceId,
      documentNumber: doc.documentNumber,
      title: doc.title,
      url: doc.url,
      resolution: ing.resolution,
    });
    if (der.outcome === 'pain_point_created') painPointsCreated++;
    else if (der.outcome === 'blocked_history_unavailable') blocked++;
    else if (der.outcome.startsWith('evidence_only')) evidenceOnly++;
  }

  // ── 3b. Reconcile previously-unresolved held rows (phrase-map improvements) ─
  let reconcile = null;
  try {
    reconcile = await reconcileUnresolvedGaoAgencies(db, names);
    // Derive for newly resolved rows.
    for (const d of reconcile.details) {
      if (!d.canonicalAgency) continue;
      const { data: row } = await db.from('institute_sources')
        .select('id,title,source_url,canonical_agency,resolution_method,resolution_confidence,toptier_code')
        .eq('source_type', 'gao_report')
        .eq('document_number', d.documentNumber)
        .maybeSingle();
      if (!row?.canonical_agency) continue;
      const der = await deriveFromInstituteSource(db, {
        instituteSourceId: row.id as string,
        documentNumber: d.documentNumber,
        title: row.title as string,
        url: row.source_url as string,
        resolution: {
          canonicalAgency: row.canonical_agency as string,
          toptierCode: (row.toptier_code as string) ?? null,
          subAgency: null,
          officeCode: null,
          method: (row.resolution_method as 'exact_name' | 'alias' | 'cgac_code' | 'department_of' | 'unresolved') ?? 'alias',
          confidence: (row.resolution_confidence as 'high' | 'medium' | 'unresolved') ?? 'high',
          resolved: true,
          input: row.canonical_agency as string,
          note: 'reconcile',
        },
      });
      if (der.outcome === 'pain_point_created') painPointsCreated++;
    }
  } catch (recErr) {
    console.error('[institute-gao-sync] reconcile failed:', recErr);
    blocked++;
  }

  // ── 4. FIVE CLOCKS on data_source_instances ─────────────────────────────
  const heldPopulation = await measureGaoHeldPopulation(db);
  const resolutionRate = await measureGaoResolutionRate(db);
  const dataAdvanced = evidenceInserted > 0 || painPointsCreated > 0
    || (reconcile?.newlyResolved ?? 0) > 0;
  const verifiedComplete = !partial && failed === 0 && blocked === 0;

  const extraAlerts: GaoAlertCandidate[] = [];
  const withoutHeld = sourceAdvanceWithoutHeldAlert({
    priorSourceAdvance,
    newSourceAdvance: sourceWatermark,
    evidenceInserted,
    pollAt,
  });
  if (withoutHeld) extraAlerts.push(withoutHeld);

  let alertsFired: string[] = [];
  let sourceState = 'current';
  try {
    const stamped = await stampGaoInstance(db, {
      pollAt,
      pollOk: true,
      verifiedComplete,
      dataAdvanced,
      sourceAdvanceAt: sourceWatermark,
      heldPopulation,
      resolutionRate,
      priorResolutionRate,
    }, extraAlerts);
    sourceState = stamped.sourceState;
    alertsFired = await dispatchAlerts(db, stamped.alerts);
  } catch (stampErr) {
    console.error('[institute-gao-sync] instance stamp failed:', stampErr);
  }

  // Compat: keep notes sentinel in sync so pre-cutover readers don't go dark.
  // Authority is the instance; this is a mirror only.
  try {
    const { data: newestChange } = await db.from('intelligence_changes')
      .select('changed_at').order('changed_at', { ascending: false }).limit(1).maybeSingle();
    const clocks: GaoClocks = {
      lastPoll: pollAt,
      lastSourceAdvance: sourceWatermark,
      lastIntelligenceChange: (newestChange?.changed_at as string) ?? null,
    };
    const { data: srcRow } = await db.from('data_sources')
      .select('notes').eq('key', GAO_SOURCE_KEY).maybeSingle();
    if (verifiedComplete) {
      const notes = encodeGaoClocks((srcRow?.notes as string) ?? null, clocks);
      await db.from('data_sources')
        .update({ last_built: pollAt.slice(0, 10), notes })
        .eq('key', GAO_SOURCE_KEY);
    }
  } catch (compatErr) {
    console.error('[institute-gao-sync] notes compat mirror failed:', compatErr);
  }

  const freshness = classifyGaoFreshness({
    clocks: {
      lastPoll: pollAt,
      lastSourceAdvance: sourceWatermark,
      lastIntelligenceChange: null,
    },
    now: pollAt,
  });
  const status = failed > 0 || blocked > 0 ? 'degraded'
    : evidenceInserted === 0 ? (freshness.status === 'upstream_quiet' ? 'upstream_quiet' : 'no_new_evidence')
    : 'advanced';

  return NextResponse.json({
    success: failed === 0 && blocked === 0,
    mode, pollOk: true, status, partial,
    documentsSeen: docs.length, documentsProcessed: processed,
    evidenceInserted, alreadyHeld, resolved, unresolved,
    painPointsCreated, evidenceOnly, blockedNoHistory: blocked, failed,
    reconcile,
    clocks: {
      last_poll: pollAt,
      last_successful_check: pollAt,
      last_verified_ingest: verifiedComplete ? pollAt : null,
      last_data_advance: dataAdvanced ? pollAt : null,
      last_source_advance: sourceWatermark,
      held_population: heldPopulation,
      upstream_population: null,
      resolution_rate: resolutionRate,
      source_state: sourceState,
    },
    freshness,
    alertsFired,
    elapsedMs: Date.now() - started,
  });
}

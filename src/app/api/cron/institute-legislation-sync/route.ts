/**
 * GET /api/cron/institute-legislation-sync — the scheduled Institute LEGISLATIVE collector.
 *
 *   Congress API -> Institute source record (one per VERSION) -> canonical agency
 *                -> evidence retained -> optional defensible claim -> immutable history
 *
 * Sibling of institute-gao-sync, deliberately built to the same reliability contract.
 *
 * ⚠️ THE FAILURE MODE THIS ROUTE EXISTS TO PREVENT. Before it, Mindy had no
 * legislative watcher at all, so "we have no FY2027 NDAA" and "no FY2027 NDAA exists"
 * were the same silence. Every response below therefore reports a DISCOVERY STATE,
 * and the five states are mutually exclusive:
 *
 *   source_unavailable  API/transport failed. NEVER "0 new legislation". HTTP 502.
 *   not_yet_introduced  API answered; the measure genuinely does not exist yet.
 *   introduced          exists, no chamber has passed it.
 *   diverging           House AND Senate each have their own text — they disagree.
 *   enacted             it became law.
 *
 * Four clocks stay distinct, exactly as in the GAO route:
 *   pollOk=false            fetch failure, never "no new legislation"
 *   sourceWatermark         advances ONLY from documents actually parsed
 *   lastInstituteIngest     stamped ONLY when a row was really inserted
 *   lastIntelligenceChange  stamped ONLY when a claim really changed
 *   partial=true            budget ran out mid-run — explicitly NOT "complete"
 *
 * House rule: deploy the route, curl prod for a real 200 + JSON, THEN insert the
 * cron_jobs row. Never the same push.
 */
import { NextRequest, NextResponse } from 'next/server';
import { reportCronOutcome } from '@/lib/cron-self-report';
import { createClient } from '@supabase/supabase-js';
import {
  collectBillDocuments,
  resolveLegislationAgency,
  congressApiKey,
  currentCongress,
  chamberOf,
  NDAA_TITLE_PATTERN,
  LEGISLATIVE_SOURCE_TYPES,
  type BillRef,
} from '@/lib/institute/legislation';
import {
  discoverSince,
  knownMeasures,
  mergeMeasures,
  decodeDiscoveryCursor,
  encodeDiscoveryCursor,
  watermarkFor,
} from '@/lib/institute/legislation-discovery';
import { ingestInstituteDocument } from '@/lib/institute/sources';
import { deriveFromInstituteSource } from '@/lib/strategic-intel/derive';
import {
  encodeLegislationClocks,
  classifyLegislationFreshness,
  type LegislationClocks,
} from '@/lib/institute/legislation-clocks';
import CODES from '@/data/agency-toptier-codes.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SOURCE_KEY = 'institute_legislation';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * The observable state of a legislative FAMILY, derived from what we actually
 * collected — never asserted.
 *
 * `diverging` is a real, decision-relevant condition: when both chambers hold their
 * own text, the provisions a contractor is reading may not survive conference. A
 * collapsed "NDAA 2027" record cannot express this at all, which is why versions are
 * separate rows.
 */
export function classifyFamilyState(input: {
  becameLaw: boolean;
  houseVersions: number;
  senateVersions: number;
}): 'enacted' | 'diverging' | 'introduced' {
  if (input.becameLaw) return 'enacted';
  if (input.houseVersions > 0 && input.senateVersions > 0) return 'diverging';
  return 'introduced';
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasSecret = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const { searchParams } = new URL(request.url);
  const hasPassword =
    Boolean(process.env.ADMIN_PASSWORD) && searchParams.get('password') === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !hasPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = searchParams.get('mode') === 'preview' ? 'preview' : 'execute';
  const budgetMs = Number.parseInt(searchParams.get('budgetMs') || '240000', 10);
  // Optional overrides for VALIDATION ONLY. Discovery defaults are fully dynamic;
  // nothing here is required for steady state.
  const congressParam = searchParams.get('congress');
  const congress = congressParam ? Number.parseInt(congressParam, 10) : currentCongress();
  const maxPages = Number.parseInt(searchParams.get('maxPages') || '6', 10);

  const started = Date.now();
  const pollAt = new Date().toISOString();

  // A missing credential is a CONFIG failure, not an empty Congress.
  if (!congressApiKey()) {
    return NextResponse.json(
      {
        success: false,
        pollOk: false,
        status: 'ingest_broken',
        discoveryState: 'source_unavailable',
        reason: 'missing_api_key',
        documentsSeen: null,
        evidenceInserted: 0,
        sourceWatermark: null,
        note: 'No CONGRESS_API_KEY/GOVINFO_API_KEY configured. This is NOT "no legislation found".',
      },
      { status: 502 },
    );
  }

  const db = sb();
  const names = Object.keys(CODES as Record<string, unknown>);

  // ── 1. DISCOVERY + TRACKING (two jobs, deliberately separate) ───────────
  //
  // ⚠️ Discovery finds NEW measures over a bounded, watermarked window whose
  // completeness is MEASURED against the API's own total. Tracking re-polls measures
  // already in the corpus BY IDENTITY, so a known bill stays tracked forever even
  // after thousands of unrelated bills push it out of any recent-update window.
  // Production defect 2026-09-20: S.4784 sat at feed position 2948 and silently
  // vanished from a 1500-row scan that still claimed pollOk/complete.
  const srcRowEarly = await db
    .from('data_sources')
    // unranged-ok: single row by the unique key.
    .select('notes')
    .eq('key', SOURCE_KEY)
    .maybeSingle();

  const cursor = decodeDiscoveryCursor((srcRowEarly.data?.notes as string) ?? null);
  // A cursor from another Congress is NOT a watermark for this one -> full pass.
  const since = watermarkFor(cursor, congress);

  const discovery = await discoverSince({
    congress,
    since,
    pattern: NDAA_TITLE_PATTERN,
    maxPages,
    budgetMs: Math.min(120_000, budgetMs),
  });

  // Known measures are polled regardless of discovery's outcome — a discovery
  // failure must never stop us tracking what we already hold.
  const known = await knownMeasures(db, congress);

  if (!discovery.pollOk) {
    return NextResponse.json(
      {
        success: false,
        pollOk: false,
        status: 'ingest_broken',
        discoveryState: 'source_unavailable',
        coverage: discovery.coverage,
        reason: 'source_fetch_failed',
        error: discovery.error,
        congress,
        billsScanned: discovery.scanned,
        documentsSeen: null,
        evidenceInserted: 0,
        sourceWatermark: null, // explicitly NOT advanced
        watermarkAdvanced: false,
        note: 'Congress API fetch failed. This is NOT "0 new legislation" and NOT upstream_quiet.',
      },
      { status: 502 },
    );
  }

  const measures = mergeMeasures(discovery.matched, known.measures);

  // Nothing discovered AND nothing already known.
  if (measures.length === 0) {
    const completelyScanned = discovery.coverage === 'complete';
    return NextResponse.json({
      success: true,
      pollOk: true,
      // ⚠️ Only a COMPLETE scan may claim the measure does not exist. A ceiling
      // makes this coverage_incomplete — never a confident "not yet introduced".
      status: completelyScanned ? 'no_new_evidence' : 'coverage_incomplete',
      discoveryState: completelyScanned ? 'not_yet_introduced' : 'unknown_incomplete_scan',
      coverage: discovery.coverage,
      partial: !completelyScanned,
      congress,
      billsScanned: discovery.scanned,
      reportedTotal: discovery.reportedTotal,
      windowFrom: discovery.windowFrom,
      matchedBills: 0,
      knownMeasures: known.measures.length,
      documentsSeen: 0,
      evidenceInserted: 0,
      sourceWatermark: null,
      watermarkAdvanced: false,
      note: completelyScanned
        ? 'Congress answered and the interval was COMPLETELY scanned; no matching measure exists. Distinct from a source failure.'
        : 'Scan hit a ceiling before covering the interval. Absence is NOT established — this is not "no legislation".',
    });
  }

  // ── 2. COLLECT every version + committee report per matched measure ──────
  type FamilyReport = {
    bill: string;
    chamber: string;
    versions: number;
    committeeReports: number;
    becameLaw: boolean;
    lawNumber: string | null;
    latestActionDate: string | null;
  };

  const families: FamilyReport[] = [];
  const allDocs: Array<{ ref: BillRef; doc: Awaited<ReturnType<typeof collectBillDocuments>>['documents'][number] }> = [];
  let anyLaw = false;
  let houseVersions = 0;
  let senateVersions = 0;
  let collectFailures = 0;
  let partial = false;

  for (const ref of measures) {
    if (Date.now() - started > budgetMs) {
      partial = true;
      break;
    }
    try {
      const { documents, status } = await collectBillDocuments(ref);
      const ch = chamberOf(ref.billType);
      const textCount = documents.filter((d) => d.sourceType !== 'committee_report').length;
      if (ch === 'House') houseVersions += textCount;
      if (ch === 'Senate') senateVersions += textCount;
      if (status.becameLaw) anyLaw = true;

      families.push({
        bill: `${ref.billType} ${ref.number}`,
        chamber: ch,
        versions: textCount,
        committeeReports: documents.length - textCount,
        becameLaw: status.becameLaw,
        lawNumber: status.lawNumber,
        latestActionDate: status.latestActionDate,
      });
      for (const doc of documents) allDocs.push({ ref, doc });
    } catch (e) {
      // One measure failing must not be reported as that measure having no documents.
      collectFailures++;
      families.push({
        bill: `${ref.billType} ${ref.number}`,
        chamber: chamberOf(ref.billType),
        versions: -1,
        committeeReports: -1,
        becameLaw: false,
        lawNumber: null,
        latestActionDate: e instanceof Error ? `collect_failed: ${e.message}` : 'collect_failed',
      });
    }
  }

  const discoveryState = classifyFamilyState({ becameLaw: anyLaw, houseVersions, senateVersions });

  // Watermark comes ONLY from documents we actually parsed.
  const sourceWatermark =
    allDocs
      .map(({ doc }) => doc.sourceWatermark ?? doc.publicationDate)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;

  if (mode === 'preview') {
    return NextResponse.json({
      success: true,
      mode,
      pollOk: true,
      discoveryState,
      coverage: discovery.coverage,
      partial: partial || discovery.coverage !== 'complete',
      congress,
      billsScanned: discovery.scanned,
      reportedTotal: discovery.reportedTotal,
      windowFrom: discovery.windowFrom,
      matchedBills: discovery.matched.length,
      knownMeasures: known.measures.length,
      measuresTracked: measures.length,
      knownReadError: known.error ?? null,
      families,
      documentsSeen: allDocs.length,
      documents: allDocs.map(({ doc }) => ({
        documentNumber: doc.documentNumber,
        sourceType: doc.sourceType,
        title: doc.title,
        publicationDate: doc.publicationDate,
        url: doc.url,
        version: (doc.raw as Record<string, unknown> | undefined)?.legislativeVersion ?? null,
        chamber: (doc.raw as Record<string, unknown> | undefined)?.chamber ?? null,
      })),
      sourceWatermark,
      collectFailures,
      note: 'preview — nothing written',
    });
  }

  // ── 3. INGEST + 4. DERIVATION ───────────────────────────────────────────
  let evidenceInserted = 0,
    evidenceUpdated = 0,
    evidenceUnchanged = 0,
    alreadyHeld = 0,
    resolved = 0,
    unresolved = 0;
  let painPointsCreated = 0,
    evidenceOnly = 0,
    blocked = 0,
    failed = 0;

  for (const { doc } of allDocs) {
    if (Date.now() - started > budgetMs) {
      partial = true;
      break;
    }
    const resolution = resolveLegislationAgency(doc, names);
    // ⚠️ PASS THE RESOLUTION, NOT A NAME LIST.
    //
    // Gate 3 defect: this previously handed `[resolution.canonicalAgency]` to the
    // ingest, which then RE-RESOLVED from the title using the GAO matcher. An NDAA
    // title never contains the literal "Department of Defense", so 28 of 29 rows
    // persisted with canonical_agency = null even though the resolver had already
    // answered correctly. The grounded result now travels through verbatim.
    //
    // `updateExisting` makes a re-run REPAIR the attribution on the same identity
    // rather than early-returning as a no-op. Identity is unchanged; no row is added.
    const ing = await ingestInstituteDocument(db, doc, names, {
      agencyResolution: resolution,
      updateExisting: true,
    });
    if (ing.error) {
      failed++;
      continue;
    }
    if (ing.inserted) evidenceInserted++;
    else if (ing.updated) evidenceUpdated++;
    else evidenceUnchanged++;     // genuine no-op: nothing source-derived changed
    if (!ing.inserted) alreadyHeld++;
    if (ing.resolution.resolved) resolved++;
    else unresolved++;

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

  // ── 5. CLOCKS — each advances ONLY on its own real event ────────────────
  const srcRow = srcRowEarly.data ? { notes: srcRowEarly.data.notes } : null;

  // ⚠️ BOTH of these MUST be scoped to the LEGISLATIVE corpus.
  //
  // institute_sources and intelligence_changes are SHARED with the GAO collector,
  // which runs daily. An unscoped "newest row" query returns GAO's timestamp, so a
  // legislative ingest that had been dead for months would still report a fresh
  // clock — the same "absence is invisible" failure that caused this whole incident.
  // The clock must measure THIS source or it is worse than no clock at all.
  const { data: newestIngest, error: ingestErr } = await db
    .from('institute_sources')
    // unranged-ok: newest single row, bounded by limit(1) + maybeSingle().
    .select('discovered_at')
    .in('source_type', LEGISLATIVE_SOURCE_TYPES as unknown as string[])
    .order('discovered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Legislative derivations link to their evidence by institute_source_id, so the
  // change clock is scoped by an INNER JOIN back to this corpus via PostgREST's
  // embedded-resource filter.
  //
  // ⚠️ NOT a two-step "collect ids, then .in(ids)" — that pattern needs a row cap,
  // and a capped id list silently drops older sources, so the newest change under a
  // dropped source would vanish from the clock. That is the capped-RETURNING lesson
  // (a bounded read reported as a complete answer). The join has no such ceiling.
  const { data: newestChange, error: changeErr } = await db
    .from('intelligence_changes')
    // unranged-ok: newest single row, bounded by limit(1) + maybeSingle().
    .select('changed_at, institute_sources!inner(source_type)')
    .in('institute_sources.source_type', LEGISLATIVE_SOURCE_TYPES as unknown as string[])
    .order('changed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // A failed clock read is UNKNOWN, never "never happened" (Bug Prevention Rule #11).
  // Stamping a null over a real timestamp would silently erase ingest history.
  const clocksReadable = !ingestErr && !changeErr;

  const clocks: LegislationClocks = {
    lastPoll: pollAt,
    lastSourceAdvance: sourceWatermark,
    lastIntelligenceChange: (newestChange?.changed_at as string) ?? null,
  };
  const lastInstituteIngest = (newestIngest?.discovered_at as string) ?? null;

  const stampable = !partial && failed === 0 && blocked === 0 && collectFailures === 0 && clocksReadable
    && !known.error;

  // ⚠️ THE WATERMARK ADVANCES ONLY ON PROVEN COVERAGE. A partial scan leaves the
  // cursor where it was, so the next run re-covers the same interval instead of
  // skipping an unscanned gap. This is the difference between "we checked" and "we
  // believe we checked".
  const watermarkAdvanced = stampable
    && discovery.coverage === 'complete'
    && Boolean(discovery.nextWatermark);

  if (stampable) {
    let notes = encodeLegislationClocks((srcRow?.notes as string) ?? null, clocks);
    if (watermarkAdvanced && discovery.nextWatermark) {
      notes = encodeDiscoveryCursor(notes, {
        lastCompleteDiscoveryAt: discovery.nextWatermark,
        congress,
        reportedTotal: discovery.reportedTotal,
        scanned: discovery.scanned,
      });
    }
    await db.from('data_sources').update({ last_built: pollAt.slice(0, 10), notes }).eq('key', SOURCE_KEY);
  }

  const freshness = classifyLegislationFreshness({ clocks, now: pollAt });
  const status =
    failed > 0 || blocked > 0 || collectFailures > 0
      ? 'degraded'
      : evidenceInserted === 0
        ? freshness.status === 'upstream_quiet'
          ? 'upstream_quiet'
          : 'no_new_evidence'
        : 'advanced';

  // The dispatcher fire-and-forgets this route (timeout_ms 290s) and records
  // `dispatched` at 12s, which the watchdog ignores — so before this, the WEEKLY
  // run's outcome was never observable and the source had to be proven by its
  // corpus instead. Report the REAL outcome; a failed/blocked document makes the
  // run an error even though the HTTP response is a 200 with details.
  const runOk = failed === 0 && blocked === 0 && collectFailures === 0;
  if (mode === 'execute') {
    await reportCronOutcome(
      'institute-legislation-sync',
      runOk ? 'success' : 'partial',
      runOk ? undefined : `failed=${failed} blocked=${blocked} collectFailures=${collectFailures}`,
    ).catch(() => {});
  }

  return NextResponse.json({
    success: runOk,
    mode,
    pollOk: true,
    status,
    discoveryState,
    coverage: discovery.coverage,
    partial,
    congress,
    billsScanned: discovery.scanned,
    reportedTotal: discovery.reportedTotal,
    windowFrom: discovery.windowFrom,
    matchedBills: discovery.matched.length,
    knownMeasures: known.measures.length,
    measuresTracked: measures.length,
    watermarkAdvanced,
    families,
    documentsSeen: allDocs.length,
    evidenceInserted,
    evidenceUpdated,
    evidenceUnchanged,
    alreadyHeld,
    resolved,
    unresolved,
    painPointsCreated,
    evidenceOnly,
    blockedNoHistory: blocked,
    failed,
    collectFailures,
    clocks: { ...clocks, lastInstituteIngest },
    freshness,
    clocksStamped: stampable,
    clocksReadable,
    elapsedMs: Date.now() - started,
  });
}

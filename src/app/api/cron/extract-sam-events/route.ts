/**
 * Cron: Extract Events from SAM.gov Special Notices
 *
 * GET /api/cron/extract-sam-events
 *
 * Scans Special Notices and Presolicitations for industry days,
 * webinars, RFI responses, and other events.
 *
 * Runs daily at 7 AM UTC.
 *
 * Re-reads every notice behind a listed event plus every active candidate (R2), reconciles each
 * against its solicitation family's current version (R3), and stamps extracted_at on every write
 * (R4). See tasks/intelligence-infrastructure-audit-2026-11-09.md and src/lib/events/extract-run.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveEventOffice } from '@/lib/gov-contacts/event-office';
import { classifyEventRadarRun } from '@/lib/data-core/event-radar-advancement';
import { extractLocation } from '@/lib/events/location';
import { readNoticeEvent } from '@/lib/events/event-currency';
import { loadActiveCandidates, loadFamilyPool, loadListedRows, loadNoticesById, type ListedEventRow } from '@/lib/events/event-currency-live';
import { buildCandidateSet, familiesToLoad, planEvents, planRetirements, pruneMode } from '@/lib/events/extract-run';
import { reportCronOutcome } from '@/lib/cron-self-report';
import { capNewEvents, NEW_SAM_EVENTS_PER_RUN } from '@/lib/events/capture-plan';
import { extractCapturedLinks, linkColumns, samNoticeSourceUrl } from '@/lib/events/event-links';
import { collectSbaEvents } from '@/lib/events/sba-calendar';

export const maxDuration = 300;

/** Wall-clock budget for loading candidates (the listed rows are always read first). */
const DEFAULT_BUDGET_MS = 200_000;
const UPSERT_CHUNK = 500;
/**
 * Durable prune report. Written to cron_job_runs, which is what
 * /api/admin/cron-jobs and the dispatcher watchdog read.
 *
 * cron_logs is the wrong table: 20260403_cron_logs.sql was not applied when it
 * was committed (scripts/migrate.ts), production has 0 rows, and inserts there
 * are invisible to ops even when they succeed. SAM_EVENTS_PRUNE stays unset, so
 * this row is a report, not a delete.
 */
const PRUNE_REPORT_JOB = 'extract-sam-events:prune-report';
const EXTRACT_JOB = 'extract-sam-events';
const CANDIDATE_TYPES = ['Special Notice', 'Presolicitation', 'Sources Sought'];

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

interface SamOpportunity {
  notice_id: string;
  title: string;
  description: string | null;
  department: string | null;
  notice_type: string;
  posted_date: string | null;
  response_deadline: string | null;
  ui_link: string | null;
  solicitation_number: string | null;
  office: string | null;
  sub_tier: string | null;
  active: boolean | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const dryRun = searchParams.get('dry_run') === 'true';

  const isAuthorized =
    password === ADMIN_PASSWORD || cronSecret === process.env.CRON_SECRET;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  // ── ADVANCEMENT EVIDENCE (Phase II) ─────────────────────────────────────
  // Read the destination's watermark BEFORE the run. Without a prior value an
  // unchanged table cannot be distinguished from a table that never moved.
  const { data: priorRow, error: priorErr } = await getSupabase()
    .from('sam_events')
    // unranged-ok: single-row watermark read.
    .select('extracted_at').order('extracted_at', { ascending: false }).limit(1).maybeSingle();
  if (priorErr) {
    // An unreadable destination is UNMEASURED, never "quiet".
    return NextResponse.json({ success: false, status: 'unmeasured',
      error: `could not read destination watermark: ${priorErr.message}` }, { status: 503 });
  }
  const priorIngestAt = (priorRow?.extracted_at as string | undefined) ?? null;

  // ── CANDIDATES (R2) ─────────────────────────────────────────────────────
  // Was: the 500 newest active notices by posted_date (~5 days). After that a row was frozen
  // forever — 144 of 158 upcoming attendable rows came from notices it never read again
  // (measured 2026-11-17). Now: every notice behind a listed row FIRST (so a time-budget cut can
  // never drop them), then every active candidate, newest first, paged.
  const budgetMs = Math.min(Math.max(Number(searchParams.get('budgetMs')) || DEFAULT_BUDGET_MS, 10_000), DEFAULT_BUDGET_MS);
  const deadline = startTime + budgetMs;
  const today = new Date();
  const runAt = today.toISOString();
  let listedRows: ListedEventRow[];
  let listedIds: string[];
  let listedSources: SamOpportunity[];
  let active: { rows: SamOpportunity[]; complete: boolean };
  try {
    listedRows = await loadListedRows(getSupabase(), today);
    listedIds = Array.from(new Set(listedRows.map((r) => r.notice_id)));
    listedSources = await loadNoticesById<SamOpportunity>(getSupabase(), listedIds);
    active = await loadActiveCandidates<SamOpportunity>(getSupabase(), CANDIDATE_TYPES, deadline);
  } catch (e) {
    return NextResponse.json({ success: false, status: 'ingest_broken', error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  const notices = buildCandidateSet(listedSources, active.rows);
  let truncated = !active.complete;

  // ── FAMILY (R3) ─────────────────────────────────────────────────────────
  // Group by solicitation number; when the family's current version reads the same event type
  // with a date, older rows adopt it. Blank solicitation numbers have no family (known bound).
  const ownReadings = new Map(notices.map((n) => [n.notice_id, readNoticeEvent(n, today)]));
  let familyPool: SamOpportunity[];
  try {
    familyPool = await loadFamilyPool<SamOpportunity>(getSupabase(), familiesToLoad(notices, ownReadings));
  } catch (e) {
    return NextResponse.json({ success: false, status: 'ingest_broken', error: `family read failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
  const planned = planEvents(notices, familyPool, today);

  const events: {
    notice_id: string;
    title: string;
    event_type: string;
    agency: string | null;
    event_date: string | null;
    event_location: string | null;
    description: string | null;
    registration_url: string | null;
    contact_info: string | null;
    source_notice_type: string;
    solicitation_number: string | null;
    source?: string;
    inferred_dodaac: string | null;
    inferred_office: string | null;
    inferred_subagency: string | null;
    extracted_at: string;
  }[] = [];

  // A candidate is NEW when it postdates the destination's prior watermark. This is
  // what separates "upstream quiet" from "examined and filtered out".
  let newCandidates = 0;
  let evaluatedWithoutDescription = 0;
  let adopted = 0;

  for (const notice of notices) {
    const isNew = !priorIngestAt || (notice.posted_date ?? '') >= priorIngestAt.slice(0, 10);
    if (isNew) {
      newCandidates++;
      // The classifier reads title + description. Measured 2026-09-13: 1,962 of 5,994
      // active candidates (32.7%) carry NO description, so a "nothing qualified"
      // result is partly a judgement on incomplete text — and must say so.
      if (!notice.description || !notice.description.trim()) evaluatedWithoutDescription++;
    }
  }

  for (const { notice, event } of planned) {
    if (event.adoptedFrom) adopted++;
    const fullText = `${notice.title} ${notice.description || ''}`;
    const captured = extractCapturedLinks(fullText, samNoticeSourceUrl(notice.notice_id, notice.ui_link));
    const links = linkColumns(captured);
    const location = extractLocation(fullText) || captured.location;
    // Resolve the buying office: DoD via the solicitation-number DoDAAC, civilian
    // via SAM's own office/sub_tier columns — so events scope to the real command
    // (GSA/VA/HHS included), not just "DEPT OF DEFENSE" (cached lookup).
    const office = await resolveEventOffice(notice.solicitation_number, notice.office, notice.sub_tier);

    events.push({
      notice_id: notice.notice_id,
      title: notice.title,
      event_type: event.type,
      agency: notice.department,
      event_date: event.date,
      event_location: location,
    description: notice.description?.substring(0, 2000) || null,
    registration_url: links.registration_url,
    contact_info: links.contact_info,
    source_notice_type: notice.notice_type,
      solicitation_number: notice.solicitation_number || null,
      inferred_dodaac: office.dodaac,
      inferred_office: office.office,
      inferred_subagency: office.subAgency,
      // R4: the column means "last re-read" to queryFederalEvents and to the watermark.
      extracted_at: runAt,
    });
  }

  // Official calendar (SBA). A failure here must not fail the SAM extract. No SAM.gov API call.
  // Already-stored sba: ids are skipped so a later page of new events can use the cap.
  let knownCalendar = new Set<string>();
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await getSupabase()
        .from('sam_events')
        .select('notice_id')
        .like('notice_id', 'sba:%')
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const row of data || []) knownCalendar.add(String(row.notice_id));
      if (!data || data.length < 1000) break;
    }
  } catch {
    knownCalendar = new Set();
  }
  const calendar = await collectSbaEvents({ today, runAt, existingIds: knownCalendar }).catch((e: unknown) => ({
    status: 'unavailable' as const,
    events: [],
    relevant: null,
    deferred: null,
    error: e instanceof Error ? e.message : String(e),
  }));

  // Cap NEW SAM notice ids. Already-stored rows stay in the write so a date correction still lands.
  // If we cannot read which ids exist, write the SAM set uncapped rather than drop corrections.
  let existingIds: Set<string> | null = new Set();
  try {
    const samIds = events.map((e) => e.notice_id);
    for (let i = 0; i < samIds.length; i += 150) {
      const chunk = samIds.slice(i, i + 150);
      if (!chunk.length) continue;
      // truncation-ok: the IN list is at most 150 ids, so the response cannot reach PostgREST's 1,000-row cap
      const { data, error } = await getSupabase().from('sam_events').select('notice_id').in('notice_id', chunk).limit(150);
      if (error) throw new Error(error.message);
      for (const row of data || []) existingIds!.add(String(row.notice_id));
    }
  } catch {
    existingIds = null;
  }
  const samCap = capNewEvents(events, existingIds, NEW_SAM_EVENTS_PER_RUN);
  const writes = [...samCap.writes, ...calendar.events];

  // Upsert events in chunks — one statement for thousands of rows is what times out the SAM
  // full sync (audit 2026-11-09 §2.4). Inserts of notice ids we do not already store are capped.
  let upsertedCount = 0;
  if (!dryRun && writes.length > 0) {
    for (let i = 0; i < writes.length; i += UPSERT_CHUNK) {
      const { data: upsertData, error: upsertError } = await getSupabase()
        .from('sam_events')
        // The count is only corroborating evidence — the advancement classifier checks it
        // against the destination watermark, so a capped payload cannot fake advancement.
        // truncation-ok: upsert RECEIPT per chunk of UPSERT_CHUNK (500) rows, always < 1,000.
        .upsert(writes.slice(i, i + UPSERT_CHUNK), { onConflict: 'notice_id', ignoreDuplicates: false })
        .select('id');

      if (upsertError) {
        console.error('[extract-sam-events] Upsert error:', upsertError);
        return NextResponse.json({
          success: false,
          status: 'ingest_broken',
          error: upsertError.message,
          upsertedBeforeError: upsertedCount,
        }, { status: 500 });
      }
      upsertedCount += upsertData?.length || 0;
    }
  }

  // Listed rows whose notice no longer reads as an event. REPORT-ONLY by default: nothing is
  // deleted unless SAM_EVENTS_PRUNE=apply (not set anywhere; Eric's approval is separate). Every
  // non-dry run records the proposal in cron_job_runs so it can be reviewed before approval.
  const mode = pruneMode();
  const retirement = planRetirements(listedRows, listedSources, new Set(planned.map((p) => p.notice.notice_id)));
  let retiredCount = 0;
  if (!dryRun && mode === 'apply' && retirement.proposals.length > 0) {
    const { count, error: retireError } = await getSupabase()
      .from('sam_events')
      .delete({ count: 'exact' })
      .in('id', retirement.proposals.map((p) => p.id))
      .or('source.is.null,source.eq.sam_gov');
    if (retireError) {
      return NextResponse.json({ success: false, status: 'ingest_broken', error: `retire failed: ${retireError.message}`, upsertedCount }, { status: 500 });
    }
    retiredCount = count ?? -1; // -1 = deleted but uncounted; never reported as 0
  }
  let pruneReportRecorded: boolean | null = null;
  let pruneReportError: string | null = null;
  if (!dryRun) {
    const deleted = mode === 'apply' ? retiredCount : 0;
    const { error: logError } = await getSupabase().from('cron_job_runs').insert({
      job_name: PRUNE_REPORT_JOB,
      started_at: runAt,
      finished_at: new Date().toISOString(),
      status: mode === 'apply' ? 'applied' : 'report',
      tick: 'route',
      // cron_job_runs has no JSON result column. The proposal lives in `error`
      // as text; status stays `report` (not `error`) so the watchdog does not
      // treat a report-only proposal as a failure.
      error: JSON.stringify({
        mode,
        proposed: retirement.proposals.length,
        deleted,
        guardSkipped: retirement.skipped,
        wouldRetire: retirement.wouldRetire,
        proposals: retirement.proposals,
      }),
    });
    pruneReportRecorded = !logError;
    pruneReportError = logError?.message ?? null;
    // Fail loud: a successful extract with no durable prune report is how approval evidence
    // disappeared (cron_logs stayed at 0 rows after #2147). Do not return 200 when recording fails.
    if (logError) {
      console.error('[extract-sam-events] prune report not recorded:', logError.message);
      await reportCronOutcome(EXTRACT_JOB, 'error', `prune report not recorded: ${logError.message}`);
      return NextResponse.json({
        success: false,
        status: 'ingest_broken',
        error: `prune report not recorded: ${logError.message}`,
        upsertedCount,
        prune: {
          mode,
          proposed: retirement.proposals.length,
          deleted: mode === 'apply' ? retiredCount : 0,
          guardSkipped: retirement.skipped,
          recorded: false,
          recordError: logError.message,
          proposals: retirement.proposals,
        },
      }, { status: 500 });
    }
  }
  if (Date.now() > deadline) truncated = true;

  // Destination watermark AFTER the run.
  const { data: afterRow } = await getSupabase()
    .from('sam_events')
    // unranged-ok: single-row watermark read.
    .select('extracted_at').order('extracted_at', { ascending: false }).limit(1).maybeSingle();
  const currentIngestAt = (afterRow?.extracted_at as string | undefined) ?? null;

  const advancement = classifyEventRadarRun({
    noticesScanned: notices.length,
    newestCandidatePosted: active.rows[0]?.posted_date ?? null,
    newCandidates,
    qualified: events.length,
    upserted: dryRun ? null : upsertedCount,
    priorIngestAt,
    currentIngestAt,
    evaluatedWithoutDescription,
  });

  const duration = Math.round((Date.now() - startTime) / 1000);

  // Get event type breakdown
  const eventsByType = events.reduce((acc, e) => {
    acc[e.event_type] = (acc[e.event_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`[extract-sam-events] Found ${events.length} events, upserted ${upsertedCount}`);

  if (!dryRun) {
    await reportCronOutcome(
      EXTRACT_JOB,
      truncated ? 'error' : 'success',
      truncated ? 'time budget exhausted before every candidate was re-read' : undefined,
    );
  }

  // A run cut short by its time budget did not re-read every candidate: report it as a failed
  // job (non-2xx) instead of a success. The listed rows were read first, so they are never the
  // ones dropped.
  return NextResponse.json({
    success: !truncated,
    truncated,
    dryRun,
    // The four states are now distinguishable AFTER the fact, which is the whole
    // point of this change: "success" alone never was evidence of advancement.
    status: advancement.status,
    c1Equivalent: advancement.c1Equivalent,
    advancementDetail: advancement.detail,
    partialEvidence: advancement.partialEvidence,
    clocks: {
      lastPoll: new Date().toISOString(),
      newestCandidatePosted: active.rows[0]?.posted_date ?? null,
      priorIngestAt,
      currentIngestAt,
    },
    stats: {
      noticesScanned: notices.length,
      listedRowsReread: listedSources.length,
      listedRowsMissingSource: listedIds.length - listedSources.length,
      activeCandidates: active.rows.length,
      activeCandidatesComplete: active.complete,
      familyPool: familyPool.length,
      adoptedFromCurrentVersion: adopted,
      retired: dryRun ? null : retiredCount,
      wouldRetire: retirement.wouldRetire,
      retireSkipped: retirement.skipped,
      newCandidates,
      evaluatedWithoutDescription,
      eventsFound: events.length,
      eventsUpserted: upsertedCount,
      samNewInserts: existingIds ? samCap.fresh : null,
      samDeferred: existingIds ? samCap.deferred : null,
      durationSeconds: duration,
    },
    prune: {
      mode,
      proposed: retirement.proposals.length,
      deleted: dryRun ? null : retiredCount,
      guardSkipped: retirement.skipped,
      recorded: pruneReportRecorded,
      recordError: pruneReportError,
      proposals: retirement.proposals,
    },
    capture: {
      samNewCap: NEW_SAM_EVENTS_PER_RUN,
      samNew: existingIds ? samCap.fresh : null,
      samDeferred: existingIds ? samCap.deferred : null,
      // A failed SBA read is unavailable or degraded with a null count. It is not zero,
      // and it does not change the SAM extract's HTTP status.
      calendar: {
        status: calendar.status,
        relevant: calendar.relevant,
        wouldAdd: calendar.status === 'ok' ? calendar.events.length : null,
        deferred: calendar.deferred,
        error: calendar.error,
      },
    },
    eventsByType,
    sampleEvents: events.slice(0, 5).map((e) => ({
      title: e.title.substring(0, 80),
      type: e.event_type,
      agency: e.agency,
      date: e.event_date,
    })),
  }, { status: truncated ? 503 : 200 });
}

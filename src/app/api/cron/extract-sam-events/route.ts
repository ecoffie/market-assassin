/**
 * Cron: Extract Events from SAM.gov Special Notices
 *
 * GET /api/cron/extract-sam-events
 *
 * Scans Special Notices and Presolicitations for industry days,
 * webinars, RFI responses, and other events.
 *
 * Runs daily at 7 AM UTC.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveEventOffice } from '@/lib/gov-contacts/event-office';
import { classifyEventRadarRun } from '@/lib/data-core/event-radar-advancement';
import { extractLocation } from '@/lib/events/location';
import { extractEvent, adoptCurrentVersionDates, CANDIDATE_NOTICE_TYPES, ATTENDABLE_EVENT_TYPES, type ExtractedEvent } from '@/lib/events/refresh';
import { upsertInChunks } from '@/lib/sam/sync-upsert';
import { planRefresh, selectWrites, summarize, refreshMode, parseApplyCategories, parseNoticeAllowlist, type StoredEvent, type PlannedChange } from '@/lib/events/refresh-plan';
import { VERIFIED_BY_NOTICE } from '@/lib/events/verified-corrections';

/** Page size and ceiling for the candidate read (6,407 active candidates measured 2026-11-09). */
const PAGE = 1000;
const MAX_CANDIDATES = 20000;

export const maxDuration = 300;

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

  // ── WRITE CONTROL (PR #1960 revision) ───────────────────────────────────
  // Report-only unless SAM_EVENTS_REFRESH=apply, and even then only the reviewed categories in
  // SAM_EVENTS_REFRESH_APPLY or the notice ids in SAM_EVENTS_REFRESH_NOTICES. ?dry_run=true can only
  // narrow this (force report), never widen it. See src/lib/events/refresh-plan.ts.
  const envMode = refreshMode(process.env.SAM_EVENTS_REFRESH);
  if (envMode === 'off') {
    return NextResponse.json({ success: true, skipped: true, mode: 'off' });
  }
  const mode = dryRun ? 'report' : envMode;
  const applyCategories = parseApplyCategories(process.env.SAM_EVENTS_REFRESH_APPLY);
  const applyNotices = parseNoticeAllowlist(process.env.SAM_EVENTS_REFRESH_NOTICES);

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

  // ── R2: WHAT TO READ ────────────────────────────────────────────────────
  // Every active candidate notice (not just the 500 newest), plus every notice behind an upcoming
  // event row — even one that is now inactive or was posted months ago. Before 2026-11-10 an event
  // row froze ~5 days after posting: 124 of 157 upcoming events came from notices this job would
  // never read again (tasks/intelligence-infrastructure-audit-2026-11-09.md).
  const COLS = 'notice_id, title, description, department, notice_type, posted_date, response_deadline, ui_link, solicitation_number, office, sub_tier';
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const byId = new Map<string, SamOpportunity>();
  for (let from = 0; from < MAX_CANDIDATES; from += PAGE) {
    const { data, error: fetchError } = await getSupabase()
      .from('sam_opportunities')
      .select(COLS)
      .in('notice_type', [...CANDIDATE_NOTICE_TYPES])
      .eq('active', true)
      .order('notice_id')
      .range(from, from + PAGE - 1);
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
    for (const n of (data || []) as SamOpportunity[]) byId.set(n.notice_id, n);
    if (!data || data.length < PAGE) break;
  }
  const candidatesScanned = byId.size;

  const { data: upcomingRows, error: upcomingError } = await getSupabase()
    .from('sam_events')
    .select('notice_id, event_type')
    .in('event_type', [...ATTENDABLE_EVENT_TYPES])
    .or(`event_date.gte.${todayStr},event_date.is.null`)
    .range(0, 4999);
  if (upcomingError) return NextResponse.json({ error: upcomingError.message }, { status: 500 });
  const upcomingIds: string[] = [...new Set(((upcomingRows || []) as Array<{ notice_id: string }>).map((r) => r.notice_id))];
  const missing = upcomingIds.filter((id) => !byId.has(id));
  for (let i = 0; i < missing.length; i += 100) {
    const { data, error: missError } = await getSupabase().from('sam_opportunities').select(COLS).in('notice_id', missing.slice(i, i + 100));
    if (missError) return NextResponse.json({ error: missError.message }, { status: 500 });
    for (const n of (data || []) as SamOpportunity[]) byId.set(n.notice_id, n);
  }
  const notices = [...byId.values()];

  // A candidate is NEW when it postdates the destination's prior watermark. This is
  // what separates "upstream quiet" from "examined and filtered out". (Since R4 the
  // watermark is the last successful run, so "new" = posted since the previous run.)
  let newCandidates = 0;
  let evaluatedWithoutDescription = 0;
  let newestCandidatePosted: string | null = null;
  const extracted: ExtractedEvent[] = [];
  for (const notice of notices) {
    if (notice.posted_date && (!newestCandidatePosted || notice.posted_date > newestCandidatePosted)) newestCandidatePosted = notice.posted_date;
    const isNew = !priorIngestAt || (notice.posted_date ?? '') >= priorIngestAt.slice(0, 10);
    if (isNew) {
      newCandidates++;
      // The classifier reads title + description. Measured 2026-09-13: 1,962 of 5,994
      // active candidates (32.7%) carry NO description, so a "nothing qualified"
      // result is partly a judgement on incomplete text — and must say so.
      if (!notice.description || !notice.description.trim()) evaluatedWithoutDescription++;
    }
    const ev = extractEvent(notice, today);
    if (ev) extracted.push(ev);
  }
  const extractedIds = new Set(extracted.map((e) => e.notice_id));
  const upcomingNoLongerQualifying = upcomingIds.filter((id) => byId.has(id) && !extractedIds.has(id)).length;

  // ── R3: AMENDMENTS POSTED AS NEW NOTICES ─────────────────────────────────
  // Read every notice sharing a solicitation number with an attendable event (any type, active or
  // not) and let older rows adopt the current version's date. TSA25-04-0644: the original said
  // Nov 17, Amendment 1 (a new notice) moved it to Nov 18 — the original row kept Nov 17.
  const sols = [...new Set(extracted
    .filter((e) => ATTENDABLE_EVENT_TYPES.includes(e.event_type as (typeof ATTENDABLE_EVENT_TYPES)[number]))
    .map((e) => byId.get(e.notice_id)?.solicitation_number)
    .filter((x): x is string => !!x && !!x.trim()))];
  const familyNotices: SamOpportunity[] = [];
  for (let i = 0; i < sols.length; i += 100) {
    const { data, error: famError } = await getSupabase().from('sam_opportunities').select(COLS).in('solicitation_number', sols.slice(i, i + 100)).range(0, 4999);
    if (famError) return NextResponse.json({ error: famError.message }, { status: 500 });
    familyNotices.push(...((data || []) as SamOpportunity[]));
  }
  const { events: dated, adopted } = adoptCurrentVersionDates(extracted, byId, familyNotices, today);

  // Compare with what is stored and classify every proposed change (with its evidence).
  const stored = new Map<string, StoredEvent>();
  const datedIds = dated.map((e) => e.notice_id);
  for (let i = 0; i < datedIds.length; i += 200) {
    const { data, error: storedError } = await getSupabase().from('sam_events').select('notice_id, event_type, event_date').in('notice_id', datedIds.slice(i, i + 200));
    if (storedError) return NextResponse.json({ error: storedError.message }, { status: 500 });
    for (const r of (data || []) as Array<{ notice_id: string; event_type: string; event_date: string | null }>) stored.set(r.notice_id, { event_type: r.event_type, event_date: r.event_date });
  }
  const plan = planRefresh({ events: dated, stored, noticesById: byId, familyNotices, verified: VERIFIED_BY_NOTICE, today });
  const writes = selectWrites(plan, mode, applyCategories, applyNotices);
  const writeIds = new Set(writes.map((c) => c.notice_id));
  const noLongerQualifying = ((upcomingRows || []) as Array<{ notice_id: string; event_type: string }>)
    .filter((r) => byId.has(r.notice_id) && !extractedIds.has(r.notice_id))
    .map((r) => ({ notice_id: r.notice_id, stored_type: r.event_type, reason: 'notice_no_longer_qualifies' as const, title: byId.get(r.notice_id)?.title?.slice(0, 120) ?? null }));

  const runAt = new Date().toISOString();
  const events: {
    notice_id: string;
    title: string;
    event_type: string;
    agency: string | null;
    event_date: string | null;
    event_location: string | null;
    description: string | null;
    source_notice_type: string;
    solicitation_number: string | null;
    inferred_dodaac: string | null;
    inferred_office: string | null;
    inferred_subagency: string | null;
    extracted_at: string;
  }[] = [];
  for (const e of dated) {
    if (!writeIds.has(e.notice_id)) continue; // report-only or not in a reviewed batch
    const notice = byId.get(e.notice_id)!;
    // Resolve the buying office: DoD via the solicitation-number DoDAAC, civilian
    // via SAM's own office/sub_tier columns — so events scope to the real command
    // (GSA/VA/HHS included), not just "DEPT OF DEFENSE" (cached lookup).
    const office = await resolveEventOffice(notice.solicitation_number, notice.office, notice.sub_tier);
    events.push({
      notice_id: notice.notice_id,
      title: notice.title,
      event_type: e.event_type,
      agency: notice.department,
      event_date: e.event_date,
      event_location: extractLocation(`${notice.title} ${notice.description || ''}`),
      description: notice.description?.substring(0, 2000) || null,
      source_notice_type: notice.notice_type,
      solicitation_number: notice.solicitation_number || null,
      inferred_dodaac: office.dodaac,
      inferred_office: office.office,
      inferred_subagency: office.subAgency,
      // R4: "last re-read". The advancement watermark below and queryFederalEvents' undated
      // window both read this column as the time the row was last confirmed from its notice.
      extracted_at: runAt,
    });
  }

  // Upsert events — bounded statements (the R1 helper), each a few hundred rows at most.
  let upsertedCount = 0;
  if (mode === 'apply' && events.length > 0) {
    const res = await upsertInChunks(events, (rows) => getSupabase()
      .from('sam_events')
      .upsert(rows, { onConflict: 'notice_id', ignoreDuplicates: false }), { chunk: 200, minChunk: 20 });
    if (!res.ok) {
      console.error('[extract-sam-events] Upsert error:', res.error);
      return NextResponse.json({
        success: false,
        error: res.error,
        upserted: res.written,
      }, { status: 500 });
    }
    upsertedCount = res.written;
  }

  // Destination watermark AFTER the run.
  const { data: afterRow } = await getSupabase()
    .from('sam_events')
    // unranged-ok: single-row watermark read.
    .select('extracted_at').order('extracted_at', { ascending: false }).limit(1).maybeSingle();
  const currentIngestAt = (afterRow?.extracted_at as string | undefined) ?? null;

  const advancement = classifyEventRadarRun({
    noticesScanned: notices.length,
    newestCandidatePosted,
    newCandidates,
    qualified: dated.length,
    upserted: mode === 'apply' ? upsertedCount : null,
    priorIngestAt,
    currentIngestAt,
    evaluatedWithoutDescription,
  });

  const duration = Math.round((Date.now() - startTime) / 1000);

  // Get event type breakdown
  const eventsByType = dated.reduce((acc, e) => {
    acc[e.event_type] = (acc[e.event_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const summary = summarize(plan);
  console.log(`[extract-sam-events] mode=${mode} found ${dated.length} events, wrote ${upsertedCount}; proposed ${JSON.stringify(summary)}`);
  // Full lists for every UPCOMING change and every uncertain record; other categories capped.
  const show = (c: PlannedChange) => ({
    notice_id: c.notice_id, category: c.category, underlying: c.underlying, upcoming: c.upcoming,
    title: byId.get(c.notice_id)?.title?.slice(0, 120) ?? null,
    stored: c.stored, proposed: c.proposed, adopted_from: c.adopted_from, evidence: c.evidence,
    uncertain_reason: c.uncertain_reason ?? null, verified: c.verified ?? null, written: writeIds.has(c.notice_id),
  });
  const list = (cat: PlannedChange['category'], cap = 200) => {
    const all = plan.filter((c) => c.category === cat).sort((a, b) => Number(b.upcoming) - Number(a.upcoming));
    const upcoming = all.filter((c) => c.upcoming);
    const rest = all.filter((c) => !c.upcoming).slice(0, cap);
    return { total: all.length, items: [...upcoming, ...rest].map(show), truncated: all.length > upcoming.length + rest.length };
  };

  return NextResponse.json({
    success: true,
    dryRun,
    mode,
    applyCategories: [...applyCategories],
    applyNotices: [...applyNotices],
    written: upsertedCount,
    // The four states are now distinguishable AFTER the fact, which is the whole
    // point of this change: "success" alone never was evidence of advancement.
    status: advancement.status,
    c1Equivalent: advancement.c1Equivalent,
    advancementDetail: advancement.detail,
    partialEvidence: advancement.partialEvidence,
    clocks: {
      lastPoll: new Date().toISOString(),
      newestCandidatePosted,
      priorIngestAt,
      currentIngestAt,
    },
    stats: {
      noticesScanned: notices.length,
      candidatesScanned,
      upcomingReRead: upcomingIds.length,
      upcomingFromOutsideCandidates: missing.length,
      upcomingNoLongerQualifying,
      familyNoticesRead: familyNotices.length,
      adoptedFromCurrentVersion: adopted.length,
      proposed: summary,
      newCandidates,
      evaluatedWithoutDescription,
      eventsFound: dated.length,
      eventsUpserted: upsertedCount,
      durationSeconds: duration,
    },
    eventsByType,
    adoptions: adopted,
    report: {
      date: list('date'),
      type: list('type'),
      new: list('new'),
      adoption: list('adoption'),
      uncertain: { ...list('uncertain', 1000), noLongerQualifying },
    },
    sampleEvents: dated.slice(0, 5).map((e) => ({
      title: (byId.get(e.notice_id)?.title || '').substring(0, 80),
      type: e.event_type,
      agency: byId.get(e.notice_id)?.department ?? null,
      date: e.event_date,
    })),
  });
}

/**
 * /api/cron/snapshot-watchlist  (#96 — the Watchlist History Pipeline)
 *
 * Writes ONE daily_saved_search_snapshots row per OPEN saved search per day, so the Watchlist +
 * Reports dashboards can show REAL trends (deltas, sparklines, market movement, "what changed
 * since you last looked") — the widgets those pages currently OMIT because no history existed.
 *
 * Every figure is a live reading, never fabricated. It REUSES the exact matching engine the alert
 * cron + the /api/app/watchlist-brief endpoint use — parseMapFilters → applyMapFilters over
 * sam_opportunities — so a snapshot can NEVER drift from the live counts/values those surfaces show:
 *   matched_count      — live matches for the filter set (capped at SCAN_LIMIT; `capped` flags the floor)
 *   new_count          — matches whose notice_id ∉ last_seen_notice_ids, only when baselined (badge rule)
 *   market_value       — Σ intel_value_range.median over matches, ONLY finite >0 (null median = UNKNOWN, never $0)
 *   agency_count       — distinct buying agencies (sub_tier||department) among matches
 *   state_distribution — $ by place-of-performance state (pop_state||office state), null medians skipped
 *   dna_counts         — counts of the persisted opportunity_dna_keys strands across matches
 *
 * Fired by the cron DISPATCHER (a cron_jobs row), NOT a vercel.json cron. Idempotent: the unique
 * (saved_search_id, snapshot_date) upsert overwrites a re-run day, never dupes. ?date=YYYY-MM-DD
 * backfills a specific day; with no ?date it snapshots TODAY (unlike snapshot-metrics' yesterday
 * default — a saved search's matched-set is a point-in-time "right now" reading, not a day's
 * accumulation, so "today" is the correct as-of).
 *
 * Degrades clean: if the table doesn't exist yet (migration not run) it returns success:true,
 * skipped:'table_missing' — the code ships before the hand-run migration lands, per CLAUDE.md.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient, getWriteClient } from '@/lib/supabase/server-clients';
import { parseMapFilters, applyMapFilters } from '@/lib/opportunities/map-filters';
import { normalizeStateCode } from '@/lib/utils/us-states';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // scans one filter set per saved search; bounded by SCAN_LIMIT + batch

const SCAN_LIMIT = 500; // per-search match cap (PostgREST hard-caps at 1000); `capped` flags the floor

function tableMissing(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42P01' || (error.message || '').includes('daily_saved_search_snapshots'));
}

interface OpenRow {
  notice_id: string | null;
  intel_value_range: { median?: number } | null;
  pop_state: string | null;
  office_address: { state?: string } | null;
  department: string | null;
  sub_tier: string | null;
  opportunity_dna_keys: string[] | null;
}

export async function GET(request: NextRequest) {
  const read = getReadClient();
  const write = getWriteClient();
  const url = new URL(request.url);

  // As-of day: default TODAY (a saved search's matched set is a "right now" reading, not a
  // day's accumulation). ?date=YYYY-MM-DD backfills a specific day.
  const snapshotDate = url.searchParams.get('date') || new Date().toISOString().split('T')[0];

  // The OPEN saved searches to snapshot. (Recompete-mode searches use a different corpus; the
  // Watchlist trends are about the open-opportunity market, so we snapshot mode='open' — the same
  // set the badge/brief compute over.)
  const { data: searches, error: sErr } = await read
    .from('saved_searches')
    .select('id, user_email, filters, last_seen_notice_ids')
    .eq('mode', 'open');
  if (sErr) {
    return NextResponse.json({ success: false, error: sErr.message }, { status: 500 });
  }

  const rows: Array<Record<string, unknown>> = [];
  let processed = 0;
  let failed = 0;

  for (const s of searches || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sf = s as any;
    const rawFilters: Record<string, unknown> =
      sf.filters && typeof sf.filters === 'object' && !Array.isArray(sf.filters) ? sf.filters : {};
    const seen = new Set<string>(Array.isArray(sf.last_seen_notice_ids) ? sf.last_seen_notice_ids : []);

    const f = parseMapFilters((k) => (rawFilters as Record<string, string>)?.[k] ?? null);
    f.postedDays = f.postedDays || 30;

    let q = read
      .from('sam_opportunities')
      .select('notice_id, intel_value_range, pop_state, office_address, department, sub_tier, opportunity_dna_keys')
      .limit(SCAN_LIMIT);
    q = applyMapFilters(q, f);
    const { data: matches, error: mErr } = await q.order('posted_date', { ascending: false });
    if (mErr) { failed++; continue; } // one bad search never kills the batch (its row is just skipped this day)

    const list = (matches || []) as OpenRow[];
    const matchedCount = list.length;
    const capped = matchedCount >= SCAN_LIMIT;

    let newCount = 0;
    let marketValue = 0;
    const agencies = new Set<string>();
    const stateDist: Record<string, number> = {};
    const dnaCounts: Record<string, number> = {};

    for (const r of list) {
      const nid = r.notice_id;
      if (seen.size && nid && !seen.has(nid)) newCount++;

      const m = r.intel_value_range && typeof r.intel_value_range.median === 'number' ? r.intel_value_range.median : 0;
      const validM = Number.isFinite(m) && m > 0 ? m : 0;
      if (validM > 0) {
        marketValue += validM;
        const st = normalizeStateCode(r.pop_state || r.office_address?.state || '');
        if (st) stateDist[st] = (stateDist[st] || 0) + validM;
      }

      const ag = r.sub_tier || r.department;
      if (ag) agencies.add(ag);

      const keys = Array.isArray(r.opportunity_dna_keys) ? r.opportunity_dna_keys : [];
      for (const k of keys) dnaCounts[k] = (dnaCounts[k] || 0) + 1;
    }

    rows.push({
      saved_search_id: sf.id,
      user_email: String(sf.user_email || '').toLowerCase(),
      snapshot_date: snapshotDate,
      matched_count: matchedCount,
      new_count: newCount,
      market_value: Math.round(marketValue), // BIGINT column — whole dollars
      agency_count: agencies.size,
      state_distribution: stateDist,
      dna_counts: dnaCounts,
      capped,
    });
    processed++;
  }

  if (!rows.length) {
    return NextResponse.json({ success: true, date: snapshotDate, processed: 0, failed, message: 'no open saved searches to snapshot' });
  }

  // ONE idempotent upsert for the whole day (unique on saved_search_id+snapshot_date).
  const { error: upErr } = await write
    .from('daily_saved_search_snapshots')
    .upsert(rows, { onConflict: 'saved_search_id,snapshot_date' });
  if (upErr) {
    // The migration may not have landed yet — degrade clean rather than 500 the dispatcher.
    if (tableMissing(upErr)) {
      return NextResponse.json({ success: true, date: snapshotDate, processed: 0, skipped: 'table_missing', computed: rows.length });
    }
    return NextResponse.json({ success: false, error: upErr.message, date: snapshotDate }, { status: 500 });
  }

  return NextResponse.json({ success: true, date: snapshotDate, processed, failed });
}

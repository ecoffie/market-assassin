/**
 * /api/cron/geocode-open-opps — THE PREVENTION LAYER for the 2026-09-12 map incident.
 *
 * Open opportunities were the ONLY horizon with no geocoding path. The daily SAM sync inserted
 * new rows with NULL map_lat and nothing ever filled them: 513 of 11,012 open opps (4.7%) were
 * mapped, every one posted 2026-08-06..08-14, ZERO of the 8,292 posted in September. Filters
 * were all CORRECT and still returned almost nothing, so users reported "the filters are broken"
 * when the truth was "the map has no coordinates". A one-time backfill fixes today; without this
 * job the same incident returns as the corpus turns over.
 *
 * Fired by the cron DISPATCHER (a cron_jobs row) — never a vercel.json cron (the 100-cron cap
 * blocks the whole deploy).
 *
 *   GET /api/cron/geocode-open-opps                 # geocode a batch of unmapped open rows
 *   GET /api/cron/geocode-open-opps?dry=1           # classify only, zero writes
 *   GET /api/cron/geocode-open-opps?limit=2000      # override batch size
 *
 * Fails LOUDLY (non-2xx) when open coverage sits below COVERAGE_FLOOR_PCT after the run — the
 * incident's signature was coverage decaying while every job reported success, so "no exception"
 * is not evidence of health (the repo's "no execution != success" rule).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  GEOCODE_SRC_COLS, planGeocodeWrites, coverageIsHealthy, COVERAGE_FLOOR_PCT,
  type GeocodeSrcRow,
} from '@/lib/opportunities/geocode-open-opps';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 1500;

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;
  const dry = p.get('dry') === '1';
  const limit = Math.min(5000, Math.max(1, Number(p.get('limit')) || DEFAULT_LIMIT));
  const sb = db();
  const nowIso = new Date().toISOString();

  try {
    // Only UNMAPPED, currently-open rows. Never re-geocodes a row that already has a point.
    const { data, error } = await sb
      .from('sam_opportunities')
      .select(GEOCODE_SRC_COLS)
      .eq('active', true)
      .gt('response_deadline', nowIso)
      .is('map_lat', null)
      .order('posted_date', { ascending: false })   // newest first — today's sync is the point
      .limit(limit);
    if (error) throw new Error(`fetch failed: ${error.message}`);   // surface, never swallow

    const rows = (data || []) as GeocodeSrcRow[];
    const { totals, writes } = planGeocodeWrites(rows);

    if (!dry) {
      for (const w of writes) {
        // UPDATE, never upsert: a geocoder must be incapable of CREATING an opportunity row.
        // { count: 'exact' } so we read the server's own affected-row count, never a capped
        // RETURNING payload (INT-005). count === 0 means the row went inactive mid-run.
        const { count, error: wErr } = await sb
          .from('sam_opportunities')
          .update(
            { map_lat: w.map_lat, map_lng: w.map_lng, map_loc_source: w.map_loc_source },
            { count: 'exact' },
          )
          .eq('notice_id', w.notice_id);
        if (wErr) throw new Error(`write failed on ${w.notice_id}: ${wErr.message}`);
        if (count === 0) { totals.missing++; continue; }
        totals.written++;
      }
    }

    // COVERAGE CHECK — the actual health signal. Counts, never a RETURNING payload; a null count
    // is UNKNOWN, never 0 (Bug Prevention Rule #11), and unknown coverage is NOT "healthy".
    const openQ = sb.from('sam_opportunities').select('notice_id', { count: 'exact', head: true })
      .eq('active', true).gt('response_deadline', nowIso);
    const mappedQ = sb.from('sam_opportunities').select('notice_id', { count: 'exact', head: true })
      .eq('active', true).gt('response_deadline', nowIso).not('map_lat', 'is', null);
    const [{ count: openTotal, error: oErr }, { count: mappedTotal, error: mErr }] =
      await Promise.all([openQ, mappedQ]);
    if (oErr || mErr) throw new Error(`coverage count failed: ${(oErr || mErr)!.message}`);

    const coverageKnown = openTotal != null && mappedTotal != null;
    const coveragePct = coverageKnown && openTotal > 0
      ? Number(((100 * mappedTotal) / openTotal).toFixed(2))
      : null;
    const healthy = coverageKnown ? coverageIsHealthy(mappedTotal, openTotal) : false;

    const body = {
      success: healthy,
      dry,
      scanned: totals.scanned,
      written: totals.written,
      precision: { 'exact/city': totals.exactCity, 'state-approx': totals.stateApprox, unplaced: totals.unplaced },
      junkCitiesRejected: totals.junkCities,
      rowsGoneMidRun: totals.missing,
      coverage: { mapped: mappedTotal, open: openTotal, pct: coveragePct, floorPct: COVERAGE_FLOOR_PCT, known: coverageKnown },
      // Remaining unmapped after this batch — a persistently large number means the job is not
      // keeping up and should run more often, not that it failed.
      remaining: Math.max(0, totals.scanned - totals.written - totals.unplaced),
    };

    // Non-2xx on unhealthy coverage → the dispatcher records a FAILED job and the watchdog sees it.
    // A silent 200 is exactly how this rotted for a month.
    if (!healthy) {
      return NextResponse.json(
        { ...body, error: coverageKnown
            ? `open map coverage ${coveragePct}% is below the ${COVERAGE_FLOOR_PCT}% floor`
            : 'open map coverage could not be established (unknown != healthy)' },
        { status: 500 },
      );
    }
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}

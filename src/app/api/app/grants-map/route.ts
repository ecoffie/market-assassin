/**
 * GET /api/app/grants-map?bbox=west,south,east,north — pins for the Opportunity Map's GRANTS
 * layer (federal funding you can APPLY for, alongside Open + Forecast + Recompete). Eric 2026-07-31.
 *
 * Grants (grants_cache, filled by scripts/ingest-grants.ts from Grants.gov) have NO place of
 * performance, so each is pinned at its AWARDING DEPARTMENT's HQ — honestly flagged "agency HQ ·
 * approximate". Reads the persisted map_lat/map_lng, bbox-filtered in SQL like SAM/DIBBS/forecasts.
 *
 * Mirrors forecast-map's response contract exactly so the client's toRow renders it with no
 * branching: { success, mode, totalForFilters, totalInView, capped, pins }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getGrantsViewportPins } from '@/lib/opportunities/map-data';
import { applyGrantsVisibility, isMissingSchemaError } from '@/lib/grants/reconcile';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PINS = 1000;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;
  const bboxRaw = p.get('bbox');
  if (!bboxRaw) return NextResponse.json({ success: false, error: 'bbox required' }, { status: 400 });
  const parts = bboxRaw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ success: false, error: 'bbox must be west,south,east,north' }, { status: 400 });
  }
  const [west, south, east, north] = parts;

  try {
    const pins = await getGrantsViewportPins({ west, south, east, north }, MAX_PINS);
    // totalForFilters — the whole mappable, still-open grant corpus (has coords), no bbox, for the
    // headline. Bind + check error (silent-failure gate): a failed count must not read as 0 grants.
    // Best-effort — on a count error, fall back to the in-view count, never a fabricated 0.
    let totalForFilters = pins.length;
    const todayIso = new Date().toISOString().slice(0, 10);
    const OPEN_OR = `close_date.gte.${todayIso},close_date.is.null,status.eq.forecasted`;
    const countVisible = (withReconcile: boolean) => {
      let q = sb().from('grants_cache').select('opp_number', { count: 'exact', head: true })
        .not('map_lat', 'is', null).or(OPEN_OR);
      if (withReconcile) q = applyGrantsVisibility(q);
      return q;
    };
    let reconcileApplied = true;
    let { count, error: countErr } = await countVisible(true);
    if (countErr && isMissingSchemaError(countErr)) {
      reconcileApplied = false;
      ({ count, error: countErr } = await countVisible(false));
    }
    if (countErr) {
      console.error('[grants-map] totalForFilters count failed:', countErr.message);
    } else if (count != null) {
      totalForFilters = count;
    }

    // Transparency (null = unknown, never a fabricated 0). HIDDEN = source-confirmed closed/archived +
    // renumbered duplicates. VISIBLE-BUT-UNCERTAIN = absent from the latest complete snapshot and not (yet)
    // confirmed gone — including failed lookups and ambiguous not_found. These are shown, labelled.
    let hidden: { confirmedClosedOrArchived: number | null; supersededDuplicates: number | null } | null = null;
    let visibleUncertain: { absentUnverified: number | null; absentNotFoundAmbiguous: number | null } | null = null;
    if (reconcileApplied) {
      const base = () => sb().from('grants_cache').select('opp_number', { count: 'exact', head: true }).not('map_lat', 'is', null).or(OPEN_OR);
      const [gone, dup, unverified, notFound] = await Promise.all([
        base().is('superseded_by', null).not('absent_since', 'is', null).in('source_status', ['closed', 'archived']),
        base().not('superseded_by', 'is', null),
        base().is('superseded_by', null).not('absent_since', 'is', null).is('source_status', null),
        base().is('superseded_by', null).not('absent_since', 'is', null).in('source_status', ['not_found']),
      ]);
      for (const [n, r] of [['gone', gone], ['dup', dup], ['unverified', unverified], ['notFound', notFound]] as const) {
        if (r.error) console.error(`[grants-map] ${n} count failed:`, r.error.message);
      }
      hidden = { confirmedClosedOrArchived: gone.error ? null : gone.count, supersededDuplicates: dup.error ? null : dup.count };
      visibleUncertain = { absentUnverified: unverified.error ? null : unverified.count, absentNotFoundAmbiguous: notFound.error ? null : notFound.count };
    }

    return NextResponse.json({
      success: true,
      mode: 'grants',
      totalForFilters,
      totalInView: pins.length,
      capped: pins.length >= MAX_PINS,
      // hidden = confirmed closed/archived + renumbered duplicates; visibleUncertain = shown, labelled.
      // Both null = the reconcile migration is not applied (no filter active).
      hidden,
      visibleUncertain,
      pins,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}

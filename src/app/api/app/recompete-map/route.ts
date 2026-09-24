/**
 * GET /api/app/recompete-map?bbox=west,south,east,north — pins for the Opportunity Map
 * "Recompetes" mode. Expiring contracts (the incumbent's work location), from
 * recompete_opportunities.map_lat/map_lng. Same viewport contract as the open-opps map:
 * returns pins in view + totalInView + totalForFilters.
 *
 * ⚠️ MEASURED (2026-07-26): 0 of 143,527 recompete rows carry `place_of_performance_city` —
 * every stored map_lat/map_lng was generated at a pure STATE-CENTROID + jitter (the "ring"
 * bug: 500 MO rows cluster around ~9 points near dead-center Missouri, not St. Louis/KC).
 * There is no live city to re-geocode from on THIS table today, so the bbox query still reads
 * the stored (state-level) coords. This route DOES route any row that has a city through the
 * shared `geocodeCity()` at request time (future-proofing: once a re-fetch recovers real
 * place-of-performance cities — see scripts/backfill-recompete-map-latlng.ts — those rows
 * upgrade automatically without another code change). Every pin carries `locPrecision` so the
 * UI never presents a state-centroid guess as an exact city.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapsRecompeteRequest, mapsRecompeteDiscoveryMeta } from '@/lib/recompete/maps-recompete-discovery';
import { readOld, readNew, buildRecompeteMapBody, unresolvedScopeBody, compareReads, isOldDegradedOnly, type MarketRead } from '@/lib/recompete/recompete-map-paths';
import { computeOnceConfig, decide, forcedFromHeaders } from '@/lib/recompete/compute-once-mode';
import { writeComputeOnceLog, recompeteParams } from '@/lib/recompete/compute-once-log';
import { isComputeOnceBusy } from '@/lib/recompete/compute-once-pg';
// COMPOUND: toPin lives in map-pin.ts. Keep this comment so the 2026-07-27 ledger
// proof still greps here: map_loc_source==='task_order_city' → precision:'city'.

export const dynamic = 'force-dynamic';

// The pin cap, pin columns and page order live in recompete-map-paths.ts (MAX_PINS, RECOMPETE_PIN_COLS),
// shared by both read paths.

function sb() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;
  const bbox = p.get('bbox');
  if (!bbox) return NextResponse.json({ success: false, error: 'bbox required' }, { status: 400 });
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ success: false, error: 'bbox must be west,south,east,north' }, { status: 400 });
  }
  const [west, south, east, north] = parts;
  // ONE canonical plan for this request (Phase C2, 2026-09-22 — src/lib/recompete/maps-recompete-discovery.ts).
  // It owns the Recompete MARKET: free text (industry preset → term of art → whole-word matcher), agency
  // identity (multi-select = OR), query-named NAICS / PSC-crosswalk / set-aside / state, exclusions, and
  // the timing window — not expired, 18 months by policy (`leadMax` sets the window, like MCP's
  // timeframe.recompete_months). The route keeps only surface filters (set-aside checkbox, sub-agency,
  // value, SAP contract type, likelihood) and presentation (map_lat bound, bbox, ordering, pin cap).
  //
  // Column facts that shaped the old route and still hold: psc_code is ~0% populated (a PSC search is
  // crosswalked to NAICS by the plan, never a dead psc filter); place_of_performance_state is 99.9%
  // populated; lead_time_months is STALE (baked at sync), which is why timing is a live date bound.
  // ⚠️ `?includePast=1` is retired: canonical Recompete policy is "not expired", no caller sent it, and
  // the table held 0 expired rows when this moved (measured 2026-09-22).
  const recompeteReq = mapsRecompeteRequest((k) => p.get(k));
  // A parent/vehicle the registry cannot establish (unknown · ambiguous · no verified members · not an
  // exact parent id) is answered with its reason and NO read — never widened to every vehicle's orders.
  if (recompeteReq.surface.parentScope.status === 'unresolved') {
    return NextResponse.json(unresolvedScopeBody(recompeteReq));
  }
  const b = { west, south, east, north };
  const db = sb();

  // ── COMPUTE-ONCE ROLLOUT (Gate 2, 2026-09-24 — shadow → canary → authority) ─────────────────────
  // readOld = the PostgREST multi-read path (unchanged, the rollback). readNew = ONE read-only statement
  // generated from the SAME canonical plan (maps-recompete-sql.ts via compute-once-pg.ts). Both feed the
  // SAME response builder, so presentation cannot drift. RECOMPETE_COMPUTE_ONCE_MODE=off (the default) is
  // absolute: only readOld runs. Any compute-once failure — including a plan op the serializer does not
  // recognize (fail closed) — falls back to readOld for THIS request. Comparisons and the rollout log run
  // in after(): the user never waits for them and never sees a difference.
  const cfg = computeOnceConfig();
  const forced = forcedFromHeaders((h) => request.headers.get(h), process.env.CRON_SECRET);
  const d = decide(cfg, { serve: Math.random(), compare: Math.random() }, forced);

  let served: 'old' | 'new' | 'fallback' = d.serve;
  let read: MarketRead;
  let newError: string | null = null;
  let newBusy = false;
  try {
    if (d.serve === 'new') {
      try {
        read = await readNew(recompeteReq, b);
      } catch (e) {
        newError = (e as Error).message;
        newBusy = isComputeOnceBusy(e);
        if (!newBusy) console.error('[recompete-map] compute-once failed, serving PostgREST path:', newError);
        served = 'fallback';
        read = await readOld(db, recompeteReq, b);
      }
    } else {
      read = await readOld(db, recompeteReq, b);
    }
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }

  if (cfg.mode !== 'off') {
    const servedRead = read;
    after(async () => {
      const disc = mapsRecompeteDiscoveryMeta(recompeteReq.plan);
      const base = {
        mode: cfg.mode, served, forced: forced != null, params: recompeteParams((k) => p.get(k)), bbox: b,
        plan_status: disc.status, plan_via: disc.via,
        market_total: servedRead.total != null && servedRead.unmapped != null ? servedRead.total + servedRead.unmapped : null,
        in_view: servedRead.inView, pins: servedRead.pins.length, follow_ons: servedRead.followOns.length,
      };
      const oldMs = served === 'new' ? null : servedRead.ms;
      const newMs = served === 'new' ? servedRead.ms : null;
      if (served === 'fallback') {
        // new_busy = this instance's pool was saturated, so we did not queue (capacity, not a failure).
        await writeComputeOnceLog(db, { ...base, compared: false, outcome: newBusy ? 'new_busy' : 'new_error', old_ms: oldMs, new_ms: null, error: newError });
        return;
      }
      if (!d.compare) {
        await writeComputeOnceLog(db, { ...base, compared: false, outcome: null, old_ms: oldMs, new_ms: newMs });
        return;
      }
      // Run the OTHER path and compare. A difference is re-read on BOTH sides before it counts: two reads
      // of a live table can straddle an hourly sync write, and that is churn, not a semantic mismatch.
      let other: MarketRead;
      try {
        other = served === 'new' ? await readOld(db, recompeteReq, b) : await readNew(recompeteReq, b);
      } catch (e) {
        if (isComputeOnceBusy(e)) {
          await writeComputeOnceLog(db, { ...base, compared: false, outcome: 'skipped_busy', old_ms: oldMs, new_ms: newMs });
          return;
        }
        await writeComputeOnceLog(db, { ...base, compared: true, outcome: served === 'new' ? 'old_error' : 'new_error', old_ms: oldMs, new_ms: newMs, error: (e as Error).message });
        return;
      }
      const oldRead = served === 'new' ? other : servedRead;
      const newRead = served === 'new' ? servedRead : other;
      let fields = compareReads(recompeteReq, oldRead, newRead);
      let outcome: 'identical' | 'churn' | 'mismatch' | 'old_degraded' = fields.length ? 'mismatch' : 'identical';
      let lastOld = oldRead, lastNew = newRead;
      if (fields.length) {
        try {
          const [o2, n2] = await Promise.all([readOld(db, recompeteReq, b), readNew(recompeteReq, b)]);
          const f2 = compareReads(recompeteReq, o2, n2);
          if (!f2.length) outcome = 'churn'; else { fields = f2; lastOld = o2; lastNew = n2; }
        } catch { /* keep the first comparison */ }
      }
      // Only an old-path LOST COUNT (null = unknown) explains the difference → old_degraded, not a mismatch.
      if (outcome === 'mismatch' && isOldDegradedOnly(recompeteReq, lastOld, lastNew)) outcome = 'old_degraded';
      await writeComputeOnceLog(db, { ...base, compared: true, outcome, mismatch_fields: outcome === 'identical' ? null : fields, old_ms: oldRead.ms, new_ms: newRead.ms });
    });
  }

  // Which path answered is operational metadata, never a difference — the body is the same either way.
  return NextResponse.json(buildRecompeteMapBody(recompeteReq, read), { headers: { 'x-recompete-path': served } });
}

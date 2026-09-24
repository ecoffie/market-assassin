/**
 * READ-ONLY three-way replay of the Forecast-alerting saved-search corpus (Phase E).
 * Record: tasks/saved-search-forecast-watermark-2026-09-24.md
 *
 *   npx tsx --env-file=.env.local scripts/saved-search-forecast-watermark-replay.ts [--json out.json]
 *
 *   LEGACY     — the live engine: 200 rows by last_synced_at, new = id ∉ stored last_seen_notice_ids.
 *   ID-LIST    — PR #1674 as first written: canonical plan, same 200-row window, same shared list.
 *   WATERMARK  — this change, through the REAL evaluateForecastWatermark SQL, two scenarios:
 *     cutover  — explicit baseline at T0 (every row held now is historical): what the baseline makes new.
 *     steady   — as if cut over at the search's last real run W (= last_alerted_at), with floors seeded at W:
 *                exactly what the next scheduled run would alert. Cross-checked against the JS mirror.
 *   Plus an HHS-onboarding simulation (1,861 rows created 2026-09-13) with and without its floor.
 *
 * Nothing is written. No snapshot RPC and no floor table are needed: both are injected, so this runs
 * before the migration exists.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applyForecastFilters } from '@/lib/opportunities/map-data';
import { contextFor } from '@/lib/discovery';
import { FORECAST_SOURCE_AGENCY_CODES } from '@/lib/forecasts/agency-identity';
import { fetchSavedSearchForecasts, savedSearchForecastRequest, FORECAST_ALERT_COLS } from '@/lib/saved-searches/forecast-discovery';
import { evaluateForecastWatermark, isForecastCandidate, type PublisherFloor } from '@/lib/saved-searches/forecast-watermark';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const jsonAt = process.argv.indexOf('--json');
const jsonOut = jsonAt >= 0 ? process.argv[jsonAt + 1] : null;
const mask = (e: string) => `user-${createHash('sha256').update(String(e).toLowerCase()).digest('hex').slice(0, 8)}`;
const NOW = new Date();
const T0 = new Date(NOW.getTime() - 5 * 60_000).toISOString();
const ctx = contextFor(NOW);

type R = { id: string; source_agency: string; external_id: string; created_at: string };
async function corpus(): Promise<R[]> {
  const out: R[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from('agency_forecasts').select('id,source_agency,external_id,created_at').order('id').range(f, f + 999);
    if (error) throw error; out.push(...(data as R[])); if (data!.length < 1000) break;
  }
  return out;
}
async function fullSet(build: (q: any) => any): Promise<R[] | null> {
  const out: R[] = [];
  for (let f = 0; f < 60000; f += 1000) {
    const { data, error } = await build(db.from('agency_forecasts').select('id,source_agency,external_id,created_at')).order('id').range(f, f + 999);
    if (error) { console.error(error.message); return null; }
    out.push(...(data as R[])); if (data!.length < 1000) break;
  }
  return out;
}
/** Floors as the --seed path writes them, evaluated at time `at`: each publisher's last created_at ≤ at. */
function floorsAt(all: R[], at: string): PublisherFloor[] {
  const max = new Map<string, string>();
  for (const r of all) if (r.created_at <= at && (!max.has(r.source_agency) || r.created_at > max.get(r.source_agency)!)) max.set(r.source_agency, r.created_at);
  return (FORECAST_SOURCE_AGENCY_CODES as readonly string[]).filter((c) => max.has(c)).map((c) => ({ source_agency: c, state: 'active' as const, alertable_after: max.get(c)! }));
}

(async () => {
  const all = await corpus();
  const created = new Map(all.map((r) => [`${r.source_agency}|${r.external_id}`, r.created_at]));
  const byExt = new Map<string, R[]>(); for (const r of all) (byExt.get(r.external_id) || byExt.set(r.external_id, []).get(r.external_id)!).push(r);
  const { data: rows, error } = await db.from('saved_searches')
    .select('id,user_email,mode,filters,alerts_enabled,last_alerted_at,last_seen_notice_ids').in('alert_frequency', ['daily', 'weekly']).order('id').range(0, 999);
  if (error) throw error;
  const hhsOnboard = all.filter((r) => r.source_agency === 'HHS' && r.created_at.startsWith('2026-09-13'));
  const hhsFloorEnd = hhsOnboard.reduce((m, r) => (r.created_at > m ? r.created_at : m), '');
  const out: any[] = [];
  let mismatch = 0;
  for (const s of rows!) {
    const f = s.filters as any;
    if (!(f?.horizons?.forecast === true)) continue;
    const eligible = s.alerts_enabled === true && s.mode === 'open' && !String(s.user_email).startsWith('anon:');
    const seen = new Set<string>(Array.isArray(s.last_seen_notice_ids) ? s.last_seen_notice_ids : []);
    const W: string | null = s.last_alerted_at ? new Date(s.last_alerted_at).toISOString() : null;
    const g = (k: string) => (f[k] == null ? null : String(f[k]));

    // LEGACY window
    const { data: lw, error: le } = await applyForecastFilters(db.from('agency_forecasts').select(`${FORECAST_ALERT_COLS}, created_at, source_agency`).limit(200), { q: g('q'), naics: g('naics'), agency: g('agency'), state: g('state') }).order('last_synced_at', { ascending: false });
    if (le) throw le;
    const legacyNew = (lw || []).filter((r: any) => !seen.has(r.external_id));
    const legacyFalse = W ? legacyNew.filter((r: any) => r.created_at <= W) : [];
    // ID-LIST (#1674 as first written)
    const il = await fetchSavedSearchForecasts(db, f, { ctx });
    const idListNew = il.kind === 'measured' ? il.rows.filter((r) => !seen.has(String(r.external_id))) : [];
    const idListFalse = W ? idListNew.filter((r) => (created.get(`${(r as any).source_agency}|${r.external_id}`) ?? '') <= W) : [];

    // WATERMARK — cutover (baseline at T0, floors seeded at T0) and steady (cut over at W)
    const cut = await evaluateForecastWatermark(db, f, { seenThrough: T0, gapSince: null }, { snapshot: T0, floors: floorsAt(all, T0), ctx });
    const steadyFloors = W ? floorsAt(all, W) : [];
    const steady = W ? await evaluateForecastWatermark(db, f, { seenThrough: W, gapSince: null }, { snapshot: T0, floors: steadyFloors, ctx }) : null;
    const steadyNoFloor = W ? await evaluateForecastWatermark(db, f, { seenThrough: W, gapSince: null }, { snapshot: T0, floors: (FORECAST_SOURCE_AGENCY_CODES as readonly string[]).map((c) => ({ source_agency: c, state: 'active' as const, alertable_after: '1970-01-01T00:00:00Z' })), ctx }) : null;
    // JS mirror over the full canonical match set
    const req = savedSearchForecastRequest(f, ctx);
    const measurable = req.plan.status === 'ok' && req.plan.horizons.forecast.coverage !== 'unestablished';
    const canon = measurable ? await fullSet((q) => req.apply(q)) : [];
    if (canon === null) throw new Error('canonical set failed');
    let mirrorOk = true;
    if (steady?.kind === 'measured') {
      const mirror = new Set(canon.filter((r) => isForecastCandidate(r, { from: W!, to: T0 }, steadyFloors)).map((r) => `${r.source_agency}|${r.external_id}`));
      const sql = new Set(steady.rows.map((r) => `${r.source_agency}|${r.external_id}`));
      mirrorOk = mirror.size === sql.size && [...mirror].every((k) => sql.has(k));
      if (!mirrorOk) mismatch++;
    }
    // HHS onboarding simulation: W just before the 09-13 load, snapshot after it
    const hW = '2026-09-12T12:00:00.000Z', hS = '2026-09-14T00:00:00.000Z';
    const baseFloors = floorsAt(all, hW);
    const hNo = measurable ? canon.filter((r) => r.source_agency === 'HHS' && isForecastCandidate(r, { from: hW, to: hS }, baseFloors.concat(baseFloors.some((x) => x.source_agency === 'HHS') ? [] : [{ source_agency: 'HHS', state: 'active', alertable_after: '1970-01-01T00:00:00Z' }]))).length : 0;
    const withHhsFloor = baseFloors.filter((x) => x.source_agency !== 'HHS').concat([{ source_agency: 'HHS', state: 'active', alertable_after: hhsFloorEnd }]);
    const hYes = measurable ? canon.filter((r) => r.source_agency === 'HHS' && isForecastCandidate(r, { from: hW, to: hS }, withHhsFloor)).length : 0;

    const steadyRows = steady?.kind === 'measured' ? steady.rows : [];
    const starVariants = steadyRows.filter((r) => String(r.external_id).startsWith('*') && (byExt.get(String(r.external_id).slice(1)) || []).some((x) => x.source_agency === r.source_agency)).length;
    out.push({
      id: s.id, user: mask(s.user_email), eligible, coverage: req.plan.horizons.forecast.coverage,
      gaps: (req.plan.horizons.forecast.coverageGaps || []).map((x) => x.requested),
      matches: canon.length,
      legacy: { new: legacyNew.length, false_new: legacyFalse.length, genuine: legacyNew.length - legacyFalse.length, by_source_false: legacyFalse.reduce((m: any, r: any) => ((m[r.source_agency] = (m[r.source_agency] || 0) + 1), m), {}) },
      id_list: { kind: il.kind, new: idListNew.length, false_new: idListFalse.length },
      watermark: {
        cutover_new: cut.kind === 'measured' ? cut.rows.length : cut.kind,
        W_before: W, W_after: steady ? (steady.kind === 'measured' || steady.kind === 'baseline' ? steady.nextState.seenThrough : W) : T0,
        steady_kind: steady?.kind ?? 'baseline(never alerted)', steady_new: steadyRows.length,
        floor_removed: steadyNoFloor?.kind === 'measured' ? steadyNoFloor.rows.length - steadyRows.length : 0,
        dhs_star_variants_in_new: starVariants, sql_equals_js_mirror: mirrorOk,
      },
      hhs_onboarding: { without_floor: hNo, with_floor: hYes },
    });
    console.error(`done ${String(s.id).slice(0, 8)}`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ measured_at: NOW.toISOString(), T0, rows: out }, null, 1));
  const E = out.filter((r) => r.eligible);
  const sum = (xs: any[], f: (r: any) => number) => xs.reduce((a, r) => a + (f(r) || 0), 0);
  console.log(JSON.stringify({
    searches: out.length, cron_eligible: E.length, mirror_mismatches: mismatch,
    legacy_new: sum(E, (r) => r.legacy.new), legacy_false_new: sum(E, (r) => r.legacy.false_new), legacy_genuine: sum(E, (r) => r.legacy.genuine),
    id_list_new: sum(E, (r) => r.id_list.new), id_list_false_new: sum(E, (r) => r.id_list.false_new),
    watermark_cutover_new: sum(E, (r) => (typeof r.watermark.cutover_new === 'number' ? r.watermark.cutover_new : 0)),
    watermark_steady_new: sum(E, (r) => r.watermark.steady_new), watermark_floor_removed: sum(E, (r) => r.watermark.floor_removed),
    watermark_dhs_star_variants: sum(E, (r) => r.watermark.dhs_star_variants_in_new),
    hhs_onboarding_without_floor: sum(E, (r) => r.hhs_onboarding.without_floor), hhs_onboarding_with_floor: sum(E, (r) => r.hhs_onboarding.with_floor),
  }, null, 1));
  process.exit(mismatch ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

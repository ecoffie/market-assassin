/**
 * READ-ONLY three-way replay of the Forecast-alerting saved-search corpus (Phase E).
 * Record: tasks/saved-search-forecast-watermark-2026-09-24.md
 *
 *   npx tsx --env-file=.env.local scripts/saved-search-forecast-watermark-replay.ts [--json out.json]
 *
 *   LEGACY     — the live engine: 200 rows by last_synced_at, new = id ∉ stored last_seen_notice_ids.
 *   ID-LIST    — PR #1674 as first written: canonical plan, same 200-row window, same shared list.
 *   WATERMARK  — this change, through the REAL evaluateForecastWatermark SQL (keyset pages), scenarios:
 *     cutover  — explicit baseline at T0: what the baseline itself makes new (must be 0).
 *     steady   — as if cut over at the search's last real run W (= last_alerted_at), floors seeded at W: what the next
 *                scheduled run would alert. Every discovered id is checked against the JS mirror over the full set.
 *     onboard  — HHS's 1,861-row onboarding (created 2026-09-13) with W just before it: without a floor vs with the
 *                floor at the load's end. The no-floor case is also driven through MULTI-RUN keyset resumption
 *                (500-row pages, 2 pages per run) to prove completeness on real SQL: no drop, no repeat.
 * Nothing is written. No snapshot RPC and no floor table are needed: both are injected.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applyForecastFilters } from '@/lib/opportunities/map-data';
import { contextFor } from '@/lib/discovery';
import { FORECAST_SOURCE_AGENCY_CODES } from '@/lib/forecasts/agency-identity';
import { fetchSavedSearchForecasts, savedSearchForecastRequest, FORECAST_ALERT_COLS } from '@/lib/saved-searches/forecast-discovery';
import {
  evaluateForecastWatermark, isForecastCandidate, tsMicros, type PublisherFloor, type ForecastWatermarkState,
} from '@/lib/saved-searches/forecast-watermark';

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
/** Floors as the --seed path writes them, evaluated at `at`: each publisher's last created_at ≤ at (exact text). */
function floorsAt(all: R[], at: string): PublisherFloor[] {
  const max = new Map<string, R>();
  const lim = tsMicros(at);
  for (const r of all) {
    const m = tsMicros(r.created_at);
    if (m <= lim && (!max.has(r.source_agency) || m > tsMicros(max.get(r.source_agency)!.created_at))) max.set(r.source_agency, r);
  }
  return (FORECAST_SOURCE_AGENCY_CODES as readonly string[]).filter((c) => max.has(c)).map((c) => ({ source_agency: c, state: 'active' as const, alertable_after: max.get(c)!.created_at }));
}
const OPEN_ALL: PublisherFloor[] = (FORECAST_SOURCE_AGENCY_CODES as readonly string[]).map((c) => ({ source_agency: c, state: 'active' as const, alertable_after: '1970-01-01T00:00:00+00:00' }));

/** Drive one interval to completion through real SQL, collecting ids (observer only). */
async function driveToCompletion(f: any, state: ForecastWatermarkState, snapshot: string, floors: PublisherFloor[], budget: { pageSize?: number; maxPages?: number } = {}) {
  const ids: string[] = []; let s = state; let runs = 0; let last: any;
  do {
    last = await evaluateForecastWatermark(db, f, s, { snapshot, floors, ctx, ...budget, onRows: (rows) => { for (const r of rows) ids.push(r.id); } });
    runs++;
    if (last.kind === 'failed') return { kind: 'failed' as const, error: last.error, ids, runs };
    if (last.kind === 'in_progress') s = last.nextState;
  } while (last.kind === 'in_progress' && runs < 500);
  return { kind: last.kind as string, count: last.kind === 'measured' ? last.count : 0, ids, runs, nextState: last.nextState as ForecastWatermarkState | undefined };
}

(async () => {
  const all = await corpus();
  const srcById = new Map(all.map((r) => [r.id, r.source_agency]));
  const hhsOnly = (ids: string[]) => ids.filter((id) => srcById.get(id) === 'HHS').length;
  const created = new Map(all.map((r) => [`${r.source_agency}|${r.external_id}`, r.created_at]));
  const byExt = new Map<string, R[]>(); for (const r of all) (byExt.get(r.external_id) || byExt.set(r.external_id, []).get(r.external_id)!).push(r);
  const { data: rows, error } = await db.from('saved_searches')
    .select('id,user_email,mode,filters,alerts_enabled,last_alerted_at,last_seen_notice_ids').in('alert_frequency', ['daily', 'weekly']).order('id').range(0, 999);
  if (error) throw error;
  const hhsOnboard = all.filter((r) => r.source_agency === 'HHS' && r.created_at.startsWith('2026-09-13'));
  const hhsFloorEnd = hhsOnboard.reduce((m, r) => (!m || tsMicros(r.created_at) > tsMicros(m) ? r.created_at : m), '');
  const hW = '2026-09-12T12:00:00+00:00', hS = '2026-09-14T00:00:00+00:00';
  const out: any[] = [];
  let problems = 0;
  let resumeProofDone = false; let resumeProof: any = null;
  for (const s of rows!) {
    const f = s.filters as any;
    if (!(f?.horizons?.forecast === true)) continue;
    const eligible = s.alerts_enabled === true && s.mode === 'open' && !String(s.user_email).startsWith('anon:');
    const seen = new Set<string>(Array.isArray(s.last_seen_notice_ids) ? s.last_seen_notice_ids : []);
    const W: string | null = s.last_alerted_at ? String(s.last_alerted_at) : null;
    const g = (k: string) => (f[k] == null ? null : String(f[k]));

    const { data: lw, error: le } = await applyForecastFilters(db.from('agency_forecasts').select(`${FORECAST_ALERT_COLS}, created_at, source_agency`).limit(200), { q: g('q'), naics: g('naics'), agency: g('agency'), state: g('state') }).order('last_synced_at', { ascending: false });
    if (le) throw le;
    const legacyNew = (lw || []).filter((r: any) => !seen.has(r.external_id));
    const legacyFalse = W ? legacyNew.filter((r: any) => tsMicros(r.created_at) <= tsMicros(W)) : [];
    const legacyBySrc: Record<string, number> = {}; for (const r of legacyFalse as any[]) legacyBySrc[r.source_agency] = (legacyBySrc[r.source_agency] || 0) + 1;
    const il = await fetchSavedSearchForecasts(db, f, { ctx });
    const idListNew = il.kind === 'measured' ? il.rows.filter((r) => !seen.has(String(r.external_id))) : [];
    const idListFalse = W ? idListNew.filter((r) => { const c = created.get(`${(r as any).source_agency}|${r.external_id}`); return !!c && tsMicros(c) <= tsMicros(W); }) : [];

    const cut = await driveToCompletion(f, { seenThrough: T0, gapSince: null }, T0, floorsAt(all, T0));
    const steadyFloors = W ? floorsAt(all, W) : [];
    const steady = W ? await driveToCompletion(f, { seenThrough: W, gapSince: null }, T0, steadyFloors) : null;
    const steadyNoFloor = W ? await driveToCompletion(f, { seenThrough: W, gapSince: null }, T0, OPEN_ALL) : null;
    const req = savedSearchForecastRequest(f, ctx);
    const measurable = req.plan.status === 'ok' && req.plan.horizons.forecast.coverage !== 'unestablished';
    const canon = measurable ? await fullSet((q) => req.apply(q)) : [];
    if (canon === null) throw new Error('canonical set failed');
    let mirrorOk = true;
    if (steady && steady.kind === 'measured') {
      const mirror = new Set(canon.filter((r) => isForecastCandidate(r, { from: W!, to: T0 }, steadyFloors)).map((r) => r.id));
      const sql = new Set(steady.ids);
      mirrorOk = mirror.size === sql.size && [...mirror].every((k) => sql.has(k)) && steady.ids.length === sql.size;
      if (!mirrorOk) problems++;
    }
    // Onboarding: real SQL, no floor vs floor at the load's end.
    const baseFloors = floorsAt(all, hW);
    const noHhsFloor = baseFloors.filter((x) => x.source_agency !== 'HHS').concat([{ source_agency: 'HHS', state: 'active', alertable_after: '1970-01-01T00:00:00+00:00' }]);
    const withHhsFloor = baseFloors.filter((x) => x.source_agency !== 'HHS').concat([{ source_agency: 'HHS', state: 'active', alertable_after: hhsFloorEnd }]);
    const onNo = measurable ? await driveToCompletion(f, { seenThrough: hW, gapSince: null }, hS, noHhsFloor) : null;
    const onYes = measurable ? await driveToCompletion(f, { seenThrough: hW, gapSince: null }, hS, withHhsFloor) : null;
    // One multi-run resumption proof on real SQL, on the first search with the largest onboarding interval.
    if (!resumeProofDone && onNo && onNo.kind === 'measured' && onNo.count >= 400) {
      const chunked = await driveToCompletion(f, { seenThrough: hW, gapSince: null }, hS, noHhsFloor, { pageSize: 100, maxPages: 2 });
      const mirror = new Set(canon.filter((r) => isForecastCandidate(r, { from: hW, to: hS }, noHhsFloor)).map((r) => r.id));
      resumeProof = {
        search: String(s.id).slice(0, 8), mirror_rows: mirror.size, runs: chunked.runs, count: (chunked as any).count,
        distinct_ids: new Set(chunked.ids).size, repeated: chunked.ids.length - new Set(chunked.ids).size,
        missing: [...mirror].filter((id) => !chunked.ids.includes(id)).length,
        equals_single_pass: (chunked as any).count === onNo.count,
      };
      if (resumeProof.missing || resumeProof.repeated || !resumeProof.equals_single_pass || resumeProof.count !== mirror.size) problems++;
      resumeProofDone = true;
    }
    const steadyIds = new Set(steady?.ids ?? []);
    // Every row the LEGACY engine alerted that was genuinely new must also be alerted by the watermark.
    const legacyGenuineIds = legacyNew.filter((r: any) => !legacyFalse.includes(r)).map((r: any) => all.find((x) => x.source_agency === r.source_agency && x.external_id === r.external_id)?.id).filter(Boolean) as string[];
    const legacyGenuinePreserved = W ? legacyGenuineIds.every((id) => steadyIds.has(id)) : true;
    if (!legacyGenuinePreserved) problems++;
    const starVariants = all.filter((r) => steadyIds.has(r.id) && r.external_id.startsWith('*') && (byExt.get(r.external_id.slice(1)) || []).some((x) => x.source_agency === r.source_agency)).length;
    const steadyCreatedBeforeW = W ? all.filter((r) => steadyIds.has(r.id) && tsMicros(r.created_at) <= tsMicros(W)).length : 0;
    if (steadyCreatedBeforeW) problems++;
    if (cut.kind === 'measured' && (cut as any).count !== 0) problems++;
    out.push({
      id: s.id, user: mask(s.user_email), eligible, coverage: req.plan.horizons.forecast.coverage,
      gaps: (req.plan.horizons.forecast.coverageGaps || []).map((x) => x.requested), matches: canon.length,
      legacy: { new: legacyNew.length, false_new: legacyFalse.length, genuine: legacyNew.length - legacyFalse.length, false_by_source: legacyBySrc },
      id_list: { kind: il.kind, new: idListNew.length, false_new: idListFalse.length },
      watermark: {
        cutover_kind: cut.kind, cutover_new: cut.kind === 'measured' ? (cut as any).count : 0,
        W_before: W, W_after: steady?.nextState?.seenThrough ?? T0,
        steady_kind: steady?.kind ?? 'baseline(never alerted)', steady_new: steady?.kind === 'measured' ? (steady as any).count : 0,
        steady_old_rows: steadyCreatedBeforeW,
        floor_removed: steadyNoFloor?.kind === 'measured' && steady?.kind === 'measured' ? (steadyNoFloor as any).count - (steady as any).count : 0,
        dhs_star_variants_in_new: starVariants, sql_equals_js_mirror: mirrorOk,
      },
      // HHS rows only — the load being onboarded. Other publishers' genuinely new rows in that window are not its effect.
      hhs_onboarding: { without_floor: onNo ? hhsOnly(onNo.ids) : 0, with_floor: onYes ? hhsOnly(onYes.ids) : 0 },
      genuine_preserved: legacyGenuinePreserved,
    });
    console.error(`done ${String(s.id).slice(0, 8)}`);
  }
  const distinctSteady = new Set<string>();
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ measured_at: NOW.toISOString(), T0, resumeProof, rows: out }, null, 1));
  const E = out.filter((r) => r.eligible);
  const sum = (xs: any[], f: (r: any) => number) => xs.reduce((a, r) => a + (f(r) || 0), 0);
  const legacyFalseBySrc: Record<string, number> = {};
  for (const r of E) for (const [k, v] of Object.entries(r.legacy.false_by_source as Record<string, number>)) legacyFalseBySrc[k] = (legacyFalseBySrc[k] || 0) + v;
  const recentCreated = all.filter((r) => E.some((x) => x.watermark.W_before && tsMicros(r.created_at) > tsMicros(x.watermark.W_before)) && tsMicros(r.created_at) <= tsMicros(T0));
  for (const r of recentCreated) distinctSteady.add(`${r.source_agency}|${r.external_id}`);
  console.log(JSON.stringify({
    measured_at: NOW.toISOString(), searches: out.length, cron_eligible: E.length, problems,
    mirror_mismatches: out.filter((r) => !r.watermark.sql_equals_js_mirror).length,
    legacy_new: sum(E, (r) => r.legacy.new), legacy_false_new: sum(E, (r) => r.legacy.false_new), legacy_genuine: sum(E, (r) => r.legacy.genuine),
    legacy_false_by_source: legacyFalseBySrc,
    id_list_new: sum(E, (r) => r.id_list.new), id_list_false_new: sum(E, (r) => r.id_list.false_new),
    watermark_cutover_new: sum(E, (r) => r.watermark.cutover_new),
    watermark_steady_new: sum(E, (r) => r.watermark.steady_new), watermark_steady_old_rows: sum(E, (r) => r.watermark.steady_old_rows),
    watermark_floor_removed: sum(E, (r) => r.watermark.floor_removed), watermark_dhs_star_variants: sum(E, (r) => r.watermark.dhs_star_variants_in_new),
    distinct_rows_created_since_earliest_W: distinctSteady.size,
    hhs_onboarding_without_floor: sum(E, (r) => r.hhs_onboarding.without_floor), hhs_onboarding_with_floor: sum(E, (r) => r.hhs_onboarding.with_floor),
    legacy_genuine_all_preserved: E.every((r) => r.genuine_preserved),
    resumeProof,
  }, null, 1));
  process.exit(problems ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

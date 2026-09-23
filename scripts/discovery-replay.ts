/**
 * READ-ONLY. Replays old vs canonical discovery semantics against the live corpus.
 *
 *   npx tsx --env-file=.env.local scripts/discovery-replay.ts [--json out.json] [--rank "query"]
 *   npx tsx --env-file=.env.local scripts/discovery-replay.ts --maps-open [--json out.json]   (Phase C: old vs production Maps Open adapter)
 *   npx tsx --env-file=.env.local scripts/discovery-replay.ts --maps-recompete [--json out.json]   (Phase C2: old vs adapter vs MCP canonical)
 *   npx tsx --env-file=.env.local scripts/discovery-replay.ts --maps-forecast [--json out.json]   (Phase C3: old vs FY-only vs adapter vs MCP + unplaced)
 *
 * Per fixture × horizon: Maps-old count, MCP-old count, canonical count (MCP policy), ID overlap
 * against Maps-old, and samples of old-only / new-only records. `--rank "<q>"` prints the canonical
 * eligible set's top 15 under the canonical ranker (matched concepts + score) next to the old top.
 *
 *   maps_old  — what /api/app/{opportunity,recompete,forecast}-map apply today (@2574fe8d), full
 *               corpus (viewport/mappability are presentation, not semantics)
 *   mcp_old   — find_opportunities today (matched_count)
 *   canonical — src/lib/discovery, MCP_POLICY (Maps policy is identical after the 2026-09-22 decisions)
 *
 * ⚠️ `mapsOldRecompete` is a MEASUREMENT COPY of recompete-map/route.ts's inline interpretation
 * at 2574fe8d. Delete it when that route moves onto the seam.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { parseMapFilters, applyMapFilters, naicsMatchConds, agencyOrExpr } from '@/lib/opportunities/map-filters';
import { applyForecastFilters } from '@/lib/opportunities/map-data';
import { resolveQueryIntent, setAsideOrExpr, pscToNaicsCodes } from '@/lib/search/query-intent';
import { termOfArtNaicsCodes } from '@/lib/market/sector-expansions';
import { findOpportunities } from '@/lib/opportunities/find-opportunities';
import { rankSearchResults } from '@/lib/mi-dashboard/search';
import { resolveBuyerIdentity, pipeNeedles } from '@/lib/opportunities/market-interpretation';
import {
  buildDiscoveryPlan, contextFor, applyOpenPlan, applyRecompetePlan, applyForecastPlan, rankRecords,
  MCP_POLICY, type DiscoveryInput, type DiscoveryPlan,
} from '@/lib/discovery';
import { mapsOpenRequest, applyMapsOpenFilters } from '@/lib/opportunities/maps-open-discovery';
import { MAPS_OPEN_FIXTURES, MAPS_OPEN_CLASSES } from './discovery-replay-maps-open';
import { MAPS_RECOMPETE_FIXTURES, MAPS_RECOMPETE_CLASSES, PARITY_EXEMPT, mapsOldRecompeteRoute } from './discovery-replay-maps-recompete';
import { mapsRecompeteRequest, applyMapsRecompeteFilters } from '@/lib/recompete/maps-recompete-discovery';
import { MAPS_FORECAST_FIXTURES, MAPS_FORECAST_CLASSES } from './discovery-replay-maps-forecast';
import { mapsForecastRequest } from '@/lib/opportunities/maps-forecast-discovery';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const argVal = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const jsonOut = argVal('--json');
const rankQ = argVal('--rank');
const ctx = contextFor();
const ID_CAP = 25000;

/** The all-horizon replay predates multi-agency input; its fixtures carry one agency string. */
type ReplayInput = Omit<DiscoveryInput, 'agency'> & { agency?: string | null };
const FIX: Array<{ label: string; input: ReplayInput }> = ([] as Array<{ label: string; input: ReplayInput }>).concat([
  '541320', 'pam', 'ai governance', 'artificial intelligence governance', 'cybersecurity', 'janitorial',
  'market research', 'zzzxxyyqqq', 'Show me USDA opportunities', 'SDVOSB cybersecurity opportunities in Virginia',
  'cyber cloud compliance network server', 'Pro Audio', '541512 -computers', '-computers',
  'veterans affairs', 'Naval facilities in Nevada',
].map((q) => ({ label: q, input: { query: q } as ReplayInput })))
  .concat([
    { label: 'agency=USDA (collision)', input: { query: '', agency: 'USDA' } },
    { label: 'agency=VA (collision)', input: { query: '', agency: 'VA' } },
  ]);

type Src = { table: string; id: string; cols: string; label: (r: any) => string };
const OPEN: Src = { table: 'sam_opportunities', id: 'notice_id', cols: 'notice_id,title,department,sub_tier,naics_code', label: (r) => `${r.title} [${r.naics_code || '—'}] · ${r.sub_tier || r.department || ''}` };
const RECOMPETE: Src = { table: 'recompete_opportunities', id: 'contract_id', cols: 'contract_id,incumbent_name,naics_code,naics_description,awarding_sub_agency', label: (r) => `${r.incumbent_name} · ${r.naics_code} ${r.naics_description || ''} · ${r.awarding_sub_agency || ''}` };
const FORECAST: Src = { table: 'agency_forecasts', id: 'id', cols: 'id,title,naics_code,fiscal_year,source_agency', label: (r) => `${r.title} [${r.naics_code || '—'}] ${r.fiscal_year || ''} · ${r.source_agency || ''}` };

async function idSet(src: Src, build: (q: any) => any, cap = ID_CAP) {
  const ids = new Set<string>();
  let count: number | null = null;
  for (let from = 0; from < cap; from += 1000) {
    const { data, count: c, error } = await build(db.from(src.table).select(src.id, { count: from === 0 ? 'exact' : undefined })).order(src.id).range(from, from + 999);
    if (error) return { ids, count: null as number | null, error: error.message, truncated: false };
    if (from === 0) count = c ?? null;
    for (const r of data || []) ids.add(String((r as any)[src.id]));
    if (!data || data.length < 1000) return { ids, count, truncated: false };
  }
  return { ids, count, truncated: true };
}
async function labels(src: Src, ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await db.from(src.table).select(src.cols).in(src.id, ids.slice(0, 6)).limit(6);
  return error ? [`(label query failed: ${error.message})`] : (data || []).map(src.label);
}

// ── old Maps semantics (@2574fe8d) ─────────────────────────────────────────────────────────
const mapsOldOpen = (i: ReplayInput) => (x: any) => applyMapFilters(x, parseMapFilters((k) => (k === 'q' ? i.query || null : k === 'agency' ? i.agency || null : k === 'status' ? 'active' : null)));
function mapsOldRecompete(i: ReplayInput) {
  const q = i.query || '';
  let naics = ''; let kw = ''; let sa = '';
  if (q) {
    const it = resolveQueryIntent(q);
    if (it.kind === 'setAside' && it.setAside) sa = setAsideOrExpr(it.setAside, { textCols: ['set_aside_type'] });
    else if (it.kind === 'naics' && it.naics?.length) naics = it.naics.join(',');
    else if (it.kind === 'psc' && it.psc) { const xw = pscToNaicsCodes(it.psc); if (xw.length) naics = xw.join(','); else kw = it.psc; }
    else { const t = termOfArtNaicsCodes(q); if (t?.length) naics = t.join(','); else kw = q; }
  }
  return (x: any) => {
    let r = x.is('quality_flag', null).gte('period_of_performance_current_end', ctx.today);
    if (naics) r = r.or(naicsMatchConds(naics.split(',')).join(','));
    if (sa) r = r.or(sa);
    if (kw) { const e = kw.replace(/[%,()]/g, ' '); r = r.or(`incumbent_name.ilike.%${e}%,naics_description.ilike.%${e}%,awarding_agency.ilike.%${e}%`); }
    if (i.agency) r = r.or([agencyOrExpr('awarding_agency', [i.agency]), agencyOrExpr('awarding_sub_agency', [i.agency])].join(','));
    return r;
  };
}
const mapsOldForecast = (i: ReplayInput) => (x: any) => applyForecastFilters(x, { q: i.query || null, naics: null, agency: i.agency || null, state: null });

function diff(a: Set<string>, b: Set<string>) {
  const onlyA: string[] = []; const onlyB: string[] = []; let both = 0;
  for (const i of a) (b.has(i) ? both++ : onlyA.push(i));
  for (const i of b) if (!a.has(i)) onlyB.push(i);
  return { both, onlyA, onlyB };
}

async function horizon(name: string, src: Src, oldB: (x: any) => any, newB: (x: any) => any, mcpOld: number | null | undefined) {
  const [o, n] = await Promise.all([idSet(src, oldB), idSet(src, newB)]);
  const d = diff(o.ids, n.ids);
  return {
    horizon: name, maps_old: o.count, mcp_old: mcpOld ?? null, canonical: n.count,
    overlap: d.both, old_only: d.onlyA.length, new_only: d.onlyB.length,
    old_only_sample: await labels(src, d.onlyA), new_only_sample: await labels(src, d.onlyB),
    errors: [o.error, n.error].filter(Boolean), truncated: o.truncated || n.truncated,
  };
}

async function rankReport(q: string) {
  const plan = buildDiscoveryPlan({ query: q }, MCP_POLICY, ctx);
  const cols = 'notice_id,title,description,sow_text,department,naics_code';
  const { data: canon, error } = await applyOpenPlan(db.from('sam_opportunities').select(cols), plan).limit(1000);
  if (error) { console.log('rank query failed', error.message); return; }
  const ranked = rankRecords(plan, (canon || []) as any[], ['title', 'sow_text', 'description', 'department']);
  const { data: old } = await mapsOldOpen({ query: q })(db.from('sam_opportunities').select(cols)).limit(1000);
  const oldRanked = rankSearchResults((old || []) as any[], q);
  console.log(`\n## Ranking — "${q}"  (canonical eligible: ${canon?.length ?? 0}${(canon?.length || 0) >= 1000 ? '+' : ''}; eligibility=${plan.matcher.alternatives.map((a) => `${a.eligibility}(${a.eligible.map((c) => c.label).join('|')}) rank-only(${a.rankOnly.map((c) => c.label).join('|')})`).join(' OR ')})`);
  console.log('| # | canonical top (score · breadth · matched) | old top (buildSearchOr + rankSearchResults) |');
  console.log('|---|---|---|');
  for (let i = 0; i < 15; i++) {
    const c = ranked[i]; const o = oldRanked[i] as any;
    console.log(`| ${i + 1} | ${c ? `${String((c.row as any).title).slice(0, 70)} · ${c.score.toFixed(1)} · ${c.breadth} · ${c.matched.join('+')}` : ''} | ${o ? String(o.title).slice(0, 70) : ''} |`);
  }
  const breadth: Record<number, number> = {};
  for (const r of ranked) breadth[r.breadth] = (breadth[r.breadth] || 0) + 1;
  console.log('canonical breadth distribution (concepts matched → records):', JSON.stringify(breadth));
}

// ── --maps-open: Phase C. old = Maps Open @ 15eef4c9 (parseMapFilters → applyMapFilters with q/agency),
//    new = the PRODUCTION adapter the route now calls. Full active corpus AND the mappable subset.
//    Exits 1 on any material change without a classification in discovery-replay-maps-open.ts. ──
async function countRetry(build: (q: any) => any, mappable: boolean) {
  for (let i = 0; i < 3; i++) {
    let q = db.from('sam_opportunities').select('notice_id', { count: 'exact', head: true });
    if (mappable) q = q.not('map_lat', 'is', null);
    const t0 = Date.now();
    const { count, error } = await build(q);
    if (!error && count != null) return { count, ms: Date.now() - t0, attempts: i + 1, error: null as string | null };
    if (i === 2) return { count: null as number | null, ms: Date.now() - t0, attempts: 3, error: error?.message || 'count null (unknown)' };
  }
  return { count: null, ms: 0, attempts: 3, error: 'unreachable' };
}
async function mapsOpenReplay() {
  const out: any[] = [];
  let unclassified = 0;
  for (const fx of MAPS_OPEN_FIXTURES) {
    const get = (k: string) => (k === 'status' ? 'active' : fx.params[k] ?? null);
    const oldB = (x: any) => applyMapFilters(x, parseMapFilters(get));
    const req = mapsOpenRequest(get);
    const newB = (x: any) => applyMapsOpenFilters(x, req);
    const [o, n] = await Promise.all([idSet(OPEN, oldB), idSet(OPEN, newB)]);
    const [om, nm] = await Promise.all([countRetry(oldB, true), countRetry(newB, true)]);
    const d = diff(o.ids, n.ids);
    const material = o.count !== n.count || d.onlyA.length > 0 || d.onlyB.length > 0;
    const cls = MAPS_OPEN_CLASSES[fx.label];
    if (material && !cls) unclassified++;
    out.push({
      label: fx.label, params: fx.params, status: req.plan.status, via: req.plan.horizons.open.via,
      all: { old: o.count, new: n.count, overlap: d.both, old_only: d.onlyA.length, new_only: d.onlyB.length },
      mapped: { old: om.count, new: nm.count, old_ms: om.ms, new_ms: nm.ms, errors: [om.error, n.error, o.error, nm.error].filter(Boolean) },
      old_only_sample: await labels(OPEN, d.onlyA), new_only_sample: await labels(OPEN, d.onlyB),
      class: material ? cls?.cls ?? 'UNCLASSIFIED' : 'unchanged', evidence: material ? cls?.why ?? '' : '',
      truncated: o.truncated || n.truncated,
    });
    console.error(`done ${fx.label}: all ${o.count}→${n.count} mapped ${om.count}→${nm.count}`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
  const fmt = (x: number | null | undefined) => (x == null ? 'unknown' : x.toLocaleString());
  console.log('| fixture | status | all old→new | ∩ | old-only | new-only | mappable old→new | class | evidence |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of out) {
    console.log(`| ${r.label} | ${r.status}${r.status === 'ok' ? '' : ''} | ${fmt(r.all.old)} → ${fmt(r.all.new)} | ${fmt(r.all.overlap)} | ${fmt(r.all.old_only)} | ${fmt(r.all.new_only)} | ${fmt(r.mapped.old)} → ${fmt(r.mapped.new)} | ${r.class} | ${r.evidence}${r.mapped.errors.length ? ' ⚠️ ' + r.mapped.errors.join('; ') : ''}${r.truncated ? ' (ID set truncated)' : ''} |`);
  }
  const by: Record<string, number> = {};
  for (const r of out) by[r.class] = (by[r.class] || 0) + 1;
  console.log(`\n${out.length} fixtures · ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
  if (unclassified || by.unexpected_regression) { console.error(`FAIL: ${unclassified} unclassified, ${by.unexpected_regression || 0} unexpected_regression`); process.exit(1); }
}

// ── --maps-recompete: Phase C2. Three sets per fixture over recompete_opportunities:
//    maps_old  = the pre-migration route (measurement copy, a647860c)
//    maps_new  = the PRODUCTION adapter (mapsRecompeteRequest → applyMapsRecompeteFilters)
//    mcp       = MCP's canonical recompete query (applyRecompetePlan, MCP_POLICY)
//    Full market first (no map_lat bound) — maps_new must EQUAL mcp identity-for-identity unless the
//    fixture carries a Maps surface filter — then the mappable subset (map_lat not null).
async function mapsRecompeteReplay() {
  const RC = RECOMPETE;
  const out: any[] = [];
  let unclassified = 0; let parityFail = 0;
  for (const fx of MAPS_RECOMPETE_FIXTURES) {
    const get = (k: string) => fx.params[k] ?? null;
    const req = mapsRecompeteRequest(get, { ctx });
    const oldAny = mapsOldRecompeteRoute(fx.params, ctx.today);
    const newAny = (x: any) => applyMapsRecompeteFilters(x, req, 'any');
    const mcpPlan = buildDiscoveryPlan({ query: fx.params.q || '', agency: req.input.agency, state: fx.params.state || null, naics: fx.params.naics || null }, MCP_POLICY, ctx);
    const mcpAny = (x: any) => applyRecompetePlan(x, mcpPlan);
    const CAP = 160000; // whole recompete table — parity must compare COMPLETE identity sets
    const [o, n, m] = await Promise.all([idSet(RC, oldAny, CAP), idSet(RC, newAny, CAP), idSet(RC, mcpAny, CAP)]);
    const [om, nm] = await Promise.all([idSet(RC, (x: any) => oldAny(x).not('map_lat', 'is', null), CAP), idSet(RC, (x: any) => applyMapsRecompeteFilters(x, req, 'only'), CAP)]);
    const d = diff(o.ids, n.ids);
    const pm = diff(n.ids, m.ids);
    const exempt = PARITY_EXEMPT(fx.params);
    const parity = exempt ? 'n/a (surface filter)' : (n.count === m.count && pm.onlyA.length === 0 && pm.onlyB.length === 0 && !n.truncated) ? 'IDENTICAL' : 'DIFFERENT';
    if (parity === 'DIFFERENT') parityFail++;
    const material = o.count !== n.count || d.onlyA.length > 0 || d.onlyB.length > 0 || om.count !== nm.count;
    const cls = MAPS_RECOMPETE_CLASSES[fx.label];
    if (material && !cls) unclassified++;
    out.push({
      label: fx.label, params: fx.params, status: req.plan.status, via: req.plan.horizons.recompete.via, window: req.policy.recompete.windowMonths,
      full: { old: o.count, new: n.count, mcp: m.count, overlap: d.both, old_only: d.onlyA.length, new_only: d.onlyB.length },
      mapped: { old: om.count, new: nm.count, unmapped_new: n.count != null && nm.count != null ? n.count - nm.count : null },
      parity, parity_new_only: pm.onlyA.length, parity_mcp_only: pm.onlyB.length,
      old_only_sample: await labels(RC, d.onlyA), new_only_sample: await labels(RC, d.onlyB),
      errors: [o.error, n.error, m.error, om.error, nm.error].filter(Boolean), truncated: o.truncated || n.truncated || m.truncated,
      class: material ? cls?.cls ?? 'UNCLASSIFIED' : 'unchanged', evidence: material ? cls?.why ?? '' : '',
    });
    console.error(`done ${fx.label}: full ${o.count}→${n.count} (mcp ${m.count}, ${parity}) mapped ${om.count}→${nm.count}`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
  const fmt = (x: number | null | undefined) => (x == null ? 'unknown' : x.toLocaleString());
  console.log('| fixture | status · via | full old → new | MCP canonical | Maps≡MCP identities | old-only | new-only | mappable old → new | class | evidence |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of out) {
    console.log(`| ${r.label} | ${r.status} · ${r.via} | ${fmt(r.full.old)} → ${fmt(r.full.new)} | ${fmt(r.full.mcp)} | ${r.parity} | ${fmt(r.full.old_only)} | ${fmt(r.full.new_only)} | ${fmt(r.mapped.old)} → ${fmt(r.mapped.new)} | ${r.class} | ${r.evidence}${r.errors.length ? ' ⚠️ ' + r.errors.join('; ') : ''}${r.truncated ? ' (ID set truncated)' : ''} |`);
  }
  const by: Record<string, number> = {};
  for (const r of out) by[r.class] = (by[r.class] || 0) + 1;
  console.log(`\n${out.length} fixtures · ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(' · ')} · identity parity failures ${parityFail}`);
  if (unclassified || by.unexpected_regression || parityFail || out.some((r) => r.errors.length)) {
    console.error(`FAIL: ${unclassified} unclassified, ${by.unexpected_regression || 0} unexpected_regression, ${parityFail} parity failures, ${out.filter((r) => r.errors.length).length} with query errors`);
    process.exit(1);
  }
}

// ── --maps-forecast: Phase C3 (see scripts/discovery-replay-maps-forecast.ts for the contract). ──
async function mapsForecastReplay() {
  const FC = FORECAST;
  const CAP = 60000; // whole agency_forecasts table — identity sets are never truncated
  const out: any[] = [];
  let unclassified = 0; let parityFail = 0; let unplacedFail = 0;
  for (const fx of MAPS_FORECAST_FIXTURES) {
    const get = (k: string) => fx.params[k] ?? null;
    const req = mapsForecastRequest(get, { ctx });
    const fyOp = req.plan.horizons.forecast.ops.find((o: any) => o.op === 'or' && String(o.expr).startsWith('fiscal_year.is.null,')) as any;
    const legacyFilters = { q: fx.params.q || null, naics: fx.params.naics || null, agency: fx.params.agency || null, state: fx.params.state || null };
    const oldB = (x: any) => applyForecastFilters(x, legacyFilters);
    // A blocked plan (needs_positive_scope) carries only the fail-closed op, so take the FY clause from an
    // unblocked plan under the same policy + context — it is query-independent.
    const fyExpr: string = fyOp?.expr ?? (buildDiscoveryPlan({ query: '' }, MCP_POLICY, ctx).horizons.forecast.ops.find((o: any) => o.op === 'or' && String(o.expr).startsWith('fiscal_year.is.null,')) as any).expr;
    const oldFyB = (x: any) => oldB(x).or(fyExpr);
    const newB = (x: any) => req.apply(x);
    const mcpPlan = buildDiscoveryPlan({ query: fx.params.q || '', agency: req.input.agency, state: fx.params.state || null, naics: fx.params.naics || null }, MCP_POLICY, ctx);
    const mcpB = (x: any) => applyForecastPlan(x, mcpPlan);
    const [o, of, n, m] = await Promise.all([idSet(FC, oldB, CAP), idSet(FC, oldFyB, CAP), idSet(FC, newB, CAP), idSet(FC, mcpB, CAP)]);
    const [nu, mu, ou, nm] = await Promise.all([
      idSet(FC, (x: any) => newB(x.is('map_lat', null)), CAP),
      idSet(FC, (x: any) => mcpB(x.is('map_lat', null)), CAP),
      idSet(FC, (x: any) => oldFyB(x.is('map_lat', null)), CAP), // the OLD /api/forecasts/unplaced semantics (filters + its own past-FY rule)
      idSet(FC, (x: any) => newB(x.not('map_lat', 'is', null)), CAP),
    ]);
    const fyOnly = diff(o.ids, of.ids);           // rows removed by the FY policy alone
    const sem = diff(of.ids, n.ids);              // semantic delta, FY held constant
    const pm = diff(n.ids, m.ids);
    const pu = diff(nu.ids, mu.ids);
    const parity = n.count === m.count && pm.onlyA.length === 0 && pm.onlyB.length === 0 ? 'IDENTICAL' : 'DIFFERENT';
    const unplacedParity = nu.count === mu.count && pu.onlyA.length === 0 && pu.onlyB.length === 0 && [...nu.ids].every((i) => n.ids.has(i)) ? 'IDENTICAL ⊂ market' : 'DIFFERENT';
    if (parity !== 'IDENTICAL') parityFail++;
    if (unplacedParity === 'DIFFERENT') unplacedFail++;
    const semantic = sem.onlyA.length > 0 || sem.onlyB.length > 0;
    const cls = MAPS_FORECAST_CLASSES[fx.label];
    if (semantic && !cls) unclassified++;
    out.push({
      label: fx.label, params: fx.params, status: req.plan.status, via: req.plan.horizons.forecast.via, coverage: req.plan.horizons.forecast.coverage,
      old: o.count, old_fy: of.count, fy_removed: fyOnly.onlyA.length, new: n.count, mcp: m.count,
      sem_old_only: sem.onlyA.length, sem_new_only: sem.onlyB.length, parity,
      mapped_new: nm.count, unplaced_new: nu.count, unplaced_mcp: mu.count, unplaced_old_route: ou.count, unplaced_parity: unplacedParity,
      old_only_sample: await labels(FC, sem.onlyA), new_only_sample: await labels(FC, sem.onlyB), fy_removed_sample: await labels(FC, fyOnly.onlyA),
      errors: [o.error, of.error, n.error, m.error, nu.error, mu.error, ou.error, nm.error].filter(Boolean),
      truncated: o.truncated || n.truncated || m.truncated,
      class: semantic ? cls?.cls ?? 'UNCLASSIFIED' : (fyOnly.onlyA.length ? 'expected_policy_change (FY only)' : 'unchanged'),
      evidence: semantic ? cls?.why ?? '' : (fyOnly.onlyA.length ? `${fyOnly.onlyA.length} past-FY forecasts removed by the canonical current+future-FY default; nothing else changed.` : ''),
    });
    console.error(`done ${fx.label}: ${o.count}→(FY)${of.count}→${n.count} mcp ${m.count} ${parity} unplaced ${nu.count}/${mu.count} ${unplacedParity}`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
  const fmt = (x: number | null | undefined) => (x == null ? 'unknown' : x.toLocaleString());
  console.log('| fixture | status · via | old | − past FY | = old (cur+fut FY) | new | MCP | Maps≡MCP | sem old-only | sem new-only | drawable | unplaced new = MCP (old route) | unplaced parity | class | evidence |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of out) {
    console.log(`| ${r.label.replace(/\|/g, '\\|')} | ${r.status} · ${r.via}${r.coverage !== 'ok' ? ' · coverage ' + r.coverage : ''} | ${fmt(r.old)} | ${fmt(r.fy_removed)} | ${fmt(r.old_fy)} | ${fmt(r.new)} | ${fmt(r.mcp)} | ${r.parity} | ${fmt(r.sem_old_only)} | ${fmt(r.sem_new_only)} | ${fmt(r.mapped_new)} | ${fmt(r.unplaced_new)} = ${fmt(r.unplaced_mcp)} (${fmt(r.unplaced_old_route)}) | ${r.unplaced_parity} | ${r.class} | ${r.evidence}${r.errors.length ? ' ⚠️ ' + r.errors.join('; ') : ''}${r.truncated ? ' (truncated)' : ''} |`);
  }
  const by: Record<string, number> = {};
  for (const r of out) by[r.class] = (by[r.class] || 0) + 1;
  console.log(`\n${out.length} fixtures · ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(' · ')} · parity failures ${parityFail} · unplaced failures ${unplacedFail}`);
  if (unclassified || by.unexpected_regression || parityFail || unplacedFail || out.some((r) => r.errors.length || r.truncated)) {
    console.error(`FAIL: ${unclassified} unclassified, ${by.unexpected_regression || 0} unexpected_regression, ${parityFail} parity, ${unplacedFail} unplaced, ${out.filter((r) => r.errors.length).length} query errors`);
    process.exit(1);
  }
}

(async () => {
  if (args.includes('--maps-forecast')) { await mapsForecastReplay(); return; }
  if (args.includes('--maps-recompete')) { await mapsRecompeteReplay(); return; }
  if (args.includes('--maps-open')) { await mapsOpenReplay(); return; }
  if (rankQ) { await rankReport(rankQ); return; }
  const out: any[] = [];
  for (const f of FIX) {
    const plan: DiscoveryPlan = buildDiscoveryPlan(f.input, MCP_POLICY, ctx);
    let H: any = {};
    if (f.input.query) {
      try { const mcp: any = await findOpportunities({ query: f.input.query, agency: f.input.agency || undefined } as any); H = mcp.horizons || {}; }
      catch (e) { console.error(`mcp_old failed for ${f.label}: ${(e as Error).message}`); }
    } else if (f.input.agency) {
      // find_opportunities requires a query, so measure MCP's agency path directly: the same
      // resolveBuyerIdentity needles, pipe-joined into applyMapFilters' agency filter (queryOpenNow).
      const needles = resolveBuyerIdentity(f.input.agency).needles;
      const fo = parseMapFilters((k) => (k === 'agency' ? pipeNeedles(needles) : k === 'status' ? 'active' : null));
      const { count } = await applyMapFilters(db.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }), fo);
      H = { open_now: { matched_count: count ?? null } };
    }
    const open = await horizon('open', OPEN, mapsOldOpen(f.input), (x) => applyOpenPlan(x, plan), H.open_now?.matched_count);
    const recompete = await horizon('recompete', RECOMPETE, mapsOldRecompete(f.input), (x) => applyRecompetePlan(x, plan), H.coming_back?.matched_count);
    const forecast = await horizon('forecast', FORECAST, mapsOldForecast(f.input), (x) => applyForecastPlan(x, plan), H.coming_soon?.matched_count);
    out.push({ label: f.label, status: plan.status, refinement: plan.refinement, horizons: [open, recompete, forecast] });
    console.error(`done ${f.label}`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
  const fmt = (n: number | null | undefined) => (n == null ? 'unknown' : n.toLocaleString());
  console.log('| fixture | horizon | Maps old | MCP old | canonical | Maps-old ∩ canonical | Maps-old-only | new-only |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of out) for (const h of r.horizons) {
    console.log(`| ${r.label}${r.status !== 'ok' ? ` **[${r.status}]**` : ''} | ${h.horizon} | ${fmt(h.maps_old)} | ${fmt(h.mcp_old)} | ${fmt(h.canonical)} | ${fmt(h.overlap)} | ${fmt(h.old_only)} | ${fmt(h.new_only)} |${h.errors.length ? ' ⚠️ ' + h.errors.join('; ') : ''}${h.truncated ? ' (ID set truncated)' : ''}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });

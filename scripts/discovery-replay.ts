/**
 * READ-ONLY. Replays old vs canonical discovery semantics against the live corpus.
 *
 *   npx tsx --env-file=.env.local scripts/discovery-replay.ts [--json out.json] [--rank "query"]
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

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const argVal = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const jsonOut = argVal('--json');
const rankQ = argVal('--rank');
const ctx = contextFor();
const ID_CAP = 25000;

const FIX: Array<{ label: string; input: DiscoveryInput }> = ([] as Array<{ label: string; input: DiscoveryInput }>).concat([
  '541320', 'pam', 'ai governance', 'artificial intelligence governance', 'cybersecurity', 'janitorial',
  'market research', 'zzzxxyyqqq', 'Show me USDA opportunities', 'SDVOSB cybersecurity opportunities in Virginia',
  'cyber cloud compliance network server', 'Pro Audio', '541512 -computers', '-computers',
  'veterans affairs', 'Naval facilities in Nevada',
].map((q) => ({ label: q, input: { query: q } as DiscoveryInput })))
  .concat([
    { label: 'agency=USDA (collision)', input: { query: '', agency: 'USDA' } },
    { label: 'agency=VA (collision)', input: { query: '', agency: 'VA' } },
  ]);

type Src = { table: string; id: string; cols: string; label: (r: any) => string };
const OPEN: Src = { table: 'sam_opportunities', id: 'notice_id', cols: 'notice_id,title,department,sub_tier,naics_code', label: (r) => `${r.title} [${r.naics_code || '—'}] · ${r.sub_tier || r.department || ''}` };
const RECOMPETE: Src = { table: 'recompete_opportunities', id: 'contract_id', cols: 'contract_id,incumbent_name,naics_code,naics_description,awarding_sub_agency', label: (r) => `${r.incumbent_name} · ${r.naics_code} ${r.naics_description || ''} · ${r.awarding_sub_agency || ''}` };
const FORECAST: Src = { table: 'agency_forecasts', id: 'id', cols: 'id,title,naics_code,fiscal_year,source_agency', label: (r) => `${r.title} [${r.naics_code || '—'}] ${r.fiscal_year || ''} · ${r.source_agency || ''}` };

async function idSet(src: Src, build: (q: any) => any) {
  const ids = new Set<string>();
  let count: number | null = null;
  for (let from = 0; from < ID_CAP; from += 1000) {
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
const mapsOldOpen = (i: DiscoveryInput) => (x: any) => applyMapFilters(x, parseMapFilters((k) => (k === 'q' ? i.query || null : k === 'agency' ? i.agency || null : k === 'status' ? 'active' : null)));
function mapsOldRecompete(i: DiscoveryInput) {
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
const mapsOldForecast = (i: DiscoveryInput) => (x: any) => applyForecastFilters(x, { q: i.query || null, naics: null, agency: i.agency || null, state: null });

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

(async () => {
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

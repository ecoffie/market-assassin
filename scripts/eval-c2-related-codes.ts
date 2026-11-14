/**
 * C2 experiment (READ-ONLY, Agent 3, 2026-11-14): how should a janitorial search treat the preset's
 * RELATED family (561210 facilities support, 561730 landscaping) on Open? Nothing here changes
 * production behaviour; it scores three admission rules against the existing blind labels.
 *
 *   A1 current         : canonical plan as shipped (janitorial text OR 561720 OR 561210 OR 561730)
 *   A2 core code only  : naics_code = 561720
 *   A3 core + evidence : 561720, plus a related-code (or text-only) notice ONLY when Agent 1's released
 *                        Open labeller (find-opportunities.ts labelOpenRow) classifies it DIRECT_MATCH,
 *                        i.e. the visible buy-side text establishes the work (buyer name and solicitation
 *                        number blanked). The labeller is imported and called unmodified.
 *   A3s (reference)    : 561720 OR the planner's SQL text path (title/description/SOW/department/sol#),
 *                        i.e. "drop the related codes from retrieval". Shows what SOW-only evidence adds.
 *
 * All rules are subsets of A1, so the stratified labels (legacy-only / canonical-only / both / neither)
 * give unbiased ratio estimates of precision and pooled recall with no new labeling.
 *
 *   FIXTURE_DIR=<dir with pool.json + labels.json> npx tsx scripts/eval-c2-related-codes.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never);
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { applyMapFilters } from '@/lib/opportunities/map-filters';
import { mapsOpenRequest, applyMapsOpenFilters } from '@/lib/opportunities/maps-open-discovery';
import { interpretMarket } from '@/lib/opportunities/market-interpretation';
import { labelOpenRow } from '@/lib/opportunities/find-opportunities';
import { matchesText } from '@/lib/discovery';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const FX = (process.env.FIXTURE_DIR || 'tests/fixtures/saved-search-relevance-2026-11-14') + '/';
const { key } = JSON.parse(fs.readFileSync(FX + 'pool.json', 'utf8'));
const LABELS: Record<string, boolean> = JSON.parse(fs.readFileSync(FX + 'labels.json', 'utf8'));
const COLS = 'notice_id,title,description,sow_text,naics_code,psc_code,department,sub_tier,solicitation_number,response_deadline';
const INTENT = process.env.INTENT || 'janitorial';
const Q = key[INTENT].filters.q as string;

type Row = Record<string, string | null>;
const req = mapsOpenRequest((k) => (k === 'q' ? Q : null));
req.filters.postedDays = 30;
const plan = req.plan;
const cap = interpretMarket(Q, null).capability;
const core = new Set(cap.direct.naics);

const RULES: Record<string, (r: Row) => boolean> = {
  A1_current: () => true,
  A2_core_code_only: (r) => core.has(String(r.naics_code)),
  A3_core_plus_evidence: (r) => core.has(String(r.naics_code)) || labelOpenRow(r, plan, cap).cls === 'DIRECT_MATCH',
  A3v_core_plus_visible_text: (r) => core.has(String(r.naics_code)) || matchesText(plan.matcher, [r.title, r.description]),
  A3s_core_plus_sql_text: (r) => core.has(String(r.naics_code))
    || matchesText(plan.matcher, [r.title, r.description, r.sow_text, r.department, r.solicitation_number]),
};

async function fetchRows(ids: string[]): Promise<Map<string, Row>> {
  const m = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from('sam_opportunities').select(COLS).in('notice_id', ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const r of data as Row[]) m.set(String(r.notice_id), r);
  }
  return m;
}

(async () => {
  // Live A1 population (the cron's 30-day window) so each rule's result count is exact, not estimated.
  const pop: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await applyMapsOpenFilters(db.from('sam_opportunities').select(COLS), req).order('notice_id').range(f, f + 999);
    if (error) throw new Error(error.message);
    pop.push(...(data as Row[]));
    if (data!.length < 1000) break;
  }
  void applyMapFilters;

  const k = key[INTENT];
  const items = Object.entries<string>(k.items).filter(([it]) => it in LABELS);
  const rows = await fetchRows(items.map(([it]) => it.split(':')[1]));
  const inA1 = (s: string) => s === 'canonical_only' || s === 'both';

  const est = (keep: (it: string, s: string) => boolean) => {
    let rel = 0, ret = 0, nLabeled = 0;
    for (const s of Object.keys(k.sizes)) {
      const its = items.filter(([, st]) => st === s);
      if (!its.length) continue;
      const w = k.sizes[s] / its.length;
      for (const [it] of its) { if (!keep(it, s)) continue; nLabeled++; ret += w; if (LABELS[it]) rel += w; }
    }
    return { rel, ret, nLabeled };
  };
  const totalRel = est(() => true).rel;
  const out = [];
  for (const [name, rule] of Object.entries(RULES)) {
    const e = est((it, s) => { if (!inA1(s)) return false; const r = rows.get(it.split(':')[1]); return !!r && rule(r); });
    const lost = items.filter(([it, s]) => inA1(s) && LABELS[it] && !rule(rows.get(it.split(':')[1])!))
      .map(([it]) => { const r = rows.get(it.split(':')[1])!; return `${r.naics_code} ${String(r.title).slice(0, 70)}`; });
    const removedFalse = items.filter(([it, s]) => inA1(s) && !LABELS[it] && !rule(rows.get(it.split(':')[1])!)).length;
    out.push({
      rule: name,
      results: pop.filter(rule).length,
      precision: e.ret ? Math.round((100 * e.rel) / e.ret) : null,
      recall: totalRel ? Math.round((100 * e.rel) / totalRel) : null,
      labeledKept: e.nLabeled,
      labeledFalseRemoved: removedFalse,
      labeledRelevantLost: lost,
    });
  }
  // Is the SQL-expressible A3v the SAME set as Agent 1's labeller rule A3 on the live population?
  const a3 = new Set(pop.filter(RULES.A3_core_plus_evidence).map((r) => r.notice_id));
  const a3v = new Set(pop.filter(RULES.A3v_core_plus_visible_text).map((r) => r.notice_id));
  const a3Equivalence = { onlyLabeller: [...a3].filter((x) => !a3v.has(x)), onlySql: [...a3v].filter((x) => !a3.has(x)) };
  const byCode: Record<string, number> = {};
  for (const r of pop) byCode[String(r.naics_code)] = (byCode[String(r.naics_code)] || 0) + 1;
  console.log(JSON.stringify({ intent: INTENT, q: Q, coreNaics: [...core], relatedNaics: cap.related_market?.naics ?? [], population: pop.length, byCode, estRelevantPooled: Math.round(totalRel), strata: k.sizes, a3Equivalence, rules: out }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });

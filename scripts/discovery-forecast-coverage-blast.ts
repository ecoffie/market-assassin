/**
 * READ-ONLY blast for the canonical Forecast coverage fix (2026-09-23).
 *
 *   npx tsx --env-file=.env.local scripts/discovery-forecast-coverage-blast.ts
 *
 * Every buyer name we can see (the shared alias corpus + live SAM department/sub_tier values) is planned
 * as an agency filter. For each buyer the plan now marks UNCOVERED (no forecast publisher), it counts
 * what the OLD resolver + text fallback returned. Those rows are the only records the fix removes.
 * Measured 2026-09-23: 812 terms, 677 uncovered, 4 whose old fallback returned rows — all leaks of
 * OTHER publishers ("COMMERCE, DEPARTMENT OF" → the fragment "DEPARTMENT OF" → 7,195 rows).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import aliasData from '@/data/agency-aliases.json';
import { resolveForecastAgencies, forecastAgencyOrExpr } from '@/lib/forecasts/agency-identity';
import { buildDiscoveryPlan, MCP_POLICY, contextFor } from '@/lib/discovery';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const terms = new Set<string>();
  const al = (aliasData as any).aliases || {};
  for (const [k, v] of Object.entries(al)) { terms.add(k); terms.add(String(v)); }
  for (const col of ['department', 'sub_tier']) {
    for (let f = 0; f < 20000; f += 1000) {
      const { data, error } = await db.from('sam_opportunities').select(col).eq('active', true).order('notice_id').range(f, f + 999);
      if (error) throw error; for (const r of data || []) if ((r as any)[col]) terms.add(String((r as any)[col]));
      if (!data || data.length < 1000) break;
    }
  }
  const fy = (buildDiscoveryPlan({ query: '' }, MCP_POLICY, contextFor()).horizons.forecast.ops.find((o: any) => o.op === 'or' && String(o.expr).startsWith('fiscal_year.is.null,')) as any).expr;
  let uncovered = 0, withRows = 0; const hits: string[] = [];
  for (const t of terms) {
    const plan = buildDiscoveryPlan({ query: '', agency: t }, MCP_POLICY, contextFor());
    const f = plan.horizons.forecast;
    if (f.coverage === 'ok') continue;
    uncovered++;
    // OLD behavior for this buyer: the whole requested string through the resolver (+ text fallback).
    const old = forecastAgencyOrExpr(resolveForecastAgencies(t));
    if (!old || old === 'source_agency.is.null') continue;
    const { count, error } = await db.from('agency_forecasts').select('id', { count: 'exact', head: true }).or(old).or(fy);
    if (error) { hits.push(`ERR ${t}: ${error.message}`); continue; }
    if (count) { withRows++; const { data, error: sErr } = await db.from('agency_forecasts').select('source_agency,department,title').or(old).or(fy).limit(3); if (sErr) { hits.push(`ERR sample ${t}: ${sErr.message}`); continue; } hits.push(`${count}\t${t}\t[${f.coverageGaps?.map((g) => g.reason).join(',')}]\t${(data || []).map((r: any) => `${r.source_agency}/${r.department ?? '∅'}: ${String(r.title).slice(0, 40)}`).join(' | ')}`); }
  }
  console.log(`terms ${terms.size} · uncovered ${uncovered} · uncovered whose OLD fallback returned rows: ${withRows}`);
  for (const h of hits.sort((a, b) => parseInt(b) - parseInt(a))) console.log(h);
})();

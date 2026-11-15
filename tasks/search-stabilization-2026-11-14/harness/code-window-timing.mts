// READ-ONLY live timing (Agent 3, 2026-11-15): cost of the code-recall sub-window on production sam_opportunities.
// Per product-preset phrasing: the existing deadline-window query vs the extra sub-window query (same plan AND psc IN codes).
// SELECT only, sequential, 3 runs each, median reported. usage: tsx code-window-timing.mts <queries_v4.json> <out.json>
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';
import { applyOpenPlan } from '@/lib/discovery/apply';
import { interpretMarket } from '@/lib/opportunities/market-interpretation';
import { openCodeWindowPsc, OPEN_CODE_WINDOW_CAP, OPEN_FETCH_CAP } from '@/lib/opportunities/open-relevance';
// .env.local values are quoted and end with a literal "\\n" (the vercel env pull gotcha); shell sourcing keeps the "\\n".
const clean = (v: string | undefined) => String(v || '').trim().replace(/^["']|["']$/g, '').replace(/(\\n)+$/, '').trim();
const db = createClient(clean(process.env.NEXT_PUBLIC_SUPABASE_URL), clean(process.env.SUPABASE_SERVICE_ROLE_KEY), { auth: { persistSession: false } });
const COLS = 'notice_id, title, department, sub_tier, naics_code, psc_code, description, set_aside_code, set_aside_description, notice_type, response_deadline, ui_link, solicitation_number, pop_state, pop_city, office_address, map_lat, updated_at';
const Q = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const out: Record<string, unknown> = {};
for (const [biz, cfg] of Object.entries<{ q: string[] }>(Q)) for (const [i, q] of cfg.q.entries()) {
  const cap = interpretMarket(q, null).capability; const codes = openCodeWindowPsc(cap);
  if (!codes.length) continue;
  const plan = buildDiscoveryPlan({ query: q }, MCP_POLICY);
  const main: number[] = []; const sub: number[] = []; let mainRows = 0, subRows = 0, err: string | null = null;
  for (let k = 0; k < 3; k++) {
    let t = Date.now();
    const m = await applyOpenPlan(db.from('sam_opportunities').select(COLS, { count: 'exact' }), plan).order('response_deadline', { ascending: true, nullsFirst: false }).limit(OPEN_FETCH_CAP);
    main.push(Date.now() - t); mainRows = m.data?.length ?? 0; if (m.error) err = m.error.message;
    t = Date.now();
    const s = await applyOpenPlan(db.from('sam_opportunities').select(COLS), plan).in('psc_code', codes).order('response_deadline', { ascending: true, nullsFirst: false }).limit(OPEN_CODE_WINDOW_CAP);
    sub.push(Date.now() - t); subRows = s.data?.length ?? 0; if (s.error) err = (err ? err + ' | ' : '') + 'sub: ' + s.error.message;
  }
  const triggered = mainRows >= OPEN_FETCH_CAP;
  out[`${biz}#${i}`] = { codes: codes.length, triggered, main_ms: med(main), sub_ms: med(sub), main_rows: mainRows, sub_rows: subRows, error: err };
  console.log(`${biz}#${i}`.padEnd(14), `main ${med(main)}ms ${mainRows} rows`.padEnd(26), triggered ? `sub ${med(sub)}ms ${subRows} rows` : 'window not full → no sub-query', err ? 'ERR ' + err.slice(0, 60) : '');
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));

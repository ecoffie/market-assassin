# MCP Ticket Repro Pack — for independent verification (Codex)

**Purpose:** Re-run all 10 MINDY-* tickets COLD and produce your own broken/fixed verdict, then
compare to Claude's table below. Do NOT trust either model's code reading — trust the **live tool
output**. (Claude was initially wrong here precisely because it read code/ledger instead of running
the tools.)

**How to run:** from repo root `/Users/ericcoffie/Market Assasin/market-assassin`, drop the script
below into `./_repro.mjs` and run `npx tsx --tsconfig tsconfig.json ./_repro.mjs` (needs `.env.local`
present — it has the keys). Delete the file after. All tools dispatch through the real MCP registry
`runMcpTool(name, args, { userEmail })`, the same path the hosted server uses.

---

## Claude's verdict table (verified live 2026-07-30) — compare against yours

| ID | Tool | Input | Claude's verdict | Evidence Claude saw |
|----|------|-------|------------------|---------------------|
| 001 | draft_proposal_section | DLA / technical / DLA26BZ03-NV012 scope | **NOT REPRO'D as filed** | grounded, clean 4.9k-char draft on staff account; original bug needs a true EMPTY-vault + wrong-entity condition (not matched) |
| 002 | get_incumbent_financials | company_name="Microsoft" | **BROKEN** | financials[0] = FY2010 rev $14.5B, net_income null; correct 2026 10-K found but ancient XBRL bucket returned |
| 003 | get_incumbent_financials | company_name="Owens & Minor" | **BROKEN** | grounded=false, edgar=null (ampersand/CIK resolution) |
| 004 | capability_market_match | client_name="MINDY (getmindy.ai)", desc repeats "MINDY" | **BROKEN** | lead_keyword="mindy market research"; keywords[] full of "mindy" permutations |
| 005 | capability_market_match | same as 004 | **BROKEN** | top_naics[0]=424210 Drugs & Druggists', total_market≈$5.18B (pharma collision) |
| 006 | get_expiring_contracts | naics="541512", months=24, orderBy=value | **FIXED** | 27 distinct PoP-ends; recompete + lead vary correctly (13/11/0 mo tracking PoP-end) |
| 007 | get_expiring_contracts | naics="541512", months=24 | **BROKEN** | 50/50 rows NULL naics_description + psc_code + description (columns selected, DATA not populated) |
| 008 | get_expiring_contracts | agency="FEMA", months=24 | **BROKEN** | 0 rows; but 9 rows w/ awarding_sub_agency="Federal Emergency Management Agency" exist under agency="Homeland Security" |
| 009 | search_sam_opportunities | keyword="market research" | **BROKEN** | top titles = Lynx liquid handling, VA ambulance transport, borescopes, demolition (boilerplate pollution) |
| 010 | get_contractor_award_history | company="Leidos", award_limit=5 | **as filed (Low)** | matches "LEIDOS BIOMED..." subsidiary, confidence=medium; $5.1B/305 = subset, not parent Leidos Holdings |

**Root-cause note on 002 (for Codex to confirm/refute):** the FM-U01 fix (2026-07-29) corrected
year-LABELING (period-end vs XBRL `fy`) and the sort, but the revenue CONCEPT LIST in
`src/lib/edgar/index.ts` `annualValues(facts, concepts)` appears stale — MSFT reports modern revenue
under `RevenueFromContractWithCustomerExcludingAssessedTax` (post-2018), so if the code matches an
older tag (`Revenues`/`SalesRevenueNet`) Microsoft stopped using ~2010, "newest row" is legitimately
2010 in that bucket. **Check which us-gaap concepts the code tries, in order.**

---

## The runnable script (`./_repro.mjs`)

```js
import { config } from 'dotenv'; config({ path: '.env.local' });
const { runMcpTool } = await import('@/lib/mcp/tool-registry');
const EMAIL = 'eric@govcongiants.com';
const call = (name, args) => runMcpTool(name, args, { userEmail: EMAIL }).then(r => r.result || r);
const P = (id, s) => console.log(id + ': ' + s);

// 002
const m = await call('get_incumbent_financials', { company_name:'Microsoft' });
const f = m.edgar?.financials?.[0];
P('002', `MSFT financials[0] = FY${f?.fy} rev $${(f?.revenue/1e9).toFixed(1)}B net_income=${f?.net_income} (real FY2025≈$245B)`);

// 003
const om = await call('get_incumbent_financials', { company_name:'Owens & Minor' });
P('003', `grounded=${om._meta?.grounded} edgar=${om.edgar?'match':'null'}`);

// 004/005
const cap = await call('capability_market_match', { client_name:'MINDY (getmindy.ai)', description:'MINDY is an AI platform. MINDY does market research.', capabilities:['MINDY market research'] });
P('004', `lead_keyword="${cap.market?.lead_keyword}"`);
P('005', `top_naics[0]=${cap.market?.top_naics?.[0]?.code} ${cap.market?.top_naics?.[0]?.name} | total_market=$${(cap.market?.total_market/1e9).toFixed(2)}B`);

// 006/007
const ec = await call('get_expiring_contracts', { naics:'541512', months_window:24, order_by:'value', limit:50 });
const rows = ec.contracts || ec.results || [];
const ends = [...new Set(rows.map(c=>c.period_of_performance_current_end))];
P('006', `distinct PoP-ends=${ends.length} | samples: ` + rows.slice(0,3).map(c=>`${c.period_of_performance_current_end}→${c.estimated_recompete_date}/L${c.lead_time_months}`).join(' , '));
const nullMeta = rows.filter(c=>!c.naics_description && !c.psc_code && !c.description).length;
P('007', `${nullMeta}/${rows.length} rows NULL desc/psc/naics_desc`);

// 008
const fema = await call('get_expiring_contracts', { agency:'FEMA', months_window:24, limit:5 });
const dhs = await call('get_expiring_contracts', { agency:'Homeland Security', naics:'541', months_window:24, limit:50 });
const femaRows = (fema.contracts||[]).length;
const femaUnderDhs = (dhs.contracts||[]).filter(c=>/emergency management/i.test(c.awarding_sub_agency||'')).length;
P('008', `FEMA direct=${femaRows} rows | FEMA-under-DHS=${femaUnderDhs}`);

// 009
const sam = await call('search_sam_opportunities', { keyword:'market research', limit:8 });
const opps = sam.results || sam.opportunities || sam.rows || [];
P('009', 'top titles: ' + JSON.stringify(opps.slice(0,6).map(o=>o.title)));

// 010
const led = await call('get_contractor_award_history', { company:'Leidos', award_limit:5 });
P('010', `matched="${led.history?.match?.name || led.history?.contractor?.company}" confidence=${led.history?.match?.confidence}`);

// 001 (needs a genuinely empty vault + wrong-entity to reproduce as filed — this run just checks fabrication markers)
const dr = await call('draft_proposal_section', { agency:'Defense Logistics Agency', section_type:'technical', rfp_text:'DLA SBIR DLA26BZ03-NV012: AI vendor economic-dependency tool.' });
const t = String(dr.draft?.draft ?? dr.draft?.content ?? '');
P('001', `len=${t.length} ISO9001=${/ISO\s*9001/i.test(t)} fabricated_client=${/Veterans Affairs|Koamana/i.test(t)} placeholder=${/\[INSERT|\[PAST/i.test(t)}`);
```

---

## Reading the results

- **Agreement** with Claude's table → the verdict is real; proceed to fix.
- **Disagreement** on any row → that's the one to dig into (likely a result-shape read difference or
  an environment/caching difference — note EDGAR + BigQuery results are cached, so a stale cache can
  differ between runs).
- 001 + 010 are the two "soft" verdicts — if Codex can force 001's empty-vault fabrication or confirm
  010's parent-rollup gap, that firms them up.

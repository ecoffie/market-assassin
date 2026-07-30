# MCP Fix Check-Pack — verify MINDY-002/003/004/005/007/008/009/010 (PRs #645, #646, #648, #650, #652)

**Purpose:** independently confirm the shipped fixes (and confirm the still-open tickets are
genuinely still open, not silently "fixed" in a doc). Run the script → compare to the expected
table. Same discipline as the repro pack: **trust the live tool output, not the code.**

**Batch2 (PR #646):** MINDY-003 (EDGAR name→CIK fallback), MINDY-009 (SAM search relevance).
**Batch3 (PR #648):** MINDY-005 (market-research pharma collision), MINDY-010 (parent rollup).
All four moved from "still open" to "fixed" — see the updated tables.
**Batch4 (PR #650):** MINDY-007 — `naics_description` now derived from `naics_code` (0/10 → 10/10);
`psc_code`/`description` stay honestly null (the source lacks them; a detail-endpoint backfill is
Eric's call). **Only 001 (not reproduced as filed) is fully open.** ⚠️ Run this AFTER the prod
deploy lands (the hosted MCP transport serves the new code); before deploy, only the local
`runMcpTool` path (this script) reflects the fix.

**Run:** from repo root, drop into `./_check.mjs`, `npx tsx --tsconfig tsconfig.json ./_check.mjs`,
delete it. Needs `.env.local`. Hits live EDGAR + live Supabase + BigQuery through the real MCP
registry — the same path the hosted server uses. (EDGAR/BQ are cached; a first cold run may be slow.)

---

## Expected after the fix (PR #645)

| ID | Check | PASS looks like | FAIL looks like (the old bug) |
|----|-------|-----------------|-------------------------------|
| 002 | MSFT revenue | latest FY (2025/2026), rev **> $200B**, net income non-null | FY2010, $14.5B, net_income null |
| 002 | golden set | Leidos ~$17B, Booz ~$11B, both current FY | ancient/zero |
| 008 | agency="FEMA" | **> 0 rows**, sub-agency = Federal Emergency Management Agency | 0 rows |
| 008 | acronym CBP | > 0 rows, Customs and Border Protection | 0 rows |
| 008 | NAICS+agency combo | > 0 rows (two .or() groups AND correctly) | 0 (regression) |
| 004 | capability lead | lead_keyword = **"market research"** (NOT "mindy"); no "mindy" in keywords | lead "mindy…"; competitors named Mindy |
| 004 | competitors | real market-research firms | MINDY SOLOMON GALLERY, FLANAGAN MINDY E |
| 003 | "Owens & Minor" | **grounded=true**, edgar match, FY2025 rev ~**$2.76B** (resolves via EDGAR company-search fallback → CIK 75252, conformed-name "Accendra Health") | grounded=false, edgar=null |
| 003 | "Owens and Minor" (spelled-out) | ALSO grounded=true → same CIK 75252 (the &/and variant) | grounded=false |
| 003 | private firm honest-miss | fake private LLC → grounded=false (no fabricated CIK) | fabricated financials |
| 009 | search "market research" | top titles are **genuine Market-Research notices** (title-scoped first); ≥6/8 contain "market research" in the title | ambulances / borescopes / demolition boilerplate |
| 009 | body-only keyword "janitorial" | still returns real janitorial notices (body pass intact — not over-narrowed) | 0 rows |
| 005 | capability top_naics | leads a **5419xx marketing code** (541910 Marketing Research or 541613 Marketing Consulting) — NOT 424210 pharma | leads 424210 Drugs & Druggists' |
| 005 | keyword regressions | hvac→238220, welding→333992, janitorial→561720, landscaping→561730, security guard→561612, demolition→562910 (all unchanged). NOTE drones→339930 is the *documented* promoted-lead behavior (topCodePct vs leadCodePct), NOT a regression — don't assert 336xxx | any of these flips |
| 010 | "Leidos" award history | match.name = **"LEIDOS, INC."** (parent), confidence **high** | "LEIDOS BIOMEDICAL RESEARCH INC", medium |
| 010 | primes → parent | Lockheed/Raytheon/Northrop/Booz/Deloitte all resolve to the PARENT at high confidence | a subsidiary name |
| 010 | Anduril (no #279 regression) | resolves to ANDURIL, not J&J's portfolio | cross-firm bleed |
| 007 | expiring `naics_description` | **populated** (derived from naics_code via getNaics) — e.g. 541512 → "Computer Systems Design Services", all rows non-null | all NULL |

## Partially open / honest limits (NOT a fake-fix — the source genuinely lacks the data)

| ID | Check | Expected (honest miss, NOT a bug) |
|----|-------|-----------------------------------|
| 007 | expiring `psc_code` / `description` | still NULL — USASpending's spending_by_award returns these NULL even when requested; they need a per-award detail-endpoint backfill (a bulk op, Eric's call). Honest null, never guessed. |
| 001 | draft_proposal_section | not reproduced as filed (needs a true empty-vault + wrong-entity condition) |

---

## The script (`./_check.mjs`)

```js
import { config } from 'dotenv'; config({ path: '.env.local' });
const { runMcpTool } = await import('@/lib/mcp/tool-registry');
const { getIncumbentFinancials } = await import('@/mcp/tools/incumbent-financials');
const { queryExpiringContracts } = await import('@/lib/recompete/query');
const { capabilityMarketMatch } = await import('@/mcp/tools/capability-market-match');
const { keywordCoverage } = await import('@/lib/market/keyword-coverage');
const EMAIL = 'eric@govcongiants.com';
const P = (id, s) => console.log(id + ': ' + s);

// ── 002 (FIXED) ──
for (const co of ['Microsoft','Leidos','Booz Allen Hamilton']) {
  const r = await getIncumbentFinancials({ company_name: co });
  const f = r.edgar?.financials?.[0];
  const ok = f && f.fy >= 2024 && f.revenue > (co==='Microsoft'?2e11:5e9);
  P('002', `${co}: FY${f?.fy} $${(f?.revenue/1e9).toFixed(1)}B ni=${f?.net_income!=null?'$'+(f.net_income/1e9).toFixed(1)+'B':'null'} → ${ok?'PASS':'FAIL'}`);
}
// ── 008 (FIXED) ──
for (const a of ['FEMA','CBP']) {
  const r = await queryExpiringContracts({ agency:a, monthsWindow:24, limit:5 });
  P('008', `agency="${a}" → ${r.contracts.length} rows ${r.contracts[0]?.awarding_sub_agency||''} → ${r.contracts.length>0?'PASS':'FAIL'}`);
}
const combo = await queryExpiringContracts({ agency:'FEMA', naics:'541', monthsWindow:24, limit:5 });
P('008', `combo FEMA+541 → ${combo.contracts.length} rows → ${combo.contracts.length>0?'PASS':'FAIL(regression)'}`);
// ── 004 (FIXED) ──
const cap = await capabilityMarketMatch({ client_name:'MINDY (getmindy.ai)', description:'MINDY is an AI platform. MINDY does market research for federal contractors.', capabilities:['MINDY market research'] });
const lead = cap.market?.lead_keyword;
P('004', `lead_keyword="${lead}" brandInKw=${cap.keywords?.some(k=>/mindy/i.test(k))} → ${(!/mindy/i.test(lead||'') && !cap.keywords?.some(k=>/mindy/i.test(k)))?'PASS':'FAIL'}`);
P('004', `competitors: ${JSON.stringify((cap.competitors||[]).slice(0,2).map(c=>c.recipient_name||c.name))}`);

// ── 003 (FIXED, batch2) ──
for (const q of ['Owens & Minor','Owens and Minor']) {
  const om = await getIncumbentFinancials({ company_name:q });
  const f = om.edgar?.financials?.[0];
  P('003', `"${q}" grounded=${om._meta?.grounded} ${f?`FY${f.fy} $${(f.revenue/1e9).toFixed(2)}B`:''} → ${om._meta?.grounded?'PASS':'FAIL'}`);
}
const priv003 = await getIncumbentFinancials({ company_name:'Zzqx Nonexistent Private Holdings LLC' });
P('003', `private honest-miss grounded=${priv003._meta?.grounded} → ${priv003._meta?.grounded===false?'PASS':'FAIL(fabricated)'}`);

// ── 009 (FIXED, batch2) ──
const sam = await runMcpTool('search_sam_opportunities', { keyword:'market research', limit:8 }, { userEmail:'eric@govcongiants.com' }).then(r=>r.result||r);
const titles = (sam.items||sam.results||sam.opportunities||[]).map(o=>o.title||'');
const titleHits = titles.filter(t=>/market research/i.test(t)).length;
P('009', `market-research title hits ${titleHits}/${titles.length} → ${titleHits>=Math.min(6,titles.length)?'PASS':'FAIL'} | top: ${JSON.stringify(titles.slice(0,3))}`);
const jan = await runMcpTool('search_sam_opportunities', { keyword:'janitorial', limit:5 }, { userEmail:'eric@govcongiants.com' }).then(r=>r.result||r);
P('009', `body-only "janitorial" count=${jan.count} → ${jan.count>0?'PASS':'FAIL(over-narrowed)'}`);

// ── 005 (FIXED, batch3) — market research must NOT lead pharma ──
const mr = await keywordCoverage('market research');
const mrLead = String(mr?.allNaics?.[0]?.code||'');
P('005', `"market research" lead=${mrLead} (${mr?.allNaics?.[0]?.name}) → ${mrLead.startsWith('5419')?'PASS':'FAIL(pharma back)'}`);
// NOTE: drones→339930 is the DOCUMENTED promoted-lead behavior (topCodePct vs
// leadCodePct), so it's intentionally NOT in this regression assert list.
for (const [kw, exp] of [['hvac','238'],['welding','333'],['janitorial','561'],['landscaping','561'],['security guard','561'],['demolition services','562']]) {
  const c = await keywordCoverage(kw); const lead = String(c?.allNaics?.[0]?.code||'');
  P('005', `regression "${kw}" lead=${lead} → ${lead.startsWith(exp)?'PASS':'FAIL'}`);
}

// ── 010 (FIXED, batch3) — parent, not subsidiary ──
const led = await runMcpTool('get_contractor_award_history', { company:'Leidos', award_limit:5 }, { userEmail:EMAIL }).then(r=>r.result||r);
const lm = led.history?.match;
P('010', `Leidos → "${lm?.name}" ${lm?.confidence} → ${/leidos,?\s*inc/i.test(lm?.name||'') && lm?.confidence==='high' ? 'PASS':'FAIL(subsidiary/medium)'}`);
for (const co of ['Lockheed Martin','Raytheon','Northrop Grumman']) {
  const r = await runMcpTool('get_contractor_award_history', { company:co, award_limit:5 }, { userEmail:EMAIL }).then(x=>x.result||x);
  P('010', `${co} → "${r.history?.match?.name}" ${r.history?.match?.confidence}`);
}

// ── 007 (PARTIAL, batch4) — naics_description derived; psc/description honest-null ──
const ec = await queryExpiringContracts({ naics:'541512', monthsWindow:24, limit:10 });
const withNaicsDesc = ec.contracts.filter(c=>c.naics_description).length;
const nullPsc = ec.contracts.filter(c=>!c.psc_code).length;
P('007', `naics_description ${withNaicsDesc}/${ec.contracts.length} → ${withNaicsDesc===ec.contracts.length?'PASS':'FAIL'}`);
P('007', `psc_code null ${nullPsc}/${ec.contracts.length} (honest miss — needs detail-endpoint backfill, expected)`);

// ── 007 APP-ROUTE REACH (PR #652) — the in-app /api/recompete route has its OWN
//    query path (doesn't import queryExpiringContracts), so it needed the same
//    getNaics derivation mirrored. This one is PROD-only (live route), so it's a
//    fetch, not runMcpTool. PASS = the app route also populates naics_description.
try {
  const appRes = await fetch('https://getmindy.ai/api/recompete?naics=541512&months=24&limit=5');
  const j = await appRes.json();
  const rows = j.contracts || j.results || j.vehicles || [];
  const appDesc = rows.filter(r => r.naics_description).length;
  P('007-app', `/api/recompete naics_description ${appDesc}/${rows.length} → ${rows.length>0 && appDesc===rows.length ? 'PASS' : 'FAIL (deploy not live yet? re-run)'}`);
} catch (e) { P('007-app', `fetch failed: ${e.message}`); }
```

---

## What to report back
- **002/003/004/005/008/009/010 all PASS** → the shipped fixes hold on this build. Done.
- **007 still shows the bug** → correct; it's a data backfill, not a code fix.
- Any FIXED-ticket **FAIL** → real problem, flag it. For 003, a FAIL is likely EDGAR
  rate-limiting the company-search fallback (a live per-query HTTP call) — re-run once.
  For 009, a FAIL (boilerplate back on top) = the title-pass regressed. For 005, a FAIL on a
  regression keyword = the corroboration guard is too aggressive. For 010, a subsidiary/medium
  = the exact-match preference regressed.
- Any **007 unexpectedly PASS** → surprising; means the backfill ran — investigate before trusting.

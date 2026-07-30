# MCP Fix Check-Pack — verify the MINDY-002/004/008 fixes (PR #645)

**Purpose:** independently confirm the 3 shipped fixes (and confirm the 5 still-open tickets are
genuinely still open, not silently "fixed" in a doc). Run the script → compare to the expected
table. Same discipline as the repro pack: **trust the live tool output, not the code.**

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

## Still OPEN — these SHOULD still show the bug (proof we didn't fake-fix them)

| ID | Check | Still-broken looks like (expected — NOT yet fixed) |
|----|-------|----------------------------------------------------|
| 005 | capability top_naics | still leads **424210 Drugs & Druggists'** (pharma) — shared keywordCoverage ranking, scoped follow-up |
| 003 | "Owens & Minor" | still grounded=false (ampersand→CIK, not started) |
| 007 | expiring rows | naics_description / psc_code / description still NULL (data backfill, not code) |
| 009 | search "market research" | still returns ambulances/borescopes (boilerplate down-weight, not started) |
| 010 | Leidos award history | still matches LEIDOS BIOMED subsidiary (parent rollup, Low) |

---

## The script (`./_check.mjs`)

```js
import { config } from 'dotenv'; config({ path: '.env.local' });
const { runMcpTool } = await import('@/lib/mcp/tool-registry');
const { getIncumbentFinancials } = await import('@/mcp/tools/incumbent-financials');
const { queryExpiringContracts } = await import('@/lib/recompete/query');
const { capabilityMarketMatch } = await import('@/mcp/tools/capability-market-match');
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

// ── STILL OPEN (expect the bug) ──
P('005', `top_naics[0]=${cap.market?.top_naics?.[0]?.code} (expect 424210 = STILL OPEN)`);
const om = await getIncumbentFinancials({ company_name:'Owens & Minor' });
P('003', `Owens & Minor grounded=${om._meta?.grounded} (expect false = STILL OPEN)`);
const ec = await queryExpiringContracts({ naics:'541512', monthsWindow:24, limit:10 });
const nulls = ec.contracts.filter(c=>!c.naics_description&&!c.psc_code&&!c.description).length;
P('007', `${nulls}/${ec.contracts.length} rows NULL desc/psc (expect all = STILL OPEN)`);
const sam = await runMcpTool('search_sam_opportunities', { keyword:'market research', limit:5 }, { userEmail:'eric@govcongiants.com' }).then(r=>r.result||r);
P('009', `titles: ${JSON.stringify((sam.results||sam.opportunities||[]).slice(0,3).map(o=>o.title))} (expect boilerplate = STILL OPEN)`);
```

---

## What to report back
- **002/004/008 all PASS** → the shipped fixes hold on this build. Done.
- **005/003/007/009 still show the bug** → correct; those are the scoped follow-ups, not regressions.
- Any **002/004/008 FAIL** → real problem, flag it (likely a cache artifact — EDGAR is cached 24h; re-run).
- Any **005/003/007/009 unexpectedly PASS** → surprising; means something else fixed it — investigate before trusting.

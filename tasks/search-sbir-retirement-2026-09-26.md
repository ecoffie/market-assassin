# Retirement of Mindy's DEDICATED SBIR/STTR search — final packet (2026-09-26)

**Decision (Eric, 2026-09-26):** retire **Mindy's dedicated SBIR/STTR search** on every surface that offered it. This is **not** a retirement of all SBIR-related discovery: Grants.gov funding announcements, including agency SBIR/STTR FOAs, stay searchable in the Grants panel, a separate and supported source. Keep the
shared NIH/SBIR libraries and all stored data. PR **#1710**. **Stop before merge/deploy.** No
credits and no customer messages: Louis's proposed 105-credit correction remains a separate,
unauthorized item.

**Why:** investigation packet `tasks/sbir-reed-investigation-2026-09-26.md`, carried here from the
closed #1708. No SBIR surface had a working source of OPEN topics:
- the DoD topic cache never received a row;
- the multisite `sbir_sttr` slice is 42/42 NIH RePORTER award pages;
- NIH RePORTER is itself an award index.

**One notice for every surface:** `src/lib/sbir/retired.ts` (`SBIR_SEARCH_RETIRED`,
`sbirSearchRetiredMessage`, `sbirSearchRetiredBody`). It points users to SBIR.gov topics, DoD DSIP,
and Mindy's Grants panel for SBIR funding announcements posted on Grants.gov.

## Surfaces

| Surface | Before (production, measured 2026-09-26) | After (this branch) |
|---|---|---|
| MCP `search_sbir` (hosted `mcp.getmindy.ai/mcp`) | listed; 5 credits; default returned NIH awards as `opportunities` | absent from `tools/list`, catalogs and pricing. A stale call gets `tool_retired` (`isError:false`), logged `retired`, 0 credits, never dispatched |
| In-app SBIR panel (`/briefings`, sidebar "SBIR/STTR") | Pro nav item → `SbirPanel` → `/api/sbir` | nav item removed and `SbirPanel.tsx` deleted; the stats-bar tab mapping removed. Any residual `activePanel='sbir'` renders the retired notice with links |
| `/api/sbir` (GET/POST) | **HTTP 200.** `?keyword=cybersecurity` → 5 NIH RePORTER awards, e.g. "AmblyoGo … Occlusion Dose Monitor", `endDate` 2028-05-31 | **HTTP 410** with the shared JSON notice (`code: sbir_search_retired`), `Cache-Control: no-store`. Reads nothing |
| Opportunity Map SBIR source | client asked `sources=sam,sbir`; `countsBySource.SBIR = 0` (empty cache — latent); "SBIR/STTR" option in the "Where it came from" filter | server ignores `sources=…,sbir` (accepted, contributes nothing); client asks `sources=sam`; SBIR removed from the source filter (`template.html`, `template-html.ts` regenerated) |
| `/api/market-scan` | `includeSbir` defaulted ON → multisite NIH rows returned as `sbirOpportunities` (no UI caller; directly callable) | never fetched; `sbirOpportunities: []` plus `sbir: { retired: true, … }`; "NIH RePORTER" dropped from `dataSources` |
| Mindy Chat system prompt | claimed "…grants, SBIR/STTR" under OPPORTUNITIES; tools come from `listMcpTools()` | claim removed. A new line says SBIR/STTR open-topic search is not available, where to go instead, and never to present awards as open topics. `search_sbir` is already absent from its tool list |
| AI briefing generator (multisite fetch) | **ACTIVE path.** `precompute-briefings` runs nightly (enabled; 200 on 09-24/25/26), finds 179 profiles and calls `generateAIBriefing`, whose multisite fetch runs **before** the LLM. No template has been saved since 2026-06-29 **only** because every LLM provider returns 404 model_not_found (`briefing_precompute_runs` 2026-09-26: 0 generated / 2 failed, while the cron reports `success`) | the fetch excludes `opportunity_type='sbir_sttr'` (`excludeOpportunityTypes`), so the retired slice cannot enter a briefing when the LLM path is repaired |
| Marketing / upgrade copy | `/market-intelligence` "Forecasts, SBIR, Grants"; `/agencies` "…NIH RePORTER, SBIR/STTR…"; `/briefings` upsell "SBIR/STTR intel" | SBIR claims removed |

## Kept on purpose (and why)

| Item | Reason |
|---|---|
| Grants panel "SBIR/STTR" chip (`GrantsPanel.tsx`) | Different, **supported** source: Grants.gov search. Measured on production, `/api/grants?keyword=SBIR` → 22 **posted** announcements with future close dates (e.g. NIH REACH, close 11/10/2026; DARPA DSO BAA, close 08/27/2027). Open funding, not award history |
| `src/lib/sbir/search.ts`, `dod-sbir.ts`, `sbir-map-pins.ts`, `src/lib/scrapers/apis/*` | shared libraries (instruction: preserve) |
| `sync-dod-sbir` cron, `dod_sbir_topics`, `aggregated_opportunities`, logs | stored data and parked feeds (instruction: untouched) |
| `src/mcp/tools/sbir.ts` | unregistered; nothing imports it |
| Informational mentions: NASA SBIR tip on `/agencies/[slug]`, the `budget-intel` keyword list, the `potato-journey` jargon list, `engagement.SBIR_SEARCH` / `surface-registry` ids | not search entry points. The analytics ids keep historical events readable |

**Briefing generator — why it was fixed, not deferred.** Saved templates showing zero SBIR/NIH
mentions did **not** establish that the path was inactive, and it is not inactive:
- it runs nightly and reaches the multisite fetch;
- only an unrelated LLM outage stops its output being saved.

So the retired `sbir_sttr` slice is now excluded at the fetch. Evidence:
- **Read-only live run of the generator's exact fetch** (posted in the last 30 days, limit 25): before
  and after the change, 25 rows, **0** `sbir_sttr`. Today's newest 25 are all `nih_reporter/grant`, so
  current exposure is 0; the exclusion guards the day SBIR rows are among the newest.
- `multisite-sbir-exclusion.unit.test.ts` (3): the filter is applied inside the query; other callers
  are unchanged; the generator requests it. **Mutation:** removing it from the generator turns the
  test red.

**Flagged for decision (NOT changed — parked Research & Lab feed, not Mindy's dedicated SBIR search):**
- the same run shows the generator feeds **NIH RePORTER `grant` rows** (funded projects) to the LLM
  as "R&D opportunities" — the same award-shown-as-opportunity class;
- the cron reports `success` while generation fails 100% — the *dead operation reported as success*
  class.

## #1708 — closed unmerged

The instruction: keep #1708 only for repairs that retained consumers still need.

| #1708 change | Retained consumer after this PR |
|---|---|
| `src/lib/sbir/search.ts` classification / budget / sanitizer | **none** — the only importer is the unregistered `src/mcp/tools/sbir.ts`, which nothing imports |
| wrapper + its tests | none (tool retired) |
| `scripts/verify-sbir-search.ts` | none |

So #1708 is **closed unmerged**. Its branch `fix/sbir-open-topics-vs-award-history` is kept for
reference, and its evidence packet is carried into this PR. The multisite `set_aside_type` bug also
existed in the old `/api/sbir`, which is now replaced by the 410.

## Verification — MCP, stale calls, panel and direct API together

**A. Unit / integration (real handlers where possible):**
- `sbir-search-retirement.unit.test.ts` (14):
  - the **real `/api/sbir` handler** answers 410 with the shared body for GET and POST, and contains
    no data access;
  - `SbirPanel.tsx` is deleted and not imported; there is no sidebar item; no `setActivePanel('sbir')`;
    the residual notice renders; upsell copy is clean;
  - the map gate is permanently off, the client stops requesting `sbir`, and the SBIR facet is gone
    in both the template and the generated file;
  - market-scan never fetches SBIR; chat and marketing copy are clean;
  - the MCP entry reuses the shared notice; shared libraries still exist.
- `route.retired-tool.unit.test.ts` (5, **real mcp-handler + SDK**):
  - `tools/list` omits `search_sbir`;
  - a stale call returns `tool_retired`, is logged `retired`/0, and `runMeteredTool` is **not called**;
  - an unrelated tool still dispatches;
  - an unauthenticated call → 401;
  - a batch never dispatches.
- `retired-tools.unit.test.ts` (5, real registry) and the `metered.unit.test.ts` retired case (no
  balance read, no run, no debit).
- `sbir-map-pins.unit.test.ts`: updated from "opt-in on `?sources=sbir`" to "accepted but
  permanently off". The fail-soft merge invariant is unchanged.
- **Mutation-proven** earlier on this branch: removing the transport intercept turns the stale-call
  test red; re-grouping the name turns the discovery test red.

**B. Local running app on this branch** (`next dev --webpack`, production data read-only; captured
in the session log):
- `GET /api/sbir?keyword=zero trust` → **410** + notice; `POST /api/sbir` → **410** + notice.
- `GET /api/app/opportunity-map?bbox=CONUS&status=active&sources=sam,sbir` → 200, 961 pins, all SAM;
  `countsBySource {SAM:961, DLA:0, SBIR:0}`.
- `GET /api/market-scan?naics=541512` → 200; `sbirOpportunities: 0`; `sbir.retired: true`;
  0 SBIR/NIH rows in `rankedOpportunities`.
- **Panel in a browser:** unauthenticated `/briefings` redirects to `/alerts/signup`, so the sidebar
  cannot render without signing in. I did not sign in: that would write to the production database
  from a local server. The panel is therefore verified by the source-level tests in (A), **not** a
  rendered screenshot.

**C. Stdio discovery** (earlier on this branch): 55 tools, `search_sbir` absent.

**Gates at the pushed head:** recorded in the PR (tsc, test suites, catalog drift, template sync,
silent-failure gate, ledger audit, pre-push gate).

## After release (NOT done — stop before merge/deploy)

Verify **by name**, not by count. The catalog total can change for unrelated reasons.
1. **MCP discovery:** `tools/list` on `https://mcp.getmindy.ai/mcp` — assert no tool is **named**
   `search_sbir`. `GET https://getmindy.ai/api/mcp/catalog` — assert no entry **named**
   `search_sbir`. (Do not rely on "63 tools".)
2. **MCP stale call** (test account): `tools/call search_sbir` → the text contains "retired on
   2026-09-26" and "No credits were charged". Then check:
   - a new `mcp_call_log` row for that account with `tool_name='search_sbir'`, `status='retired'`,
     `credits_charged=0`;
   - **no** new `mcp_credit_ledger` row;
   - the balance is unchanged.
3. **Direct API:** `curl -i https://getmindy.ai/api/sbir?keyword=cybersecurity` → `410` and
   `"code":"sbir_search_retired"` (before release this returned 200 with NIH awards).
4. **Map:** `/api/app/opportunity-map?…&sources=sam,sbir` → `countsBySource.SBIR == 0`, no pin with
   `src=='SBIR'`. The served map HTML contains no `"SBIR"` entry in the source-filter list.
5. **Market-scan:** `/api/market-scan?naics=541512` → `sbir.retired == true`, `sbirOpportunities == []`.
6. **Panel (signed-in navigation):** signed in as a test/staff account on `/briefings`, there is no "SBIR/STTR" sidebar item; the Grants panel's SBIR/STTR chip still returns Grants.gov postings.
6b. **Briefings:** after release, the next `briefing_precompute_runs` row still shows the generator reaching its fetch. If the LLM path is repaired, a saved template contains no `reporter.nih.gov/project-details` link labelled as an SBIR opportunity.
7. **Unrelated tools still work:** e.g. `get_balance`, `search_grants`, `find_opportunities` on MCP;
   the Grants panel "SBIR/STTR" chip still returns Grants.gov postings.
8. **Tool Map artifact:** update the claude.ai artifact so no entry is named `search_sbir`. It is
   deliberately not done before deploy.

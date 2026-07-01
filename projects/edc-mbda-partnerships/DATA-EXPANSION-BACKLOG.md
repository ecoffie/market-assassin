# Mindy Data-Expansion Backlog (standing tracker)

**Purpose:** the data sources Mindy is MISSING vs competitors (found in the HigherGov teardown).
Kept here + in `tasks/todo.md` + in memory so they stay TOP OF MIND as we build — strategy buried
in a doc gets forgotten. Each has a feasibility verdict + a BUILD-WHEN trigger so we add it at the
right time, not on impulse. (Filter through `MINDY-MASTER-STRATEGY.md`: does it serve mass adoption?)

| # | Gap | Feasibility | Value | BUILD-WHEN trigger | Status |
|---|-----|-------------|-------|--------------------|--------|
| 1 | **DIBBS** (~3.3M DLA small-buy NSN/parts RFQs) | ✅ FEASIBLE — scraped via US residential proxy (Apify `parseforge/dibbs-rfq-scraper`, $7/1k). Our own probe failed on the WAF; proxy is the workaround. **Check EULA/ToS before scaling.** (memory `dla_dibbs_not_feasible` — updated) | Med-High: NSN/parts + historical "what price wins" pricing. Helps supplier/manufacturer users. | When (a) supplier/manufacturer users ask, OR (b) the DLA NV012 SBIR makes DLA data strategic. | ✅ **PILOT BUILT (Jun 19)** — awaiting 2 manual steps (below) |
| 2 | **SLED** (state/local — HigherGov: 2.8M opps, 10K+ agencies) | 🟡 HARD — public-records requests + state-portal scraping + residential proxies. Maintenance-heavy. "Nearly impossible" via naive scraping (Eric) — but doable the costly way. | High IF the user base wants SLED. Most Mindy users are federal today. | **Phase 3** (Eric's call) — deliberate investment, NOT before. Trigger: federal product is mature + users ask for state/local. | 🔲 Deferred to Phase 3 |
| 3 | **GSA Advantage / labor-rate pricing** | 🟡 UNKNOWN-but-promising — GSA publishes a lot (catalog prices, labor rates); MORE accessible than DIBBS/SLED. Needs a feasibility probe. **★ NEXT APIFY CANDIDATE after DIBBS proves out** (Eric, Jul 1): once DIBBS validates the residential-proxy scraper pattern + cost model, GSA pricing is the next source to run through the same Apify playbook — reuses the same token/account, no new infra. | High: "what price wins" pricing intel — directly helps users bid (bigger differentiator than raw opp volume). | Trigger: **after DIBBS is live + paying off**, do the feasibility probe (is it a public API/bulk file, or does it need the proxy scraper?) → build if clean. Sooner than SLED. | 🔲 Needs feasibility probe (queued as Apify candidate #2) |

## DIBBS pilot — ACTIVATING (Jul 1 2026)
Pipeline is committed (`8be2075b`). Rents the Apify actor (no scraper to maintain). To activate:
- [x] **1. Run migration** `supabase/migrations/20260619_dibbs_rfqs.sql` — ✅ **DONE + VERIFIED Jul 1**
      (prod `dibbs_rfqs`: 14 columns, 4 indexes, 0 rows; ran "without RLS" — server-only table,
      service-role access, no client reads).
- [ ] **2. Get Apify token** (console.apify.com/account/integrations) → add `APIFY_TOKEN=` to `.env.local`
      (+ Vercel env for the cron). EULA/ToS: **Eric said move forward (Jul 1)** — his business-risk call.
- [ ] **3. Test:** `APIFY_TOKEN=... npx tsx scripts/test-dibbs-pilot.ts` (dry, 20 RFQs) → `--write` if good.
- [ ] **4. Schedule:** add a `sync-dibbs` cron_jobs row (`/api/cron/sync-dibbs?maxItems=200&daysBack=7`,
      `0 * * * *`) once the token's set. (Cron returns 503 until APIFY_TOKEN exists — safe to leave.)
**Files:** `src/lib/dibbs/ingest.ts` (fetch+upsert), `src/app/api/cron/sync-dibbs/route.ts`,
`scripts/test-dibbs-pilot.ts`, migration above. Cost ~$7/1k results, ~$0 until turned on.

## Why these matter (the competitive frame)
HigherGov/Procurement Sciences have all three. Mindy's moat is NOT matching their breadth (they're
going up-market to primes) — it's mass adoption + grounded answers for small biz. So add these ONLY
when they serve the small-biz user, in priority: **GSA pricing (probe soon) → DIBBS (when supplier
users / SBIR pull) → SLED (Phase 3).** Don't chase breadth-for-breadth.

## Process — how these stay top of mind
1. This tracker (the detail).
2. `tasks/todo.md` → "DATA EXPANSION BACKLOG" section (seen every /continue).
3. Memory `mindy_data_expansion_backlog` (Claude surfaces it automatically in future sessions).
Review this list at the start of any data-feature sprint.

*Created June 19 2026 from the HigherGov teardown. Update status as each is probed/built.*

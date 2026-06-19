# Mindy Data-Expansion Backlog (standing tracker)

**Purpose:** the data sources Mindy is MISSING vs competitors (found in the HigherGov teardown).
Kept here + in `tasks/todo.md` + in memory so they stay TOP OF MIND as we build — strategy buried
in a doc gets forgotten. Each has a feasibility verdict + a BUILD-WHEN trigger so we add it at the
right time, not on impulse. (Filter through `MINDY-MASTER-STRATEGY.md`: does it serve mass adoption?)

| # | Gap | Feasibility | Value | BUILD-WHEN trigger | Status |
|---|-----|-------------|-------|--------------------|--------|
| 1 | **DIBBS** (~3.3M DLA small-buy NSN/parts RFQs) | ✅ FEASIBLE — scraped via US residential proxy (Apify `parseforge/dibbs-rfq-scraper`, $7/1k). Our own probe failed on the WAF; proxy is the workaround. **Check EULA/ToS before scaling.** (memory `dla_dibbs_not_feasible` — updated) | Med-High: NSN/parts + historical "what price wins" pricing. Helps supplier/manufacturer users. | When (a) supplier/manufacturer users ask, OR (b) the DLA NV012 SBIR makes DLA data strategic. | ✅ **PILOT BUILT (Jun 19)** — awaiting 2 manual steps (below) |
| 2 | **SLED** (state/local — HigherGov: 2.8M opps, 10K+ agencies) | 🟡 HARD — public-records requests + state-portal scraping + residential proxies. Maintenance-heavy. "Nearly impossible" via naive scraping (Eric) — but doable the costly way. | High IF the user base wants SLED. Most Mindy users are federal today. | **Phase 3** (Eric's call) — deliberate investment, NOT before. Trigger: federal product is mature + users ask for state/local. | 🔲 Deferred to Phase 3 |
| 3 | **GSA Advantage / labor-rate pricing** | 🟡 UNKNOWN-but-promising — GSA publishes a lot (catalog prices, labor rates); MORE accessible than DIBBS/SLED. Needs a feasibility probe. | High: "what price wins" pricing intel — directly helps users bid. | Sooner than SLED. Trigger: do a feasibility probe next data-sprint; build if the data's clean. | 🔲 Needs feasibility probe |

## DIBBS pilot — BUILT, 2 manual steps to turn on (Jun 19)
Pipeline is committed (`8be2075b`). Rents the Apify actor (no scraper to maintain). To activate:
- [ ] **1. Run migration** `supabase/migrations/20260619_dibbs_rfqs.sql` (Supabase SQL editor → "Success").
- [ ] **2. Get Apify token** (console.apify.com/account/integrations) → add `APIFY_TOKEN=` to `.env.local`
      (+ Vercel env for the cron). **Confirm DIBBS EULA/ToS allows it before scaling.**
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

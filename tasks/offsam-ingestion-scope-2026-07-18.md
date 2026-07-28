# Off-SAM opportunity ingestion — scope (2026-07-18)

**Decision locked (Eric, 2026-07-18):** differentiate coverage, don't chase raw count.
Two workstreams: (1) revive DIBBS (paid Apify unblocks it), (2) scope ONE lab **platform**
adapter. This doc is the plan for sign-off before any build.

> **Updated 2026-07-27** — DIBBS surface decision made (**maps**), map wiring built +
> verified (`feat/dibbs-dodaac-locations` / `f3b9247d`), and the "blocked on setting
> APIFY_TOKEN" line corrected: the token is **present but INVALID (401)**, and the pilot was
> **deliberately cost-paused**, not never-started. See the STATUS UPDATE block in Workstream 1.

Companion strategy: `docs/strategy/OPPORTUNITY-DATA-LANDSCAPE.md`. Source registry:
`src/data/agency-procurement-sources.json` (v2, PR #382).

---

## Why "platform," not "one lab"

Eric said *platform*. A bespoke HTML scraper per lab (NREL, Ames, JLab…) is easier per site
but zero reuse. **SAP Ariba Discovery is a genuine platform: one adapter → many buyers.**
- Covers **LANL + ORNL** today (both confirmed on Ariba per the portal research).
- Extends to **any** Ariba Discovery buyer later — other agencies, primes — for free.
- LANL's own page confirms the posting list is **viewable on the public Ariba Discovery
  buyer profile WITHOUT login**; an Ariba account is only needed to *respond*. We only
  need to **surface** the opp + deep link, so **no account is needed for ingestion.**
- Postings are **>$250K competitive subcontracts** — the differentiated, off-SAM FFRDC
  data that is the whole point of "differentiate."
- Headless scrape fits the now-**paid Apify** account (same rig as DIBBS).

Rejected for the pilot: custom HTML boards (fast but no reuse); Oracle iSupplier / Fusion /
PeopleSoft (each is a per-institution deployment, not a shared network — no single adapter).

---

## Workstream 1 — DIBBS revive (cheap, already built)

> **STATUS UPDATE 2026-07-27.** Three corrections to the 07-18 findings below, plus the
> map-surfacing decision. Read this block first — the original text under it is stale where
> it conflicts.
>
> **1. Why it's actually paused (was mis-scoped as "never turned on").** The pilot was
> *deliberately cost-paused* on 2026-07-15 by commit `98849b77` — "hide the DIBBS panel for
> now (pilot paused)". That commit removed the DIBBS nav item from the MI sidebar AND set
> `enabled=false` on the `sync-dibbs` `cron_jobs` row, explicitly *"so the daily Apify
> scraper (paid US residential proxy) stops spending on data that's no longer user-facing."*
> So the cron row DOES exist (`sync-dibbs`, `0 8 * * *`,
> `/api/cron/sync-dibbs?maxItems=500&daysBack=7`) — step 3 below is a one-row
> `enabled=true` flip, not an INSERT.
>
> **2. The `APIFY_TOKEN` blocker is NOT cleared — it is present-but-INVALID.** The var IS
> set in Vercel prod (so `check_env` reports `present:true`, which reads as satisfied and
> isn't). But the actual credential is dead: both the drain runner and a direct
> `GET https://api.apify.com/v2/users/me` return **401 `user-or-token-not-found`**. The
> token in `.env.local` is well-formed (unquoted, 46 chars, `apify_api_` prefix), so this is
> not a parsing artifact — the account was never upgraded to paid, or the token was
> rotated/revoked when the pilot was paused. **Still the one hard blocker.** Note the prod
> env var is almost certainly the same dead token, so the cron would 401 too if flipped on
> now — re-set BOTH before enabling.
>
> **3. The daily cron was already failing BEFORE it was disabled.** Sync history by day:
> Jul 8 = **860 rows** (the one good manual drain), then Jul 9–15 = **1–2 rows/day**, then
> nothing. That dribble is the free-tier/WAF starvation signature the drain script's own
> header warns about ("runs SUCCEED but commit only ~1 item"). The daily cron never
> functioned as a real accumulator. Don't treat "re-enable the row" as sufficient — prove
> yield first (step 2).
>
> **Data staleness (the reason this matters now):** of 895 rows, **884 (98.8%) are past
> their `return_by_date`**. 613 expired on Jul 15 alone. Only ~11 are still open. DIBBS RFQs
> are ~2-week-fuse quote requests, so the corpus is effectively a graveyard until ingestion
> resumes.
>
> **SURFACE DECISION (Eric, 2026-07-27): DIBBS goes back, surfaced in the new maps system.**
> That's the user-facing justification the Jul-15 pause was waiting on. Reviving ingestion
> without un-hiding the surface would mean paying daily for data nobody can see — the exact
> thing `98849b77` stopped. So the revive and the surface land together.
>
> **Map wiring is DONE and merged-ready** — branch `feat/dibbs-dodaac-locations`, commit
> `f3b9247d`:
> - **The map UI already supported a `DLA` source all along** — `SRCLABEL.DLA = "DLA supply"`,
>   `.chip.DLA`, `--dla`/`--dlac` colors, a `"DLA Supply/Parts"` category, and a "Where it
>   came from" filter entry. The backend just never supplied a `src:'DLA'` pin, so that
>   filter was permanently empty. Nothing new was designed; it was wired.
> - **The blocker was geography:** `dibbs_rfqs` has NO location column (14 columns, none
>   geographic) and `raw`'s 19 keys have none either. `buyer` is a 1–3 char internal
>   buyer-desk initial ("ME", "S", "HEA"), 100+ distinct values, no geographic meaning.
> - **Fix:** the first 6 chars of a DIBBS solicitation number ARE the purchasing office's
>   DoDAAC. New `src/data/dla-dodaac-locations.ts` maps **60 DLA DoDAACs** →
>   office/city/state/ZIP/coords; location is derived at **query time** from the prefix —
>   no column, no migration, no backfill. Retroactive on all 895 rows, automatic on future ones.
> - **Grounding (rule #1):** city/state/ZIP from SAM `raw_data->officeAddress` majority-vote
>   per prefix (83–100% consensus, nearly all 100%, over 55K+ real records; <5-record offices
>   excluded); office names cross-confirmed by TWO independent sources that agree exactly
>   (`dodaac_directory` from FPDS + USASpending `office_agency_name`); coords from the
>   existing `us-zip-coords.json`. **A hand-written first pass put the
>   `SPE2D*`/`SPE3SE`/`SPE8E8` families in Columbus — grounding proved they are Philadelphia
>   (DLA Troop Support). 4 of 10 offices would have been on the wrong side of the map.**
> - **Honesty constraints:** pins are the BUYING OFFICE, not place of performance, so every
>   DIBBS pin carries `locSrc:'office'` (same flag SAM office-fallback pins use) and they
>   cluster on Richmond/Philadelphia/Columbus — **NOT nationwide**. Label the layer
>   accordingly or the map implies spread that isn't there. Unmapped DoDAAC → **no pin**,
>   never a placeholder, and it's `console.warn`'d so a coverage gap doesn't read as "no
>   data". `naics` left EMPTY (DIBBS is FSC/NSN-coded — no cross-walk guess); `set` = `'NONE'`
>   (DIBBS carries no set-aside field). Only OPEN RFQs are pinned.
> - **Opt-in:** `?sources=sam,dla` on `/api/app/opportunity-map`, so existing callers keep
>   their exact SAM-only payload; a DIBBS failure is caught independently and can never take
>   down SAM pins.
> - **Verified:** `tsc --noEmit` clean; eslint 0 errors; **204/204 unit tests** across 26
>   files (no regressions); scripted audit of all 60 entries vs `us-zip-coords.json` = **0
>   coordinate mismatches** (it caught and fixed 26 entries typed wrong by hand); lookup
>   resolves **895/895 (100%)** of live rows, 0 unmapped; `getDibbsMapPins()` against the live
>   DB returns 3 pins, 0 malformed, jitter deterministic across two calls.
> - **Only 3 pins render today** — the plumbing is proven, but 884/895 rows are expired. The
>   map fills in the moment ingestion resumes; it cannot before that.
>
> **Revised step order (supersedes the 4 steps below):**
> 1. Get a VALID paid-tier Apify token (console.apify.com → Settings → API & Integrations).
>    Set it in `.env.local` AND Vercel prod; redeploy so prod binds.
> 2. **Prove yield before spending on a schedule:** sizing run first, no DB write —
>    `APIFY_TOKEN=… npx tsx scripts/dibbs-full-current-drain.ts --size`. Healthy = hundreds.
>    If it returns ~1, the WAF/proxy is throttled — STOP, wait hours, do NOT loop (the script
>    header is emphatic; a burst is how the Jul-8 damage happened).
> 3. Real drain: drop `--size`, add `--max=5000`. Verify `dibbs_rfqs` climbs past 895 AND
>    that new rows carry **future** `return_by_date`s (row count alone is not health).
> 4. Curl the prod route for 200 + real JSON (rule #5: route proven BEFORE the cron row goes
>    live), then flip `enabled=true` on the existing `sync-dibbs` row.
> 5. Un-hide the surface: revert the one nav item in `UnifiedSidebar.tsx` from `98849b77`,
>    and/or ship `feat/dibbs-dodaac-locations` so the map layer is live.
> 6. Verify day-over-day accumulation actually happens (the thing that never worked before).

**Finding (2026-07-18, partly superseded — see block above):** the pipeline is complete and
paid-tier ready. `src/lib/dibbs/ingest.ts` already requests `maxItems` up to 1000 through a
US residential proxy; `FREE_TIER_CAP=10` is only a **warning log**, not a cap. The cron
`GET /api/cron/sync-dibbs` 503s solely when `APIFY_TOKEN` is unset — **no code change needed.**
_(Correction: it was cost-paused, not "never turned on"; and the token is set but invalid.)_

**Steps (operational only) — superseded by the revised order above:**
1. Set **`APIFY_TOKEN`** (paid account) in Vercel prod; redeploy so it binds.
2. Manual run: `GET /api/cron/sync-dibbs?maxItems=1000` → confirm it returns **>10 items**
   (no free-tier warning in logs) and `dibbs_rfqs` grows past **895**.
3. ~~Add a **`cron_jobs`** row~~ → the row already exists; flip `enabled=true`.
4. Verify: `npm run db -- dibbs_rfqs --count` climbs day over day.

**Effort:** ~half a day, mostly config + verify. **Risk:** low-to-moderate — the paid
residential proxy is the WAF answer, but the Jul 9–15 dribble proves a starved/throttled run
LOOKS like success while committing ~1 item. Always size before scheduling.

---

## Workstream 2 — Ariba Discovery adapter (the differentiated build)

Mirror the DIBBS pattern (Apify actor → normalize → durable Supabase table → dispatcher cron
→ surface in Mindy). New lib `src/lib/ariba/ingest.ts`.

### 2a. Spike — access + structure (DONE 2026-07-18, findings below)

**✅ LANL confirmed feasible.** Public Ariba Discovery profile, buyer **ANID `AN01460290704`**:
- `https://service.ariba.com/Discovery.aw/ad/profile?key=AN01460290704`
- Renders **31 active postings, NO login**, structured: title, dollar band, close date, deep
  link. WebFetch read the list (server-rendered enough to parse — a plain fetch may work; use
  Apify residential proxy anyway in case Ariba WAFs automated traffic).
- Real off-SAM subcontract work + varied bands, incl. **below** $250K (e.g. "HPC Storage
  Technical Services" $100–500K close 28 Feb 2026; "Stack Emissions Testing" $100–500K; "Wire
  EDM Machine Support" <$1K). Paged 10/profile → 31 total = ~4 pages to walk.

**⚠️ ORNL is NOT an Ariba Discovery public-profile buyer — assumption corrected.** ORNL uses
Ariba only as the **response** system ("ORNL Buy"); its opportunity **LIST lives on its own
page** `https://smallbusiness.ornl.gov/business-opportunities` (subscribe for emails). So ORNL
needs a **separate custom-HTML scraper**, not the Discovery adapter.

**Reuse thesis refined:** the "one adapter, N labs" framing was half wrong at the lab level —
Discovery profiles are **per-buyer**, and only some labs publish to Discovery. The real reuse
is **across the whole discovery.ariba.com network** (agencies, primes, universities, LANL) —
LANL is the validated DOE **entry point** to a network adapter, not a lab-shared profile.

**Still open (finish in the build's first hour):** SAM cross-post rate for LANL postings;
confirm plain-fetch vs headless (WAF); the exact paging param (`?awpp=`/`awrr=`).

### 2b. Full adapter (only if spike is green) — ~2–3 days
- **Table:** new `offsam_opportunities` (KEEP separate from `sam_opportunities` — different
  provenance + bid mechanism). Columns incl. `source` ('ariba_discovery'), `source_buyer`
  ('LANL'/'ORNL'), `source_posting_id`, dates, deep link, `raw`, `fetched_at`.
- **Dedup:** by `(source, source_posting_id)`. Flag SAM cross-posts, don't merge in v1.
- **Cron:** dispatcher `cron_jobs` row, daily, resumable/budget-bounded.
- **Surface in Mindy (the differentiation shows up here):**
  - Search corpus (`mi-dashboard`) with a **"Subcontract · Ariba"** badge.
  - Alerts: **opt-in + distinctly labeled** — these are teaming/subcontract, NOT prime work;
    do not fold them into the prime daily alert unlabeled.
  - Position as the wedge: *"subcontract opportunities on FFRDC work you won't see on SAM."*
- **Change-tracking = the moat (not optional):** snapshot due-date/status changes over time
  like `recompete_changes`. A snapshot is public content; tracking what changes is the moat.
  Build this in from day one, or the pilot is just more content.

**Mirror rule:** if this feeds Mindy, it must also be exposed as an **MCP tool / shared lib**
(memory `mindy-fixes-mirror-to-mcp`) — likely a `search_offsam_opportunities` tool.

---

## Sequencing & honesty

- Run **DIBBS revive** and the **Ariba spike** in parallel (DIBBS is config; spike is research).
- **Don't oversell volume.** Competitive >$250K subcontracts are not high-count. That's fine —
  this is *differentiation*, not count. Say so; the honest framing is the wedge.
- Nothing here is wired yet. This doc = plan for sign-off.

**Surface decision (Eric, 2026-07-18):** **separate Teaming view first** — hold Ariba
subcontract opps in their own view until quality/volume is proven, then graduate to opt-in
labeled alerts. Keeps subcontract work out of the prime daily alert.

# Off-SAM opportunity ingestion — scope (2026-07-18)

**Decision locked (Eric, 2026-07-18):** differentiate coverage, don't chase raw count.
Two workstreams: (1) revive DIBBS (paid Apify unblocks it), (2) scope ONE lab **platform**
adapter. This doc is the plan for sign-off before any build.

> **Updated 2026-07-28 — Workstream 1 (DIBBS) is ✅ COMPLETE and live on prod.** New paid
> Apify token, drained 895 → **5,404 rows / 4,379 open**, daily cron re-enabled, PR #539
> merged (`a5803752`), DIBBS pins verified on the map. Root cause was a **dead token that
> `check_env` reported as `present:true`** — presence ≠ validity. Full record in the
> ✅ REVIVE COMPLETE box under Workstream 1.
>
> **Workstream 2 (Ariba Discovery adapter) is still UNSTARTED** — the spike findings below
> stand; the build has not begun.

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

## Workstream 1 — DIBBS revive ✅ **COMPLETE (2026-07-28)**

> ## ✅ REVIVE COMPLETE — 2026-07-28
>
> Shipped and verified on prod. DIBBS is live on the opportunity map as a distinct `DLA`
> source. Everything below this box is the historical record of how it got here; **this box
> is the current state.**
>
> **Root cause of the whole outage: the Apify token was DEAD (401), not merely unset.**
> `check_env` reported `present:true` in Vercel prod the entire time because it never reveals
> the value — so "present" masked a dead credential in BOTH `.env.local` and prod. That is
> why the Jul 9–15 runs dribbled 1–2 rows/day and then stopped. Lesson for next time:
> **presence ≠ validity — curl `https://api.apify.com/v2/users/me` before believing an env var.**
>
> **What ran (in this order — rule #5: route proven BEFORE the cron row goes live):**
> 1. New paid token validated: `GET api.apify.com/v2/users/me` → **200** (was 401).
> 2. Sizing run, no DB write: **5,000 fetched (4,512 unique) in 37s** — the proof the paid
>    tier fixed the yield (vs 1–2/day). Hit the 5,000 `maxItems` ceiling; **did NOT loop it**
>    (the script header is emphatic — bursting is what triggered the WAF damage on Jul 8).
> 3. Real drain (`--max=5000`): upserted 4,512.
> 4. Updated `.env.local` AND the Vercel prod env var (both held the dead token).
> 5. Redeployed prod so the env var binds (env vars only bind on a new deployment).
> 6. Verified the prod route: `GET /api/cron/sync-dibbs?maxItems=1000` → **HTTP 200**
>    `{"success":true,"fetched":1000,"upserted":821}`. Total stayed 5,404 → nearly all
>    updates, i.e. the idempotent dedupe-on-`solicitation_number` upsert working.
> 7. **THEN** flipped `enabled=true` on the existing `sync-dibbs` `cron_jobs` row
>    (hand-run SQL — this DB has no in-app DDL). Verified: `enabled:true`, `locked_at:null`.
> 8. Merged PR **#539** (`a5803752`) + deployed → pins live.
>
> **Data before → after:**
>
> | | before | after |
> |---|---|---|
> | total rows | 895 | **5,404** |
> | **open** (future `return_by_date`) | 11 | **4,379** |
> | distinct DoDAACs | 10 | **41** |
> | latest deadline | Aug 7 | **Aug 27** |
>
> **Prod verification of the map (not just "it deployed"):**
> - legacy `?sources=sam,dla` → `countsBySource {SAM:200, DLA:200}`
> - viewport CONUS-east → `{SAM:1000, DLA:399}`; Philadelphia → `{SAM:534, DLA:101}`;
>   **California → `{SAM:415, DLA:0}`** ← the meaningful one: bbox filtering genuinely
>   excludes out-of-view pins (no DLA buying office in CA), rather than dumping all of them.
> - explorer page HTTP 200 with all three wiring pieces in the shipped HTML: `sources=sam,dla`
>   in the fetch, the `toRow` fix `p.src==='DLA'?'DLA':'SAM'`, and `SRCLABEL.DLA`.
> - **The DoDAAC lookup held on fresh data — the real test.** Fresh ingest brought 31 DoDAACs
>   absent from the original 895-row corpus; the 60-code table resolved **1000/1000 (100%),
>   0 unmapped**. Columbus + Cherry Point only appear because the table was built broader than
>   the 10 codes then observed. Building for the superset paid off exactly here.
>
> **The sidebar DIBBS panel stays HIDDEN — deliberately.** Eric, 2026-07-27: the map IS the
> surface. An earlier plan to un-hide the panel was reverted as unnecessary work — the panel
> is a second, redundant view of the same table, and reviving ingestion is justified by the
> map alone. Do not "restore" it without a fresh reason.
>
> **⚠️ WATCH ITEM (first check after 08:00 UTC 2026-07-28):** the daily cron pulls
> `maxItems=500&daysBack=7`, but the manual drain hit its 5,000 ceiling — **more current RFQs
> exist than one run fetches.** Confirm (a) `last_status` flipped to `success`, and (b) total
> rows climbed past 5,404. The failure mode to watch for is the Jul 9–15 pattern: **a starved
> or throttled run LOOKS like success while committing ~1 item.** Row count alone is not
> health — check that new rows carry FUTURE `return_by_date`s. `/backfill-status dibbs` is
> exactly this check.
>
> **Known limits (state honestly, don't oversell):** pins are the **buying office, not place
> of performance** (`locSrc:'office'`), so they cluster on the DLA centers — Columbus /
> Richmond / Philadelphia / Cherry Point — and will never show SAM's nationwide spread.
> `totalInView` exceeds returned pins because SAM caps at 1,000/view (`capped:true` signals
> it, clustering handles density) and DIBBS is separately capped at 400/request, so the
> deepest views show a subset of the 4,379 open RFQs.

---

### Historical record — the 07-27 diagnosis (kept for the audit trail)

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

- ~~Run **DIBBS revive** and the **Ariba spike** in parallel~~ → **DIBBS revive is DONE
  (2026-07-28, live on prod).** Ariba remains the only open workstream here. Its spike
  findings (2a) are recorded; the 2b build has not started.
- **Don't oversell volume.** Competitive >$250K subcontracts are not high-count. That's fine —
  this is *differentiation*, not count. Say so; the honest framing is the wedge.
- Nothing here is wired yet. This doc = plan for sign-off.

**Surface decision (Eric, 2026-07-18):** **separate Teaming view first** — hold Ariba
subcontract opps in their own view until quality/volume is proven, then graduate to opt-in
labeled alerts. Keeps subcontract work out of the prime daily alert.

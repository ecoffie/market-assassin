# Current state: priority order, in-flight work, pending tasks

> Moved verbatim from the root `CLAUDE.md` on 2026-11-17 (instruction cleanup). Nothing was removed; wording changed only where marked **[Release control 2026-11-17]**. Root `CLAUDE.md` rule 15 overrides anything here.

## 🎯 Current priority order — READ BEFORE PICKING UP WORK

**Set by Eric, 2026-08-23. This is the ONE place the roadmap lives** — permanent docs
deliberately don't restate it, because a stale hierarchy is exactly the confidently-wrong
instruction that misdirects a fresh session.

> **SBDC + SAME speaking campaign → government follow-ups from Navy/NAPEX → product work
> validated by those conversations → operational integrity debt**

⚠️ **Navy and NAPEX are FINISHED.** They no longer govern the roadmap; what remains from them
is FOLLOW-UP, not preparation. Any instruction still treating a Navy/APEX demo as an upcoming
deadline is stale — ignore it and fix it.

**The near-term objective is to turn Mindy's intellectual property into SPEAKING AUTHORITY.**
For SBDC and SAME, the Institute, the Observatory, Market Research, Supplier Discovery,
Competition Health and the accumulated evidence are no longer just product features — they are
**the substance behind Eric's talks**.

**So the test for new build work is: does this support the campaign, or does it create another
internal surface?** Prefer the former. Default to NO on analytics cleanup and new internal
dashboards unless something is **materially broken**.

- **Measurement integrity is DONE as a project** — it is now a permanent engineering constraint
  (see below), not a workstream. 10/10 claim routes verified. Do not reopen it for tidiness.
- The 10 operational risks and the remaining 118 findings are **ranked by consequence and wait**
  behind the campaign. Exception: something users actually experience (e.g. `daily-alerts`
  delivery) is reliability work, not cleanup.

---

## In-flight work — READ THIS FIRST before re-deriving anything

### Pooled team credits (PR 4B) — BUILT, awaiting approval (2026-09-29)
Record: **`tasks/PRD-pooled-team-credits.md`** (§0 decisions, §10 build status, §11 rollout runbook). Read it; do not re-derive.
- A pool belongs to an org linked to ANY subscription configured with `seat_limit > 1` (not a Team price). Billing membership = explicit `org_members` rows with `team_owner`/`team_member` ONLY — never coach roles, never email domain.
- Funding = `mcp_replenish_pool` (top-up to the monthly allowance, (month, ceiling) claim; annual plans replenish monthly). Pool grants key `pool:<org_id>:<YYYY-MM>` — never the personal `pro:<email>:<month>` key.
- ⛔ Migration `20260929_pooled_team_credits.sql` is NOT applied and the one Team subscriber is NOT migrated; each needs Eric's approval (runbook §11). Apply with `--only`, never bare `--go`.
- ⛔ No public pricing/copy change and no `POOLED_PLAN_DEFAULTS` change until Eric approves the seat-and-credit proposal (private repo `ecoffie/govcon-proposals`, `mindy-pricing/`).

### Solicitation identity sequence — FROZEN 2026-09-20
Sequence: **Solicitation truth ✓ → Family persistence ✓ (lazy only) → Historical discovery ✓ → targeted family backfill later → PAE later.**
- **#1557 Solicitation Truth** — merged, production-proven.
- **#1558 Family v1** — merged. Empty migration applied. Production canary 2026-09-19 PASS: one MASA family (`c870f3c7-dea2-46ef-9943-3018d566afc9`), four versions, current=Amd 0003, customer RFP alias `N0017426R1003` present, Original pursuit (`ce85c48d…` / `hello@icrestiq.com`) kept its `notice_id`. The other MASA pursuit (`kurtgraham@achieversmgt.com`) remains `family_id=null` — proof there was no hidden fleet backfill.
- **#1560 Historical Solicitation Discovery** — merged `0faeef07` 2026-09-20. Production host acceptance: lookup-first on the Indian Head MASA prompt; FIND-first on VA IT; OPEN control `70RTAC26R00000007` stays open / `not_biddable=false`. **Do not reopen #1560.** Future production verification: the serving SHA **contains** the accepted feature SHA (`git merge-base --is-ancestor 0faeef07 <serving-sha>`) **and** live behavior still passes. Do **not** require the production alias to remain on the exact historical SHA.
- **⛔ Backfill blocked.** Do **not** write the 3,729-family targeted backfill. Do **not** write the 44,560-family fleet backfill. Do **not** build a `--go` writer. Do **not** attach remaining pipeline rows. Lazy Family v1 only — persist on known-id / pursuit save / confirmed identity, never a fleet write.
- **PAE later.** Do not start. Do not remove FIND Open `active=true`. Do not auto-merge forecast/award/recompete.

### Maps P0 — speed + correctness (PR #1684, merged 2026-09-25)
Record: **`tasks/maps-p0-performance-2026-09-24.md`** (before/after tables + Recompete query-plan evidence);
audit: `tasks/maps-latency-transition-audit-2026-09-24.md`. ✅ Merged `7ce3a668` + production-verified 2026-09-25 (1 boot round, pan `counts=0` 3/3, cached toggles 0 requests, Start Fresh 0 stale requests). P1/P2 feedback UX follows in #1693 — see the P1 entry below.
- `fetchView()` only SCHEDULES; same-tick calls = one round; rounds are generation-numbered — a superseded
  response never paints (`newest-action-wins.unit.test.ts`, red on the pre-fix route). Never reintroduce a
  busy/pendingFetch queue.
- Horizons paint as each resolves; a horizon loading for a NEW intent reads `loading` (never an old number).
- Horizon cache: pins keyed by full URL, market truth by URL minus bbox (5-min TTL). A pan with a held intent
  sends `counts=0` (`map-counts-mode.ts`) → server omits market-wide fields (`countsSkipped:true`, never 0/null).
- Recompete keyword cost was fixed separately: Gate 1 trigram indexes (applied) + Gate 2 compute-once (see below).

### Maps P1/P2 — instant feedback + Building your market (PR #1693) — ✅ PRODUCTION-PROVEN 2026-09-25
Record: **`tasks/maps-p1-feedback-2026-09-24.md`** (states, matrix, production acceptance) · first load:
`tasks/maps-first-load-investigation-2026-09-25.md`. Merge `24dbb20e`; future verification = serving SHA CONTAINS it
(`git merge-base --is-ancestor 24dbb20e <serving-sha>`) + live behavior. Do not reopen for polish or another perf pass.
#1696 (Open 500) ✅ FIXED by #1706 (`9ee7bb85`, production-proven 2026-09-26): it was a DUPLICATE BOOT ROUND, not a cold start.
- ⚠️ A client abort does NOT cancel the PostgREST/Postgres statement (`authenticator` statement_timeout=8s), so every duplicate round is real DB load. Remove duplicates at the source; never rely on the abort.
- A `moveend` with the same centre and zoom is a LAYOUT move (`layout-move.ts`) and fetches only newly exposed area.
- Auto-fit waits for the round to settle.
- Diagnose boot with `window.__mapBootTrace`; `__mapPerf` only records SETTLED rounds.
- Record: `tasks/maps-boot-round-1696-2026-09-26.md`. #1704 (Open count→pins reuse) is kept DRAFT as a resilience fallback; do not merge without production concurrency evidence.
- #1697 (stale resume pill) is fixed by #1703.
- ⚠️ Building your market is CSS-revealed from the SERVER HTML (`.app mfb-booting`, 300 ms opacity animation) — never
  bring back a JS reveal timer; it waited on the very scripts it covers. The 600-row placeholder `OPPS` ships ONLY for
  `?embed=` (its whole content); the full page ships `OPPS=[]`.
- ⚠️ Measure Maps timing with NATIVE arm64 Chrome (`arch -arm64 … --remote-debugging-port`). Node here is x64, so
  Puppeteer's bundled Chrome runs under Rosetta and inflated every timing 5–40× (the "8 s cold load").
- `market-feedback.ts` is PRESENTATION ONLY — VIEWPORT_JS reports round facts (`begin`/`horizon`/`paint`/`idle`); it
  never fetches or delays data. Thresholds live in `MF_TIMING` (0 bar · 300 spinner · 1 s panel · 3 s Mindy Intel).
- ⚠️ A USER ACTION supersedes in-flight work AT ONCE (`_actionNow()` bumps `_fetchGen`) — the dispatch now yields a
  frame so the acknowledgement paints first, and without the bump an older round painted inside that gap.
  System refetches pass `{system:true}`, pans `{pan:true}` — neither is acknowledged as an action.
- ⚠️ Mark stale with INLINE writes + composited VEILS (z 450, over the map pane, under every control). Measured:
  body/element classes forced 18–260 ms recalcs on a 3k-pin page; fading the content layers cost ~80 ms/round.
- Visible is the DEFAULT state — the page's reduced-motion rule sets `animation:none`, so never reveal via animation.
- Mindy Intel copy lives in `src/lib/maps/mindy-intel.ts` (sourced, horizon-scoped, no superlatives — tested).

### Recompete map performance — Gate 1 ✅ LIVE · Gate 2 designed, NOT deployed (2026-09-24)
Records: **`tasks/recompete-gate1-2026-09-24.md`** (prod before/after) · **`tasks/recompete-compute-once-design-2026-09-24.md`**.
- Gate 1 (#1686, `70bd0600`): page order expiry → `contract_id` (tie-break only; the old order gave up to 5 different
  pages across valid plans) · follow-ons read candidates-first (`map-follow-ons.ts`) so a text index can never drive
  them · six `idx_recompete_trgm_*` GIN indexes APPLIED + verified valid. Prod: software license 11.96 → 4.45 s,
  ai governance 2.82 → 0.98 s; `scripts/recompete-replay.ts` byte-identical 7/7 before/after.
- Gate 2: `discovery/sql.ts` (SQL twin of `apply.ts`, closed grammar, bind params only) + `maps-recompete-sql.ts`
  (ONE materialized evaluation → total/unmapped/in-view/pins/follow-ons). Parity oracle `scripts/recompete-parity.ts`
  = 48/48 byte-identical. **Not wired into the route** — deployment shape (server-side pg via pooler, shadow mode)
  awaits approval. Never add an RPC that accepts SQL text.
- ⚠️ `npm run migrate -- --go` applies EVERY pending file. `20260924_saved_search_forecast_watermark.sql` (#1683) is
  pending and its PR says do not apply it. Use `--only a.sql,b.sql` to apply a subset.

### Opportunity Share Attribution — ✅ FROZEN 2026-09-23 (PR #1652, merge `e8c88086`)
Record: **`docs/engineering/opportunity-share-attribution.md`** — read it; do NOT re-audit.
SHARE → CLICK → SESSION → SIGNUP → ACTIVATION → PAID from first-party data (`user_engagement` +
`signup_attribution` + `purchases_canonical`); GA4 supplemental and deferred on the Map.
- Share link `?opp=<id>&src=share&sh=<uuid per click>`; `src`/`sh` never touch the frozen Share Truth.
- Map writes first touch itself (route handler — root-layout AttributionTracker never runs there); never overwritten.
- Anon → account claim at verified auth (`mi-session` / `mindy-complete-signup` / `mi-login`) via `mindy_anon` cookie.
- Report: `npx tsx scripts/report-share-funnel.mts --by notice_id` (read-only). Prod smoke: `scripts/acceptance/share-attribution-prod-smoke.mts`.
- `opportunity_shares` is the LEGACY briefings share table — not this contract.

### Canonical Discovery — Phase A (#1637) + Phase B MCP (2026-09-22)
Records: **`tasks/canonical-discovery-phase-a-2026-09-22.md`**, **`tasks/canonical-discovery-phase-b-2026-09-22.md`**.
`src/lib/discovery/` is the ONE search-meaning layer. **MCP `find_opportunities` (Phase B) and Maps Open (Phase C,
`src/lib/opportunities/maps-open-discovery.ts`, record `tasks/canonical-discovery-phase-c-maps-open-2026-09-22.md`)
consume it, and Maps Recompete (Phase C2, ✅ production-accepted + FROZEN 2026-09-23 on `566c1fe9`, `src/lib/recompete/maps-recompete-discovery.ts`, record
`tasks/canonical-discovery-phase-c2-maps-recompete-2026-09-22.md`), and Maps Forecast (Phase C3, ✅ production-accepted + FROZEN 2026-09-23 on `d131e272`, `src/lib/opportunities/maps-forecast-discovery.ts` — forecast-map AND forecasts/unplaced; record
`tasks/canonical-discovery-phase-c3-maps-forecast-2026-09-23.md`).** Saved-search **Forecast** has a canonical engine that ships **OFF** behind `SAVED_SEARCH_FORECAST_CANONICAL='true'`: plan = `src/lib/saved-searches/forecast-discovery.ts` (same builder as Maps Forecast), newness = the **created_at watermark** + per-buyer gap boundaries + publisher alert floors (`forecast-watermark.ts`, `src/lib/forecasts/alert-floor.ts`, migration `20260924_saved_search_forecast_watermark.sql` — NOT applied). ⚠️ Never use `last_synced_at` or a row window for Forecast newness. Large intervals resume via (created_at, id) keyset progress in `forecast_pending` — pages must stay under PostgREST's 1,000-row response cap (a 1,000-row page silently dropped 1,018/2,018 rows). Bulk forecast loads are refused by the `agency_forecasts_floor_guard` trigger unless the publisher is suspended (`runPublisherBackfill` / `scripts/forecast-publisher-floor.ts`); only the 5 daily crons may declare `forecastWriterClient('daily_sync')`. A daily run over 500 new rows for a floored publisher writes ZERO new rows and quarantines them (`forecast_refused_loads` → `scripts/forecast-refused-load.ts`). Canonical sends take a CAS lease: at-least-once, never exactly-once (record §12.5). Emergency rollback = unset the flag: canonically-measured searches get NO legacy Forecasts, Open continues. Records `tasks/saved-search-forecast-migration-2026-09-23.md` + `tasks/saved-search-forecast-watermark-2026-09-24.md`; blocked on DHS identity (#1682). Saved-search Open and daily alerts are NOT migrated. `applyMapFilters` still runs the old search
brain for callers that pass `search` — Maps Open blanks `search`/`agency` and never lets it interpret.
- Pipeline (locked): raw → structured intent → concept classification → eligibility → horizon policy → ranking.
- ⛔ Do not fix Maps/saved-search search locally — migrate the consumer. The **cross-surface gate**
  (`src/lib/discovery/cross-surface-plan.unit.test.ts`) registers every surface; flip one to `migrated` with a real
  `toPlan` adapter and CI enforces MCP-equal meaning.
- MCP changes are proven by `scripts/mcp-find-replay.ts` → `scripts/mcp-find-replay-diff.ts` (exits 1 on any
  unclassified change). Order next: Maps Open → Recompete → Forecast → saved searches (blast re-run + sign-off) → client.
- Never add a length rule for word importance; classes are semantic (distinctive / qualifier / supporting).

### IMI FIND — company-anchored FIND + DIRECT_MATCH semantics (Workstream A, 2026-09-22, PR open)
Fixtures + tests: `src/lib/opportunities/__fixtures__/imi-find/` · `imi-find-company-anchor.unit.test.ts`.
- `find_opportunities` takes optional `uei`. `resolveCompanyAnchor` (`company-anchor.ts`) projects the record
  `lookup_sam_entity` already returns (cache-first) — NOT a new profile system. Registered NAICS/PSC are
  UNIONED into recall (base plan fetched too, so text rows are never starved) and labelled
  `company_registered_psc|naics` — never DIRECT_MATCH. Eligibility (`company-eligibility.ts`) is a separate
  screen: per-notice-NAICS size, absent set-aside = UNKNOWN, recompetes always UNKNOWN. No uei → P2 unchanged.
- ⚠️ **DIRECT_MATCH needs BUY-SIDE evidence** (`match-evidence.ts`). A holder-name-only hit is `HOLDER_SIGNAL`;
  a buyer-name-only hit is RELATED. `recompete_opportunities.naics_description` is **0% filled** — before this,
  literal Coming-back recall ran only on holder + agency names; `description` (96%) / `psc_description` (99.7%)
  are now in `RECOMPETE_TEXT_COLS`.
- **Workstream C (region + stage)** — `states: []` ORs with `location` (`resolveRegion`); a non-state token
  ("Robins AFB") is reported in `query_summary.region.unresolved`, never geocoded; an all-unresolvable region
  fails CLOSED via the `ZZ` sentinel (PR #1435 class). `stage` (`acquisition-stage.ts`) filters OPEN NOW only,
  inside the fetch: `notice_type` is the only structured field (`notice_type_code` is NULL fleet-wide) — title
  keywords are a labelled secondary signal on a compatible type; unknown types are excluded + counted. Measured
  live 2026-09-22 (36,506 active): MARKET_RESEARCH 1,712 (1,642 structured) · VEHICLE 269 (title only) ·
  NON_FAR 98 (title only) · unknown 0; SQL counts == JS labeller counts.

### Potato v1 — ✅ SHIPPED → CLOSED 2026-09-17
Full record: **`docs/POTATO-V1-COMPLETION.md`**. Do **not** “continue Potato.”
- Journey: FIND → UNDERSTAND → CURRENT INTELLIGENCE → PATHWAY FIT → TALENT THIN → POSITION → ACT → MONITOR. Then STOP.
- Product production: merge SHA **`8cab32a2`** on `getmindy.ai` (Vercel project `market-assassin`). Docs merge `919dbcb5` is the completion record, not a product deploy.
- 12/13 acceptance PASS; positioning-claims PARTIAL is **v2 debt**, not a v1 reopen.
- Reopen v1 only for billing, security/privacy, fabricated evidence, or a genuinely broken customer journey.
- Any next build is a **separately named track** with its own goal and acceptance gate (not “Potato v1.1”). Candidates on the debt list are not automatically next.

### Potato P2 — VALUE BEFORE QUALIFICATION (awaiting merge)
Track: first-turn sequencing only. Do **not** reopen Potato v1 evidence engines.
- Principle: broad “I sell X to Y / help me” → one `find_opportunities` → present Open / Coming back / Coming soon → one plain-English refine → WAIT.
- Controls: `P2_FIRST_TURN_INSTRUCTIONS` (MCP initialize) + FIND `presentation.host_rules` (CAI/PATHWAY pattern).
- Company identity moves to PATHWAY FIT. Clearance only when evidence makes it decision-changing. No first-turn deliverable menu.
- Branch: `feat/potato-p2-value-first`. Do not start another P2 issue. No server-side FIND debit guard unless a live host still triple-calls FIND after this ships.

Concise pointers to the living records so a new session doesn't spend an hour
reconstructing state. When one of these is closed, update it here.

### Current Acquisition Intelligence v0 — ✅ FROZEN COMPLETE 2026-09-15
Contract: **`docs/PRD-current-acquisition-intelligence-v0.md`**. MCP tool
`get_current_acquisition_intelligence` (8 credits). Journey:
**FIND → UNDERSTAND → CURRENT INTELLIGENCE → PATHWAY**.
- Shipped PR #1539 + language guardrails (unavailable ≠ zero; historical evidence ≠ future certainty;
  empty `do_differently` when unearned). Host SOCOM cyber re-run PASS.
- **Production acceptance (only this counts):** worktree relinked to Vercel project **`market-assassin`** →
  `vercel --prod` → **getmindy.ai** verified **61 tools**, CAI @ **8cr**, catalog description includes
  unavailable-horizon / future-certainty guardrail language.
- **Not acceptance evidence:** a successful deploy to the accidental Vercel project
  `cai-language-guardrails` (green build, wrong project — do not cite).
- **⛔ No more CAI polishing.** Do not reopen compose, host_rules, or pathway classifiers unless a
  production defect breaks the killer rule or invents pathways. PATHWAY FIT and Potato v1 are
  **CLOSED** — see `docs/POTATO-V1-COMPLETION.md`. Do not treat CAI follow-ups as “continue Potato.”
  (Process debt: worktree→wrong Vercel project has now bitten twice — assert
  `.vercel/project.json` → `market-assassin` before `--prod`; build an abort guard only if it
  happens again. Do not divert PATHWAY/TALENT for that guard.)

### Decision Makers — source 1 SHIPPED 2026-09-15 (PRs #1524/#1525/#1527/#1528)
Runbook: **`docs/runbooks/decision-makers-sam-contacts.md`**. Read it before touching
`federal_contacts` ingest; don't re-derive.
- `federal_contacts` is now the registered source **`decision_makers_sam_contacts`** (dataset
  `decision_makers`) with a durable checkpoint in `decision_makers_sync_state` and its own
  `cron_jobs` row `sync-decision-makers` (`0 */2 * * *`). It previously had **no schedule at
  all** — only an unawaited `fetch()` from `sync-sam-opportunities`, sweeping an ~11-day rolling
  window while 50.8% of rows went 90+ days untouched.
- ⚠️ **The cursor is `sam_opportunities.created_at`, never `posted_date`.** 34,906 notices
  (16.8%) are created >2 days after they were posted (worst 30 days), so a posted_date cursor
  silently skips every backdated arrival. Do not "improve" this.
- ⚠️ **Registered + enabled + firing on time ≠ working.** The first scheduled fire **401'd**:
  the dispatcher sends `authorization: Bearer $CRON_SECRET` + `x-cron-dispatch: 1` and **never**
  `x-vercel-cron`. Any `cron_jobs` route must accept that bearer — and verification means reading
  `cron_job_runs.http_status`, not `cron_jobs.last_run_at`.
- ⚠️ **`source` / `source_table` on `federal_contacts` are column DEFAULTS**, not provenance. The
  82,017 `sam_entities_pocs` rows are VENDOR POCs yet inherit `source='sam_opportunities_poc'`.
- Unchanged rows are never re-upserted, so `last_data_advance` moves only on real mutations and
  `updated_at` means "content changed", not "a sweep passed over it".
- **NOT done (next passes, in order):** person identity (~21K people behind 247K rows; 2,321
  emails with conflicting names), then vendor-POC provenance + the two frozen importers.

### Specialty feeds (DIBBS · Grants · SBIR) — ⏸️ PARKED 2026-09-13
Full record: **`docs/data-core-reliability-dibbs-grants-sbir.md`** (PR #1458). Read it; do NOT re-audit.
**Do not reopen until explicitly requested** — priority is the Strategic Intelligence Core
(pain points · priorities · legislation · appropriations · budgets · GAO/IG · strategic plans ·
forecasts · Event Radar · buying offices · decision makers), answering: *can Mindy detect where
demand is forming BEFORE the solicitation appears?*
- **DIBBS 🟡 YELLOW** — live and advancing (48,385 rows), but no advancement oracle + 19.7% job error rate. Monitoring **before** repair.
- **Grants 🟢 GREEN** — 0 errors / 44 runs, advancing daily. Only a lifecycle/retention decision remains; low priority.
- **SBIR 🔴 RED (COVERAGE, not freshness)** — the 42 rows are current but come from **1 of ~11** SBIR agencies; SBIR.gov has produced 0 rows. **Product decision before implementation.**
- **Research/Lab multi-source ⚠️ PARTIAL** — healthy NIH masks dormant sources: `darpa_baa` and the `grants_gov` slice are ~5 months dead and `nsf_sbir` has NEVER written a row, while both crons logged **75 successful runs of 86**. Needs **per-source** advancement monitoring (a dataset-level clock reports this corpus healthy).
- ⛔ While parked: do NOT wire SBIR.gov, expand SBIR coverage, investigate DARPA, repair NSF, add DIBBS monitoring, change grant retention, dedupe grant populations, change sync schedules, or add specialty feeds.
- Inventory truth is DONE and merged (#1457): DIBBS + "Research & Lab Funding Opportunities" are represented, grants is `curated` not passthrough, SBIR is a **non-counting subtype**. PR #1339 closed as superseded.
- **`/admin/data-inventory` is an ADMIN TRUTH SURFACE (rewritten 2026-09-26, audit `tasks/data-inventory-audit-2026-09-26.md`).** Semantics live in `src/lib/data-core/inventory-model.ts`: every dataset has ONE `kind` (`source_corpus` · `derived_intelligence` · `derived_index` · `static_manual` · `passthrough`) and ONLY `source_corpus` enters the source totals, split BY GRAIN: owned source RECORDS (primary) + award TRANSACTIONS (`grain: 'transaction'`, the BQ warehouse) = persisted source rows. Never call it "unique" — datasets are summed per store, not deduplicated across each other (a test fails on the word). Stored ≠ served (SAM active, recompete `quality_flag IS NULL`, contacts `contact_kind = government_buyer`). A "source" is an UPSTREAM PUBLISHER, never a label. Registry counts that disagree are shown as DEBT, never adopted. ⚠️ `embedding_source='none'` rows carry an EMPTY-ARRAY sentinel, not a vector — `sow_embedding IS NOT NULL` over-counts the index by ~55K. ⚠️ The BQ `awards` table is TRANSACTION grain (65M rows), not distinct awards. `inventory-truth.unit.test.ts` derives candidate collectors from `src/app/api/cron/` — a new `institute-*`/`sync-*` collector fails CI until it has a row. **Visual dashboard + Observation Moat (2026-09-26):** charts live in `src/app/admin/data-inventory/charts.tsx`, one component per management question, palette validated with the dataviz validator. The OBSERVATION moat reads ONLY append-only / point-in-time stores (`recompete_changes`, `daily_metric_snapshots`, `leaderboard_snapshots`, `intelligence_changes`) via `src/lib/data-core/observation.ts`. ⛔ NOT `daily_saved_search_snapshots` (customer watchlist history) and NOT `mcp_external_cache` (24h overwrite cache). Competition Health is an ON-DEMAND scorecard with NO retained history: the card may not claim trend/movement (test-guarded). Snapshotting is a separate, unbuilt track: `tasks/competition-health-longitudinal-snapshots-design-2026-09-26.md`.

### MCP Connectors Directory — SUBMITTED 2026-07-17
Full record: **`tasks/mcp-directory-submission-readiness-2026-07-17.md`**. Don't re-investigate; read that file.
- **Canonical connector URL:** `https://mcp.getmindy.ai/mcp` (NOT the apex `getmindy.ai/mcp/mcp` — that's retired; `/mcp/mcp` no longer routes).
- **Auth:** OAuth 2.0 + DCR, and DCR is now **idempotent** (`registerClient` dedupes by signature — do not "fix" it back to minting per-call).
- **Server identity:** hosted edge sets `serverInfo` (name "Mindy" + icons) in `src/app/mcp/[transport]/route.ts`. Tool titles/annotations/object-param types are curated in `src/lib/mcp/tool-schemas.ts` (`TOOL_META`, `annotationsFor`, `propToZod`). The portal reads `annotations.title` AND per-param `type` — both must be emitted.
- **Reviewer account:** `demo@getmindy.ai` (free, funded, vault+CRM seeded). Built by `scripts/provision-reviewer-account.ts`. Must stay FREE — `MFA_ENFORCED_PAID='on'`, so granting it Pro/Team locks the reviewer out.
- **OPEN — do soon:** rotate the GHL Private Integration Token (it was pasted into a transcript); delete the `Mindy ReviewerTest` contact in GHL location `V4H04EQ2wl6n6fkvBzyM`.
- **OPEN — after approval only:** turn on `MCP_ENFORCE_TIERS` (off now so the reviewer's free account can run `get_winning_playbook`); decide the 713-Pro July allowance backfill (self-corrects in August).

### Off-SAM opportunity ingestion — PAUSED 2026-07-18 (resume here)
Full plan + spike: **`tasks/offsam-ingestion-scope-2026-07-18.md`** · memory `offsam-ingestion-inflight`.
Decision: **differentiate coverage, NOT raw count**. 30-portal registry shipped (PR #382).
- **DIBBS revive = config only** (`ingest.ts` is already paid-tier ready) — **BLOCKED ON ERIC:**
  set paid `APIFY_TOKEN` in Vercel prod + redeploy → run `/api/cron/sync-dibbs?maxItems=1000` →
  add daily `cron_jobs` row. `dibbs_rfqs` should grow past 895.
- **Ariba Discovery adapter = spike GREEN, ready to build** (~2-3 days). LANL profile ANID
  `AN01460290704` = 31 public postings, no login. ORNL is NOT Discovery (own page). Reuse is the
  whole discovery.ariba.com network. New `offsam_opportunities` table + change-tracking + a
  **separate Teaming view first**. Also needs the paid Apify token.

### Other active follow-ups
- `tasks/silent-failure-followups-2026-07-16.md` — the recompete cron erroring on ~18% of NAICS (`fetch failed`, undiagnosed — log `error.cause`), plus 86 grandfathered silent-zero sites.
- `tasks/mi-beta-email-cleanup.md` — `mi_beta_email` is a redundant unsigned localStorage key; deferred auth refactor (16 files).

---

## 🔔 Pending Tasks

### Batch Enroll Bootcamp Attendees (April 12-19, 2026)

**Status:** Daily alerts confirmed working at scale. **Eligible audience = 1,540** as
of Jul 11, 2026 (`alerts_enabled=true` AND `alert_frequency IN (daily,weekdays,weekends)`;
alerts_enabled total 1,669) — free-daily is the permanent model. **Jul 11 cap fix (PR
#113, `d34ddd8a`):** the eligibility query silently returned only the first 1,000 PostgREST
rows → ~540 subscribers never processed; now paginated via `.range()` across the dispatcher
window (confirmed live — `processed` climbs past 1,000, sends 931–1,044/day). Capacity:
`DAILY_ALERT_BATCH_SIZE=250` × ~21 dispatcher runs = ~5,250/day; 1,540 drains in ~7 runs
(bump batch toward ~500 only when eligible nears ~3,000). 8,803 bootcamp attendees already
invited (last batch May 21). Remaining enroll batches can proceed.

**Action:** Enroll 8,804 bootcamp attendees from `data/bootcamp-attendees-to-enroll.txt`

```bash
# Run this after verifying alerts are working
cat data/bootcamp-attendees-to-enroll.txt | while read email; do
  curl -s -X POST "https://getmindy.ai/api/alerts/save-profile" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$email\", \"naicsCodes\": [\"541512\", \"541611\", \"541330\"], \"businessType\": \"\", \"source\": \"free-signup\"}"
done
```

**Source:** All GHL contacts with any "bootcamp" tag (contract-vehicles-bootcamp, jan31-bootcamp, feb-proposal-bootcamp, etc.)

---

## JTED 2026 Presentation & Guide

**Event:** AEC Industry Day at MacDill AFB — April 1, 2026

### Presentation
- **File:** `presentations/JTED-2026-Revised.html` (98 slides)
- **PowerPoint:** `presentations/JTED-2026-Compressed.pptx` (8MB, image-based)
- **Export script:** `node presentations/export-slides-compressed.js`
- **Status:** Complete with QR code

### Companion Guide (Complete)
- **Intel Pack PDF:** `presentations/JTED-2026-Intel-Pack.pdf`
- **Slides PDF:** `presentations/JTED-2026-Slides.pdf`
- **Landing page:** `govcongiants.com/jted-2026` (deployed)
- **GHL tag:** `jted-2026-landing`

### Key Files
| File | Purpose |
|------|---------|
| `presentations/JTED-2026-Revised.html` | 98-slide HTML source |
| `presentations/JTED-2026-Compressed.pptx` | PowerPoint (8MB) |
| `presentations/JTED-2026-Intel-Pack.pdf` | Companion guide |
| `presentations/export-slides-compressed.js` | JPEG export + PPTX |

---

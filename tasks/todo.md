# GovCon Giants - Tasks by Priority

**Last Updated:** July 5, 2026

---

## 🔧 RESILIENCE / INFRA — scoped, not yet done (don't lose these)

Full detail: memory `resilience_open_items` + `docs/PRD-read-replica.md`. Shipped
this session: graceful degradation (8 routes), db-health-watch (hourly), vault
export/delete, RLS backstop, strong-auth, no-training AI guarantee, DB daily
backups verified, **vault-file backup (daily, live)**, read-replica **factory**.

- [ ] **READ REPLICA — activate** (factory already shipped as a no-op). ~$70/mo,
      ~½ day. Steps: Supabase → Replication → add same-region replica → set
      `SUPABASE_REPLICA_URL` in Vercel → migrate `daily-alerts` to `getReadClient()`
      FIRST (audit read-after-write), then weekly-alerts/briefings/forecasts.
      **Do AFTER the NCMBC demo.**
- [ ] **PITR** — OFF on purpose (daily backups are the baseline). Enable only if a
      contract needs sub-day recovery (~$100/mo, 30-sec toggle).
- [ ] **Off-provider file backup** (S3/R2) — later tier; only if a contract needs
      provider/geographic separation. Vault files already backed up in-provider.
- [ ] Phase 3 (Redis cache tier) + Phase 4 (managed Postgres SLA, BYOK, in-boundary
      GovCloud) — revenue/contract-gated, roadmap only.

---

## 🔴 TOP PRIORITY — NCMBC demo (Monday) + weekend prep

**Demo:** NCMBC (North Carolina Military Business Center) — audience: SBA, GCAP
(Government Contracting Assistance Program), APEX-type coaches. Coach Mode is the
star of this demo (a coach/counselor managing many client small businesses).

### This weekend (before Monday)
- **ENTERPRISE COACH MODE — Phase 1 SHIPPED (Jul 2)** — the "big org runs it" scale layer:
  - [x] Bulk client import (roster paste → N workspaces, chunked+progress, idempotent)
  - [x] Tier-aware caps (enterprise org = unlimited; consultant = 10) — org.tier now honored
  - [x] Searchable + paginated client list (usable at 200+, not a flat wall)
  - [x] Shared provisioning lib (single-add + bulk = same unit, no drift)
  - [x] NCMBC enterprise org provisioned (eric=org_admin, unlimited, test clients cleared)
  - [x] 60-business NC sample roster (`scripts/demo-rosters/ncmbc-sample-clients.txt`)
  - [x] RLS on org tables (anon backstop) + app-level isolation AUDITED (PRD Risk #1 clean)
  - [ ] **RUN the RLS migration** `20260702_coach_org_rls.sql` in Supabase (on clipboard)
  - [ ] **Smoke-test live**: /app → My Clients → import roster → search → switch → drill in
  - Memory: `coach_mode_tenancy` (shared DB decision), `coach_mode_header_drop`.
  - Phase 2 (after Monday / roadmap): org-admin counselor mgmt + assignment, Org Tab news
    posting UI, analytics/funder reporting, white-label branding. Engine/schema ready.
- [ ] **Tutorial videos** — record walkthrough(s) this weekend. (Same slot pattern as
  the Getting Started Loom videos — memory `guided_journeys_loom_videos`: 60–90s,
  Mindy-branded, Vimeo → player URLs. Confirm which flows: likely coach onboarding +
  add-client + client switch.)

### Backlog (NOT for Monday — USASpending covers it today)
- [ ] **SAM.gov System Account ("higher access")** — apply via sam.gov → Workspace →
  API Keys → "Add Role" (Contract Awards) or new "System Account". FSD (fsd.gov) is the
  support/escalation desk, not where you apply. Justification drafted + approval is 1–4
  wks. Unlocks Contract Awards + Subaward APIs (SAT $250K direct filter, set-aside-by-
  NAICS, prime→sub). NEVER completed since ~Apr; USASpending is the live workaround so
  do NOT block product work on it. Track the request URL when submitted so it doesn't
  get abandoned again. Details: `docs/sam-contract-awards-api-investigation-2026-05-22.md`.

---

## 🔜 AFTER DEMO — deferred cleanup

- [x] **Recompete vehicle rollup — GLOBAL count is now true** (DONE Jun 29, `commit`
  this session). The route already group-then-paginated, but capped the grouping scan
  at `GROUP_FETCH_CAP = 6000` while the default 18-mo set is ~5–6.2k rows (it was 6,191
  yesterday — OVER the cap → silent ~3% under-count, and it grew with the data). Fixed
  in `src/app/api/recompete/route.ts`: count the filtered set first, then fire
  ceil(N/1000) page requests IN PARALLEL pulling only LIGHT columns, group the WHOLE
  set (truthful), and hydrate FULL rows for just the page's vehicles via a targeted
  `.in(contract_id)`. Total ordering (sort + `contract_id`) so parallel windows
  partition cleanly. No schema change — the JS `recompeteVehicleKey` stays the single
  source of truth. Verified live: total=4,796 vehicles over 5,066 rows (270 collapsed),
  page1/page2 zero overlap, GSA IDIQs roll up 18/28 awardees → 1 card. Hard scan
  ceiling `SCAN_ROW_CAP = 20000`. (UI already prefers `vehicles[]` over `contracts[]`.)
- [x] **DoD sub-agency collapse — remaining surfaces DONE** (Jun 29). All four closed:
  - (a) **events count** — `target-market-research` counted upcoming `sam_events` by
    department-level `agency`, so every DoD office inherited the whole-DoD bucket. Now
    reads `inferred_dodaac` (populated by backfill-event-offices) and, for
    office-anchored agencies, counts only events on that office's DoDAACs — mirrors the
    opp anchoring. Verified: 135 distinct office DoDAACs have upcoming events.
  - (b) **stale `open_opp_count`** — it's a client snapshot frozen at save time, so
    saved USACE cards kept the inflated dept-wide number. New
    `/api/admin/backfill-target-opp-counts` (GET=preview, POST?mode=execute, daily cron
    `0 14 * * *` after the opp delta-sync) recomputes ONLY office-anchored targets
    (valid 6-char `office_code` → opps by solicitation prefix); dept-level/junk-code
    rows are left untouched so we never re-inflate. Executed live: W912BV 410→5,
    W912PL 410→9, plus Navy/Army offices 0→36/32/19; 17 updated, 185 skipped, idempotent.
  - (c) **`?agency=` on `/api/app/opportunities`** — verified already clean: the param
    is never read or passed anywhere. Nothing to remove.
  - (d) **`agency-offices` text match** — left as-is. It's a NAICS drill-down that LISTS
    offices within a sub-agency (returns `awarding_office_code` already); the
    `LOWER(awarding_sub_agency) LIKE @needle` keyword is the correct key and works.
    "Anchor on office code" doesn't apply (the code is the output). Not worth churning.
  Contacts directory fix (Jun 29, `commit 3f555e31`): a target's saved `office_code`
  anchors `federal-contacts` on `solicitation_number ILIKE '<DODAAC>%'` (verified live:
  W912PL→11, W912BV→15 `@usace.army.mil` POCs). See CLAUDE.md "Office contacts anchored
  on DoDAAC prefix". Surfaces already correct: award detail/incumbent, recompetes,
  expiring contracts, TMR total spend (all USASpending sub-agency tier).
- [x] **Retire legacy `mi_beta_user_settings.naics_codes` column** — DONE Jun 29.
  Code shipped (`commit 62088ac3`) + Eric ran the DDL in Supabase; verified live:
  column dropped (`42703 does not exist`), biznlync@gmail.com's 21 NAICS restored to
  the canonical table, mi_beta_user_settings otherwise intact, app loads 200. Audit
  (Explore) confirmed
  the column is read-DEAD (both Settings panels read `user_notification_settings`, NOT
  mi_beta) — the todo's "stale fallback" was inaccurate, there's no fallback read at
  all. Removed the two remaining references: the `debug-profile` NAICS-scrub write-map
  entry and the `workspace.ts` `ensureAppWorkspaceSchema` CREATE line (would recreate
  it). Migration `supabase/migrations/20260629_drop_mi_beta_naics_codes.sql` is
  idempotent: (1) data-preserving UPDATE that restores legacy naics into the canonical
  table ONLY where canonical is empty — exactly ONE user (biznlync@gmail.com, 21 codes,
  empty canonical stub); (2) `ALTER TABLE ... DROP COLUMN IF EXISTS naics_codes`. No
  index/view depends on it. **TODO: Eric pastes the migration into the Supabase SQL
  editor, then we verify the column is gone + biznlync restored.**

---

## 📋 SESSION HANDOFF — June 25, 2026 (Coach Mode fixes + nav simplification)

Shipped live to getmindy.ai this session (all verified Ready on prod):
- Stripe-cache sync timeout fixed (290s→8s, subscriptions-fast path) + Command
  Center "Refresh purchases" button.
- Coach Mode leak fixes: display identity (Cassandra/Excell) was leaking the coach's
  name to every client — now client-scoped; Source Feed / matched-opps now scope to
  the active client (was showing coach's construction opps for a drone client); empty
  client shows "set up this client", not coach data or default NAICS.
- Auto-setup "✨ Set up my Mindy": distributes the market scan into My Target List
  (add-only); removed "My Market" from sidebar (Dossier = receipt). Fixed it returning
  0 agencies (wrong TMR field names → now calls find-agencies directly).
- NaicsPicker resolves colloquial terms ("drone"→336411/334511 via keyword-coverage).
- Settings: one "describe what you do" box → NAICS+PSC together; manual fields collapse.
- Vault↔Settings: NAICS sync now additive + visible; cross-links both ways.
- My Library folded into My Vault as the "Generated" tab; removed from sidebar
  (`?panel=library` deep links redirect into Vault). Member Access v2 (verify-before-
  grant + comp/advocate auto-labels) shipped earlier.

---

## 📋 SESSION HANDOFF — June 23, 2026 (Command Center + Coach Mode)

### Completed + SHIPPED LIVE (getmindy.ai)
- [x] **Member Access in Command Center** — grant/revoke Pro/Team without SQL/Stripe,
  dark-themed inline section + standalone /admin/members fallback; members API accepts
  staff session token OR admin password (`f6b246ef`). Verified prod: password path 200.
- [x] **Coach Mode: profile-first** — no "Start here" checklist in client mode;
  add-client routes to Settings unless capability text produced real codes; banner
  empty-profile is an actionable button (`25d40334`).
- [x] **FIXED data-loss bug** — client-mode saves were misfiling onto the COACH's own
  profile (x-active-workspace header dropped when owner stamp missing/email absent).
  `activeWorkspaceFor` now withholds only on definite different-owner mismatch (`75cd4903`).
  Memory: `coach_mode_header_drop`.
- [x] **Repaired misfiled data** — moved Excel Construction's codes (5 NAICS/5 PSC/kw/states/
  agencies) from eric@govcongiants.com → the client row; cleared the coach row. NOTE: Eric's
  ORIGINAL coach codes were overwritten (no backup) — he re-enters his own targeting.
- [x] **Guard: name-only clients always get a profile row** — `ensureClientProfileRow()` in
  coach/route.ts upserts an empty-targeting row (alerts off, ignoreDuplicates) when add_client
  yields no codes (`1f2a1186`).

### Carryover from Jun 19 (still open)
- [x] **GSC reporting for getmindy.ai — DONE/operational** (verified Jun 29). The tool was
  already ported into market-assassin: `src/lib/gsc/{client,query,report}.ts` targets
  `sc-domain:getmindy.ai` (URL-prefix fallback). On-demand: `npx tsx scripts/seo-report.ts`
  (needs `vercel env pull .env.local` for GCP_SA_JSON). Weekly Slack cron `seo-report`
  (`/api/cron/seo-report`, Mondays 13:00 UTC) is registered + enabled + last ran SUCCESS
  2026-06-29. **Snapshot (28d):** clicks 206 (+1773%), impressions 33.7K (+901%), CTR 0.6%,
  avg pos 11.8 (was 28.1) — the programmatic-SEO pages are landing. Follow-ups (separate
  SEO-content tasks, not this item): meta-title/snippet CTR work on high-impression/0-CTR
  `/contractors/*` + `/contractors` index + `/agencies/*`; treat raw-solicitation-number
  queries (ranking ~pos 2-4, 0% CTR) with better titles/snippets on opp/contract pages.

---

## 📋 SESSION HANDOFF — June 19, 2026 (big SEO + strategy day)

### Completed + SHIPPED LIVE (getmindy.ai)
- [x] **Full programmatic SEO machine — all 5 phases** (HigherGov-style "own the index"):
  - P1 `/opportunity/[slug]` (~34K pages) · P2 facets `/naics/[code]/[state]`, `/psc/[code]`,
    `/set-aside/[type]/[naics]` (~906) · P3 `/compare/[competitor]` (GovWin, SAM.gov, HigherGov,
    GovTribe, Bloomberg Gov, Procurement Sciences) + `/compare` hub · P4 AI enrichment
    (`seo_summary`, grounded, cheap models, cron + local drain) · P5 sitemap-index + IndexNow.
  - Commits: `3522b93e` P1 · `8b69f740` P2 · `534c4a00`+`02ca0782` P3 · `fe873db9` P4 · `20abb98c` P5.
  - Verified live: opp pages 200, facet pages 200, compare pages 200, sitemap-index/children 200,
    IndexNow key 200, robots→index.
- [x] **MRR demo fix, CTA tagger fix + 100% coverage, Mindy bootcamp dashboard** (earlier today).
- [x] **Strategy locked** (docs in `projects/edc-mbda-partnerships/`): master thesis, HigherGov
  teardown, CSO/OTA revenue map, SBIR vehicle sweep, DLA-NV012 partner kit, ClickFunnels playbook.

### GSC — DONE (Jun 19)
- [x] getmindy.ai already a verified GSC property (29.1K impressions / 0.6% CTR / **14.3 avg position**
  over 3mo — page-2 territory; the SEO machine + P4 enrichment targets raising that).
- [x] Submitted `sitemap-index.xml` (→ lists sitemap.xml + sitemap-opportunities.xml). Verified the
  index serves valid XML to Googlebot (HTTP 200, application/xml). Status showed "Couldn't fetch" =
  normal fresh-submission lag; CONFIRMED "Success" (Sitemap index type) within ~1 min.
- Old standalone `getmindy.ai/sitemap.xml` still submitted (11,078 pages, harmless — also in the index).
- GSC reporting tool exists in **govcon-funnels** (`src/lib/gsc/`, READ-ONLY, scoped to
  `sc-domain:govcongiants.com`) → **next session: repoint/extend to getmindy.ai** to monitor the new
  SEO pages' impressions/position (feeds the build→measure→enrich loop).

### IN PROGRESS (self-completing, no action needed)
- [ ] **SEO enrichment backlog drain — ✅ DONE: 34,440 active opps 100% enriched (34,437 AI summaries). Hourly cron keeps new opps enriched.
  (`npx tsx scripts/drain-seo-enrich.ts`), and the hourly `enrich-opportunity-seo` cron backstops
  the remainder. 100% summary rate. Just let it finish.

### Crons added this session (dispatcher rows, hourly `0 * * * *`)
- `tag-cta` (CTA tagging) · `enrich-opportunity-seo` (SEO summaries) · `indexnow-submit` (ping IndexNow)
- Reminder (memory `dispatcher_is_hourly`): dispatcher ticks HOURLY — sub-hour cron_expr only fires at :00.

### Migration RUN this session (confirmed "Success")
- `20260619_seo_opportunity_enrichment.sql` — added `seo_summary` + `seo_enriched_at` + partial index.

### ⭐⭐ START HERE NEXT SESSION — STUDY CLICKFUNNELS, EVERYTHING (Eric's explicit #1)
**The whole machine, not just social.** Russell Brunson grew ClickFunnels to $170M ARR with ZERO
enterprise sales — that IS Mindy's thesis. Study + adapt EVERYTHING:
- FB/IG ad-library creatives + lead pages (literal hooks, lead magnets, page structure to copy)
- The value ladder (lead magnet → free alerts → Pro → backend), funnel scripts, order bumps/upsells
- The webinar funnel (= make the Jun 27 Mindy launch RECURRING + evergreen)
- The 5-Day Challenge mechanic (gamified onboarding) + community (Skool/FB)
- Affiliate army (turn the GovCon Giants audience into a sales force)
- Messaging: Attractive Character, Soap Opera Sequence, Seinfeld emails, Hook-Story-Offer
- The books-as-funnels move (DotCom/Expert/Traffic Secrets) → a Mindy/GovCon lead-magnet book
**Framework already drafted:** `projects/edc-mbda-partnerships/CLICKFUNNELS-PLAYBOOK-FOR-MINDY.md`
→ Next session = go DEEP: pull real ClickFunnels assets, then turn the playbook into a build plan
(landers, ad creative, the challenge, the value ladder offers, the affiliate spec).

### Other NEXT STEPS (after/alongside ClickFunnels)
2. **NV012 SBIR** — ⏳ **Kay is reaching out to the accounting firms** for the SFFAS-47 SME (the gating
   item). Owner = Kay; targets = Tier-1 agency-side firms (`DLA-NV012-SME-CANDIDATES.md`). Awaiting
   responses. Closes 22 Jul. (Also live: the MRAS RFI = 2nd DLA door, sent to JP/Servexo.)
3. **Tradewind Marketplace** revenue listing (free, 120+ DoD buyers — `MINDY-CSO-OTA-REVENUE-MAP.md`).
4. **SEO Phase 3b** (optional): contractor vs/relationship pages on the 317K base.

### Decisions made
- **Elon mode = company policy:** condense 10yr→6mo; ship skeleton, measure, enrich winners (the
  SEO build proved it). MOAT = mass adoption via freemium → market research at scale → DoW pitch.
  Growth lane = ClickFunnels/social/content/brand, NOT enterprise sales.
- **SLED:** hold until Phase 3. **DIBBS:** feasible (scraped via residential proxy) — research sourcing
  before building. **Pricing:** keep $149/mo. **Competitors = future acquirers** (PSC×HigherGov = exit comp).
- **SEO thin-page reframe:** Phase 1 gated thin pages; Phase 4 AI-enrichment flips that to "enrich,
  don't hide" (the big-tech stance).

### State
- Branch: `main` · all SEO/strategy work committed + pushed + deployed.
- ⚠️ **Uncommitted files NOT from this session** (a parallel "Mindy Day Jun 27" thread): `api/recompete/route.ts`,
  `docs/strategy/MINDY-DAY-*.md`, `MINDY-STAGE-STRATEGY.md`, `DATA-QUALITY-AUDIT.md`,
  `20260619_recompete_quality_flag.sql`, `scripts/data-quality-audit.ts`, `scripts/_tmp-power.ts`.
  **Left untouched — not mine to commit.** That session should handle them.
- Background: SEO enrichment drain still running (resumable; safe to let run or stop).

---

## ⭐ AHA FEATURE — Collaboration / social-proof flywheel (the "respond together" loop)
The promised market-research aha moment. Aggregate user-intent → "X others tracking this" social proof
→ segment by socioeconomic status → "respond to the Sources Sought together" collab alert. **Moat:
built from our own aggregated user-intent data — uncopyable without the user base. Free-tier viral driver.**
- [x] **Phase 1 — Demand Heatmap (admin)** SHIPPED (`a5c3b6fb`): command-center panel + `/api/admin/
      demand-heatmap`. Ranks tracked opps, flags Sources Sought, socioeconomic segments, threshold-gated
      (≥3) "respond together" preview. Anonymous counts only. `src/lib/admin/demand-heatmap.ts`.
- **Focus (Eric, Jun 19):** NO set-aside segmentation yet — too limiting + data's empty. Lead with the
  RAW signal (capabilities + responding, "you're not the only one → respond together") to PROVE it works
  + drive adoption. Segmentation = Phase 2+ once there's volume.
- [ ] **Phase 2 — user-facing viral loop** (build when adoption fuels the counts): live "X others are
      tracking this" badge on opp pages + alerts (airline/hotel FOMO); auto-triggered "respond together"
      collab alert; "N businesses submitted a response" confirmation. Gate on threshold so weak signals
      never fire. (Add set-aside segmentation only AFTER volume + profile-data completeness.)
- **Reality check (honest):** data is EARLY (max ~2 trackers/opp, socioeconomic fields mostly empty) —
  the feature DRIVES the tracking + profile completion it needs (chicken-and-egg). Admin-first lets us
  watch it grow + trigger manually before automating. Don't flip Phase 2 until counts are impressive.

---

## 🗄️ DATA-EXPANSION BACKLOG (standing — review at every data-feature sprint)
**Tracker:** `projects/edc-mbda-partnerships/DATA-EXPANSION-BACKLOG.md` · sources Mindy is MISSING vs
HigherGov/Procurement Sciences. Add ONLY when they serve the small-biz user (master strategy):
- [ ] **GSA Advantage / labor-rate pricing** — "what price wins" intel, most accessible → **feasibility
      probe SOON** (next data sprint); build if clean.
- [x] **DIBBS** (~3.3M DLA small-buy RFQs) — ✅ **PILOT BUILT** (Apify ingest, commit `8be2075b`). To
      turn on: (1) run migration `20260619_dibbs_rfqs.sql`, (2) set `APIFY_TOKEN` + confirm EULA,
      (3) `npx tsx scripts/test-dibbs-pilot.ts`, (4) add `sync-dibbs` cron row. ~$0 until activated.
- [ ] **SLED** (state/local) — HARD/costly → **Phase 3 only** (Eric).

---

## 📜 MASTER STRATEGY (governs all decisions) — `MINDY-MASTER-STRATEGY.md`

**Operating policy:** condense the 10-yr plan to 6 months (Elon) — ask it of EVERY todo.
**Moat:** mass adoption via freemium ("GovCon Brew" model) → every SMB on ONE platform →
market research at scale (data nobody else has) → the DoW "we ARE the SMB industrial base" pitch.
**Growth lane:** ClickFunnels/social/gamification/content (GovCon Giants brand = distribution),
NOT enterprise sales. Don't compete with Deltek/GovWin's boring pitches — win on brand + virality.
**Decision filters:** (1) serves mass adoption? (2) the 6-mo-compressed version? (3) social/content
not boring-enterprise? (4) feeds the freemium→scale→DoW flywheel?

- [ ] ⭐ **Study ClickFunnels FB + IG lead pages** — better indicators; adapt the social/lead/funnel/
      gamification patterns to Mindy (Eric's lane, the content space). [next]
- [ ] Build the DoW "every small business on one platform" pitch (once adoption proves out)
- [ ] SEO machine continues: P1 opp pages ✅ · P2 facets ✅ · P3 contractors+vs/alternatives ·
      P4 AI enrichment · P5 indexation engineering (`MINDY-PROGRAMMATIC-SEO-SCOPE.md`)

---

## 🔲 ACTIVE — Mindy CSO/OTA revenue track (parallel to NV012 SBIR, started Jun 19)

**Map:** `projects/edc-mbda-partnerships/MINDY-CSO-OTA-REVENUE-MAP.md`
**Why:** the "sell commercial now" half of the Anduril model — vehicles that BUY built Mindy without
needing the Phase III key (that's NV012's job). Full DoW+civilian SBIR sweep done → NV012 is the only
SBIR fit; this track is for revenue.

- [ ] **⭐ Tradewind Solutions Marketplace (CDAO)** — pull submission requirements → build vendor
      profile + video pitch → apply for "awardable" designation. Free, 120+ DoD buyers incl. DLA.
- [ ] Confirm GovCon Edu = nontraditional defense contractor (10 USC 4022(d)) — unlocks OTA fast-track
- [ ] Watch DIU AOIs for a data/analytics/decision-support fit → Solution Brief ($500K–$2M)
- [ ] Decide on NSTXL membership ($500–$1,500) for broader prototype-call access
- [ ] Pitch the 3 warm contacts (ACC-Orlando/DISA/Navy OSBP) on buying Mindy via a Tradewind task order

**HigherGov teardown DONE** (`COMPETITOR-HIGHERGOV-TEARDOWN.md`). Decisions: SLED→hold til Phase 3;
keep $149/mo (win via CAC model + brand, not price); brand = the "Nike of GovCon" moat. Two builds out:
- [ ] ⭐ **Mindy programmatic-SEO layer** — per-opportunity / per-NAICS / per-agency / per-contractor
      indexable + cross-linked pages (HigherGov's real moat — they OWN the search index). Mass
      top-of-funnel engine that pairs with the customer-acquisition model. We have the data (317K
      contractors, 88K opps, NAICS/PSC). Biggest takeaway.
- [ ] **Add DIBBS** (~3.3M small-buy records) — but FIRST research how HigherGov sourced it
      (public-records request? bulk feed? partner?), since our own probe found DIBBS WAF/EULA-gated
      and shelved it (memory `dla_dibbs_not_feasible`). Don't assume scraping works.

---

## 🔲 ACTIVE — AFWERX SBIR application (GovCon Edu, started Jun 15)

**Checklist:** `projects/edc-mbda-partnerships/AFWERX-QUALIFICATION-CHECKLIST.md`

**DECIDED:** Applicant = **GovCon Edu** (for-profit, "developer of Mindy"). NOT the nonprofit, NOT a new entity.
**✅ SAM confirmed active** (renewed) → the 4–6 wk gate is cleared; **R3 (closes Jul 22) is reachable.**
**Constraint is now proposal-readiness, not registration.**

**This week (Eric):**
- [ ] Create **SBC ID** on sbir.gov (minutes — needs active SAM, ✅ have it)
- [ ] Set up **DSIP account** → dodsbirsttr.mil/submissions/login
- [ ] Download the **mandatory proposal template** (afwerx.com/divisions/ventures/open-topic/) — off-template = auto-reject
- [ ] **Decision:** standard Phase I vs. D2P2 (we have 3 warm govt contacts → D2P2 possible)

**Then:** harden the ONE end-user capability (per `AFWERX-SBIR-READINESS.md` Tier 1.2) → write Phase I narrative + work plan + Cost Volume on the template.
**Target window:** R3 (Jul 22) if proposal ready; R4 (Aug 19) deliberate quality fallback (straddles NAPEX).
**Infra:** SAM Entity API throwing 401 (`mcp__samgov__search_entities`) — also breaks Mindy's live entity search; fix separately.

---

## 🔲 ACTIVE — EDC / MBDA partnerships (started Jun 14)

**Runbook:** `projects/edc-mbda-partnerships/EXECUTION-RUNBOOK.md`

**This week (Eric):**
- [ ] Send PGC EDC outreach → Kimberlee Andrews `kbandrews@co.pg.md.us` (`outreach-templates.md` §1)
- [ ] Post FT hire JD (`JD-head-public-sector-partnerships-funding.md`)
- [ ] Post 3 advisor role briefs (`advisor-recruitment-brief.md`)
- [ ] Fill EDC top-10 rows in `landscape-research-phase2.md` (GA, TX, FL, VA, CA)
- [ ] Seed grant NOFO tracker (5 rows)

**P1 target:** Prince George's County EDC — Procurement 360 → 60-day eval → $50K cohort license

**Parallel (don't drop):** NAPEX prep, USHCC Atlanta close, APEX Illinois re-warm

---

## 🔲 OPEN — Hidden-match CTR readout (after a few days of sends)

**Why:** Phase 3 semantic "💡 Hidden match" alerts are LIVE at 25% rollout (memory
`hidden_match_semantic_alerts`). Before ramping to 50%/100%, we want a data signal:
do hidden matches get clicked as much as regular opps? Success = hidden-match CTR ≥
regular-opp CTR. Needs a few days of real morning sends to accumulate clicks first.

**Build:** extend an admin engagement route (e.g. `/api/admin/engagement-metrics`) to
split click-through by the email link's `content` tag — `hidden_match_<id>` vs
`opportunity_<id>` (both already flow through `/api/track` → `user_engagement`
link_click records, captured as linkText/utm_content). Compute:
`hidden_match clicks / hidden_match impressions` (impressions = count of alert_log rows
with `hiddenMatch:true`) vs the same for regular opps. Surface on the command center.

**Then:** if CTR holds, bump `HIDDEN_MATCH_ROLLOUT_PERCENT` 25→50→100 (Vercel env +
redeploy). If it craters, raise `HIDDEN_MATCH_THRESHOLD` or kill via
`ENABLE_HIDDEN_MATCH=false`. (No deploy needed to read; ramp needs redeploy.)

**Also deferred (same feature):** Source Feed in-app 💡 badge — AlertsPanel reads
`/api/app/opportunities` (live), NOT `alert_log`, so it needs the matcher wired into
that opportunities API (bigger change than a render tweak).

---

## 🔲 OPEN — Founders Lifetime $4,997 (Stripe link pending)

**Why:** 1-1-1 pricing — one product (Mindy), lifetime at proven $4,997 course anchor.
Public anchor: Founders $4,997 on getmindy.ai/lifetime + govcongiants.com homepage. Bootcamp alumni $2,997 is email-only, never site hero.

**Code shipped (branch `feat/founders-lifetime-4997`):**
- [x] `src/lib/mindy/lifetime-pricing.ts` — single source of truth
- [x] `/lifetime` sales page + `/checkout/founders-lifetime` + `/checkout/bootcamp-lifetime`
- [x] Bootcamp email rewritten (no Ultimate Giant Bundle)
- [x] Webhook: `briefings_lifetime` for $1,497 / $4,997 + lifetime description fallback

**Eric — Stripe dashboard (blocks go-live):**
- [x] Create Founders Lifetime $4,997 payment link → `buy.stripe.com/28E00k6IC5V0fRH5WMfnO0G`
- [ ] Update bootcamp $1,497 link metadata to `tier=briefings_lifetime` (or create new link)
- [ ] Merge branch + deploy

---

## Session Handoff — 2026-06-11 (Alert messaging + attachment filenames — branch, not prod)

### Free alert email phased messaging — DONE (code)
- [x] Replace "FREE during beta" with `shouldShowAlertSetupNudges()` (`profile-setup.ts`)
- [x] 30-day window + incomplete profile → setup CTAs; else → Welcome/FREE forever
- [x] Wired in `daily-alerts/route.ts` + `send-notifications/route.ts`

### Opportunity detail CTAs — DONE (code)
- [x] Incomplete profile → `/app/onboarding` (not Pro upsell)
- [x] Complete profile → Pro upsells in AlertsPanel + market-intel

### SAM attachment real filenames — DONE (code)
- [x] `SamAttachmentLinks` + `/api/sam-attachment/metadata`
- [x] Sync cron preserves attachment metadata when API omits resourceLinks
- [x] Commit `0d6ec3b` on `fix/market-research-invalid-naics`, PR #7

### GovCon Funnels exit popup — SHIPPED
- [x] Removed `ExitIntentPopup` — deployed `e3ff863` on govcongiants.org

### Still open
- [ ] **Deploy market-assassin** — `npm run build` + `vercel --prod` (interrupted twice)
- [ ] Verify attachment names on getmindy.ai `/app/market-intel` after deploy
- [ ] Optional: `backfill-sam-attachments?retry-names=1` for DB rows still showing "Document N"

---

## Session Handoff — 2026-06-08 PM (Keyword-first research + Email send guard — SHIPPED)

### Keyword-first market research (#59) — NAICS is the wrong primary key
- [x] **The insight (Eric):** "drones" = 70+ NAICS codes ($243M); the obvious code
  (336411) is only 28% → search it alone, miss 72%. And 336411 is BOTH over-broad
  (all aircraft) AND incomplete. Keyword is precise + complete. NAICS auto-derived
  invisibly (real job = set-aside size eligibility).
- [x] **3-axis model:** keyword=discovery, PSC=what-was-bought (1550 Unmanned
  Aircraft vs 336411 Aircraft Mfg — the pro insight), NAICS=size/eligibility.
- [x] `src/lib/market/keyword-coverage.ts` — keyword → total market, all NAICS, 90%
  set, top PSC. **Phrase-resilient** (USASpending=exact-phrase → tries candidates).
- [x] `target-market-research` accepts `keyword`, auto-derives + returns
  keyword_coverage.
- [x] `<MarketCoverageBanner>` teaches the lesson (renders only for keyword research).
- [x] Sport Mode keyword build → FULL coverage (~8 codes, not top-3).
- [x] **Onboarding grounds day-1 codes** (was hardcoded 3-per-industry → broke new
  users' alerts by missing 72%). Now real /api/suggest-codes coverage.
- [x] **QA caught:** sentences ("cybersecurity consulting") fell to LLM — fixed with
  candidate fallback in BOTH keyword-coverage + suggest-codes.

### Email send guard (#58) — fixes the 12-emails/day churn (krithi/Allen)
- [x] ROOT CAUSE: ~15 email streams, no global coordination; central
  email_provider_sends log table never existed (silent fail → couldn't count/cap).
- [x] Migration: email_provider_sends + email_suppressions (krithi seeded).
- [x] sendEmail() GLOBAL guard: suppression check + per-recipient daily cap
  (EMAIL_DAILY_CAP=3) BEFORE any provider. Transactional (auth/2FA/receipt/welcome)
  BYPASSES via explicit allowlist. Fails OPEN.
- [x] **emailType audit** caught: bootcamp_profile_setup (bulk marketing) was
  BYPASSING the cap via "setup" keyword → fixed with allowlist; welcome_alerts was
  wrongly capped → fixed.
- [x] `/api/admin/email-guard` — diagnose any user's volume + manage suppressions.
- [ ] **Add Allen White's REAL email to suppressions** (placeholder removed; get
  address, POST {action:'suppress'} to the admin endpoint).

---

## Session Handoff — 2026-06-08 (Award Intelligence arc + contact rosters + Proposal/Pipeline UX — all SHIPPED)

Big session toward the Juneteenth drop. Built the **USASpending award-intelligence
spine** once and wove it through every surface where it belongs, plus contact
quality, proposal/pipeline UX, and the office-roster "future" feature.

### Award Intelligence arc (SHIPPED) — the connective tissue
- [x] **Shared award-detail foundation** — `src/lib/usaspending/award-detail.ts` +
  `/api/app/award-detail` (accepts generated_internal_id OR raw PIID, resolved
  server-side). Returns obligated→ceiling, parent IDV/vehicle, period of
  performance, recipient (city/state/CD), NAICS/PSC, funding account.
- [x] **Sport / task-order drill-down** — "▸ Award detail" inline on subcontracting
  rows (RecompetesPanel). Fixed idv-search to use `generated_internal_id` (was
  null `generated_unique_award_id`) — also repaired /award/ deep links everywhere.
- [x] **Bid/No-Bid grounding** — `findPredecessorAward()` infers the likely
  incumbent (real ceiling/expiry/vehicle); wired into `/api/analyst/bid-no-bid`.
- [x] **Reusable `<AwardDetailDrawer>`** wired into Expiring Contracts detail
  (PIID-resolved). One component, consistent everywhere.
- [x] **"Who holds this now?"** — `<IncumbentIntel>` + `/api/app/incumbent`,
  on-demand per card (no bulk API cost). On My Pursuits detail + Today's Intel
  Review Fit. Honest "no clear incumbent" miss; confidence-labeled.

### Contact quality + rosters (SHIPPED)
- [x] **Office rosters (was the "future" #16)** — `?facets=office-roster` groups
  contacts by DoDAAC-decoded office (clean DOMESTIC, not embassy-contaminated raw
  office), foreign-filtered. Decision Makers "📇 Full contact rosters by buying
  office" → click office → complete roster. 70 DoD offices, DLA Aviation=42.
  Honest scope: DoD/DLA/Navy only (DoDAAC path); civilian = preview.
- [x] **Foreign filter** — drop overseas contacts (incl. via DoDAAC-decoded office,
  the 2nd-pass QA catch); decode cryptic codes (NAVSUP/USPFO/NSWC→plain English).
- [x] **Real role badges** — classify KO / Small Business / Contract Specialist /
  Program-Technical / Leadership from title text.

### Proposal Assist + Pipeline UX (SHIPPED)
- [x] **Vault point-of-contact fields** — contact name/title/phone/email/website +
  bonding + office address (migration RUN). Proposals fill them instead of
  [placeholders].
- [x] **SOW export formatting** — markdown tables → real Word tables; decimal-
  numbered sections (5.2/5.10) → headings.
- [x] **Searchable + active-first pursuit picker** — replaces dense `<select>`;
  defaults to Active (bidding/pursuing) group, search reveals all.
- [x] **Start-screen flow** — ①picker → ②workbench step cue (Open workbench no
  longer looks like it does nothing).
- [x] **Pipeline Next Action computed** (was blank) + **duplicate pursuits deduped**.

### LLM cost discipline (SHIPPED)
- [x] **GPT-4o-mini `reasoning` job** for user-facing reasoning (Claude not scalable
  at $149/mo); per-user $15 budget cap + cost dashboard `/api/admin/llm-cost`.

### Market Research fixes (SHIPPED)
- [x] DoD surfaces in **multi-NAICS** (was civilian-only); **invalid_naics** trailing
  comma fix; **suggested codes shown before apply**; per-office spend distinct.

### Marketing
- [x] `docs/MARKETING-FEATURE-LITERATURE.md` updated — 10 features + data-sources
  story + content calendar for the SEO team.

### Old-todo items this session CLOSED (cross-referenced)
- [x] "Interactive product tour" → tour fixed (+ Market Research/Expiring steps)
- [x] "validate money cards $M/$B/$T" → formatMindyCurrency everywhere
- [x] "Office → contact join (solicitation prefix → office)" → office rosters
- [x] "Expand DoDAAC name lookup" → 170 commands + decode platform-wide
- [x] "5-role gov contacts (only contracting)" → role classification added

### ⚠️ WHAT'S REALLY LEFT (the genuine open list, June 8)
**v1.1 / deferred (NOT blocking Juneteenth):**
- [ ] **Content Reaper woven in** — "Mindy writes your BD content" (#13). PRD:
  `docs/PRD-mindy-bd-content-v1.1.md`.
- [ ] **Interactive year selector** in Market Research (#26) — multi-year trends.
- [ ] **Semantic "find work hiding under funny names"** (#65) — match MEANING not
  words, so a cyber person finds a "building envelope" contract that's secretly
  30% cyber + the recompete equivalent. PRD: `docs/PRD-semantic-hidden-work-discovery.md`.
  Feasibility done: cached descriptions are 94-char stubs (only 5% usable) → needs
  a full-SOW fetch+embed pipeline; reuses existing pgvector/RAG infra. Flagship
  discovery feature — DON'T ship semantic-over-stubs (5% effective).
- [ ] **DoD forecast scrapers (Option A)** — component LRAF scrapers into
  `agency_forecasts`. PRD: `docs/PRD-dod-forecast-scrapers.md`. Big data project.
- [ ] **Civilian office decode** (GSA/VA/HHS) — extends office rosters beyond DoD.
  The decoder is DoD-only by design; needs civilian solicitation formats or an
  `awards.awarding_office` join.
- [ ] **Real gov roles via commercial enrichment** (HigherGov/LinkedIn-grade) —
  gate on demand. PM/engineer/end-user roles are null at the SAM/FPDS source.
- [ ] **Contractors NAICS+state combo** — state filter is name-search only (rollup
  has no location); costlier location-aware path.

**Launch polish (branding/ops — owner's call, mostly non-code):**
- [ ] **Mindy logo + Free/Pro/Teams language** across app chrome, emails, auth.
- [ ] **"Open Mindy Dashboard" link** in every alert/briefing email.
- [ ] **Final domain migration** — getmindy.ai canonical, mi→getmindy permanent
  301. Runbook READY (`tasks/mi-to-getmindy-cutover-runbook.md`). Execute on go.
- [ ] **Full Pro-loop browser QA** — sign-in/OAuth → onboarding → research →
  recommendations → proposal → sign-out (manual pass before launch).
- [ ] **"Complete your profile" nudge** when ranking confidence is low.

**Deliberately OFF (do not enable):**
- Email Mindy Insights (#91) — crashed the batch; gated off.

---

## Session Handoff — 2026-06-07 (Proposal Assist v1.0 SHIPPED + LLM scale layer)

All shipped & deployed to getmindy.ai. Full proposal workflow is live, end-to-end.
Detail: `docs/PRD-proposal-extraction-compliance.md`. Memories: `[[proposal_assist_v1]]`,
`[[llm_provider_strategy]]`.

### Proposal Assist v1.0 — the full workflow (all SHIPPED)
- [x] **Doc manifest + classification** — `classify-doc.ts` (11 types), wired into
  SAM fetch + backfilled; `DocManifest.tsx` (routing hints, downloads, honest
  "needs manual download"). Migration `20260606_pursuit_doc_kind.sql` (RUN).
- [x] **Bid/No-Bid gate (Step 1, before matrix)** — `/api/app/proposal/bid-gates`
  derives high-signal eliminators from THIS solicitation (past-perf, bonding,
  licenses, CMMC, vehicle holder, clearances — NOT generic SAM/small-biz) +
  Eric's 10-factor scorecard. `bid-decision.ts`, `BidDecisionGate.tsx`.
- [x] **Multi-doc compliance matrix** — base+amendments+Q&A, amendment precedence,
  chunked (350K docs), category-normalized, provider-agnostic. Shared cache:
  `compliance_matrix_cache` (migration `20260606_compliance_cache.sql`, RUN).
- [x] **Section alignment + priority tiers** — critical/standard/final, page-counts
  last. Calming priority summary makes 172 reqs palatable.
- [x] **Grounded drafts** — Claude + winning-narrative RAG (killed "Agile sprints
  for construction" generic output).
- [x] **Independent compliance referee** — `/api/app/proposal/referee` (Claude).
- [x] **Bid-aware Manual/Sport chat** — reuses extracted docs + cached matrix
  (pipeline_id), provider fallback. Positioned vs ChatGPT (it knows THIS bid).
- [x] **CLIN scope + SOW-for-subs** — `extract-sow` (real SOW → regex → CLIN
  "Scope at a Glance" → honest fallback). xlsx extraction added.

### LLM scale/provider layer (Groq paid tier is CLOSED → provider independence)
- [x] `src/lib/llm/call-llm.ts` — per-JOB fallback chains: extraction (Groq only,
  no Claude — bulk), drafting (Claude-led), referee (Claude). Falls through
  Groq→Claude→OpenAI→Grok on 429/etc. Claude FUNDED + protected from bulk.
- [x] Shared compliance cache (extract a SAM notice once, serve all bidders).

### NEXT (real-usage driven, not guessing)
- [ ] **Interactive product tour** — driver.js + `data-tour` anchors + 6 core
  steps (Today's Intel, Pursuits, Proposal, Target List, Vault, Contractors),
  show-and-tell (action optional for v1). `docs/PRD-interactive-product-tour.md`.
  IN PROGRESS — building now.
- [ ] v1.1: multi-source adapters (NECO/GSA eBuy/labs); per-doc notes/versions.

---

## Session Handoff — 2026-06-05 PM (Proposal Manual Drive + Target-List hub + QA)

All shipped & deployed to getmindy.ai. Standalone backlog: `tasks/BACKLOG-later.md`.

### Proposal Assist — Manual Drive (v1, PRD-proposal-manual-mode)
- [x] Auto↔Manual·Sport toggle (moved to top / Start-Here per QA).
- [x] `/api/app/proposal/chat` — Perplexity-style proposal LLM grounded in the
  user's RFP + Vault (reuses Mindy Chat SSE/Groq engine, no fabrication).
- [x] `ProposalChat.tsx` streaming panel; "Verify on SAM.gov" trust link.
- [x] Loads ALL pursuit PDFs (was only 1 — `combineUploadedDocuments`).
- [ ] **v2 (NOT June 19):** notes, compliance who/status, draft versions.

### Target-List hub (PRD-relationships-from-target-list — v1 + v2 SHIPPED)
- [x] Decision Makers defaults to ⭐ My Targets (user's target agencies).
- [x] Relationships: attach to AGENCY not pursuit; pursuit-attach optional.
- [x] My Target List row → 🤝 "Relationships at this agency" (pre-scoped).
- [x] v2: My Network grouped by agency + relationship stages (prospect→warm→
  contacted→met→champion). Migration `20260605_relationships_v2.sql` RUN +
  verified (7/7 backfilled).
- [x] Team Access moved Pipeline → Account.

### QA bug fixes (Eric's live walk-through)
- [x] Stat cards/tabs scroll to results + show filter state (were filtering
  below the fold → looked dead).
- [x] Contractor award drawer uses BQ (BL Harbert → 11yrs/$11B, was empty).
- [x] Forecasts: DoD early signals on the default "All agencies" view.
- [x] DoDAAC names: stripped FPDS code prefixes (W7NC… → real names; 4,813 re-run).
- [x] Decision Makers "Track" → confirmation (→ My Target List).

### ⚠️ Reminder
- **Hard-refresh getmindy.ai** (Cmd+Shift+R) — cached JS bundle hid earlier deploys.

---

## Session Handoff — 2026-06-05 (Growth/virality: share loop + newcomer clarity)

Eric: the Today's Intel **Share** button was lost beta→new (the viral loop); also "what does the share preview show?" and "a student asked what Mindy was." Closed the whole loop. All deployed, verified live.

### Share / viral loop
- [x] **Share button restored** on Today's Intel opportunity cards (Review Fit · +Track · ⬆ Share · Dismiss). Infra survived (ShareButton, /api/share/opportunity, /shared/opp page) — just rewired into DashboardPanel.
- [x] **Share links → getmindy.ai** — set `NEXT_PUBLIC_APP_URL=https://getmindy.ai` in Vercel prod + redeployed. Verified: share API now returns `getmindy.ai/shared/opp/...`. Also flips workspace invites / access links / reports to getmindy.ai (all checked safe). Advances the mi→getmindy cutover.
- [x] **Dynamic share PREVIEW** (the Fireflies/Loom growth lever) — /shared/opp split into server page.tsx (generateMetadata) + opengraph-image.tsx. Preview is now ABOUT THE OPP ("X shared a federal opp via Mindy · Sources Sought · See your fit"). Bugs fixed mid-build: params is a Promise (Next 16); Satori fontFamily; **OG image must read Supabase DIRECTLY by shareId — a self-fetch to our own API 500'd, and Next OG routes don't get searchParams.**

### Today's Intel UX
- [x] **Stat cards are clickable filters** — Opportunities/Urgent/Total Matched/Briefings looked interactive but did nothing. Now filter shortcuts (active = ring). The All/Urgent/Opportunities/Teaming tabs were already wired.

### Newcomer clarity (student asked "what is Mindy?") — PRD `docs/PRD-newcomer-clarity.md`
- [x] **`MeetMindyStrip`** — reusable dismissible "New here? Meet Mindy → try free" (banner + card). Links to getmindy.ai.
- [x] Shared-opp page: strip + re-branded header (was "GovCon Giants → Get Free Briefings" → now "Mindy → Try Mindy free"); funnel CTAs repointed /briefings → getmindy.ai.
- [x] Rolled strip onto public SEO pages: /contractors, /contractors/[slug], /agencies, /awards. SKIPPED /agency (gov-buyer login gate, wrong audience) + /contracts/[piid] (redirect-only). Verified live (rendered).
- [ ] **Remaining newcomer-clarity:** add specific OG previews to public pages that lack them (agencies/awards), and the "card" strip variant lower on long pages. Per the PRD.

---

## Session Handoff — 2026-06-05 (DoDAAC names + reference table + CRM linkage)

Eric: "pulling office CODES is good but we need the NAMES — can't have people figuring that out. And how should CRM linkage work — how do Fortune-1000 SaaS handle it?" Did all three in order. Merged to `main`, deployed.

### The architecture (Fortune-1000 pattern, as Eric intuited)
A **reference table**: the code (DoDAAC) is the stable key, the office NAME lives ONCE, everything joins to it. Built `dodaac_directory` (migration `20260605_dodaac_directory.sql`, hand-run), populated from **BigQuery awards.awarding_office (FPDS — authoritative)** via `scripts/populate-dodaac-directory.mjs`. **4,813 office names.** Name coverage 7% → **94%**. (FA7000 = "10 CONS LGC", N00104 = "NAVSUP Weapon Systems Support".)

### Shipped (in order)
- [x] **Names everywhere** — `loadDodaacNames()` (server, cached) + `useDodaacNames()` hook + `/api/app/dodaac-directory` (client map). Name resolution order: directory table > in-code map > raw code. Wired into Decision Makers, Forecasts (server) and Alerts, Recompetes, Pipeline (client). Offices now read as names, not codes, across Mindy.
- [x] **#1 CRM linkage** — adding an office to My Target List sends the DoDAAC; the target-list POST resolves the canonical name + sub-agency from `dodaac_directory` (so the CRM record is always official + stays current if the directory updates). "+ Track" button on Decision Makers rows.
- [x] **#2 remaining panels** — Alerts/Recompetes/Pipeline get directory names via the client hook (fetched once/session).
- [x] **#3** — this todo.

### Ops note
- Re-run `node scripts/populate-dodaac-directory.mjs` periodically (offices/names change slowly) to refresh the directory.

---

## Session Handoff — 2026-06-05 (Decision Makers sub-agency + DoDAAC office decode platform-wide)

Eric: "parent agency way too broad for DoD/HHS" → narrow to sub-agency + office. Then "apply DoDAAC across all data — no more agency-only stuff."

### Shipped
- [x] **Sub-agency/branch filter** (Decision Makers) — SAM has no sub-agency for DoD (0%), so `deriveSubAgency()` infers it from email domain (us.af.mil=Air Force, dla.mil=DLA, navy.mil=Navy) + solicitation prefix. 98.6% DoD coverage. Dropdown + per-row branch label.
- [x] **DoDAAC office decode** (`src/lib/gov-contacts/dodaac.ts`) — Eric's insight: the solicitation number IS the office. First 6 chars = DoDAAC (contracting office), chars 7-8 = FY, 9th char = instrument type (A=BPA, D=IDIQ, 9=OTA, P=PurchaseOrder). Handles packed + dashed forms. Named the common DoDAACs (NAVSUP WSS, DLA Aviation, NSWC Dahlgren…); unknown → raw code. 297 distinct offices in 1000 DoD contacts.
- [x] **Rolled out platform-wide** via shared `formatDodaacOffice()`: Decision Makers, Alerts, Recompetes, Pipeline, Proposals, Market Research all show the decoded office (🏛) instead of agency-only.
- [x] **HARDENED the decoder** — Pipeline's `notice_id` is often a SAM UUID; a hex fragment falsely decoded (`c164a7b1…` → "C164A7"). Now rejects 32-char hex UUIDs + requires a plausible 2-digit FY at the FY position. Verified: real PIIDs decode, all UUID/civilian formats reject (fall back to agency).

### Deliberately NOT wired
- **Forecasts** — verified its data is 100% civilian formats (89xxx=DOE/NASA, GS-/47Q=GSA, NNG=NASA); 0/15 decode. Decoder correctly returns null. Not a gap in the rollout — but it surfaced a real coverage hole (below).

### DoD forecast coverage — Option B SHIPPED, Option A queued
- [x] **Option B — DoD early signals from SAM (SHIPPED).** Forecasts had 0 DoD (the ~$400B largest buyer). Now surfaces open DoD Sources Sought / RFIs / Presolicitations from `sam_opportunities` in the forecast feed, mapped to the forecast shape, labeled **⚡ Early signal** (amber, distinct from formal forecasts). Office via DoDAAC decode. ~50 open signals for construction alone.
  - [x] **Lookback control** — `?lookbackDays=` (default 180d, 30-730). Answers "how far back."
  - [x] **RFP-release stage** — answers "do we know if they let the solicitation out?": a Sources Sought whose RFP dropped reappears under the same solicitation_number as a Solicitation/Award. UI shows **pre-RFP** (green, shape it) vs **✓ RFP released** (rose, go bid).
- [ ] **Option A — DoD forecast scrapers (NOT executing; queued after the fix list).** The REAL coverage: component LRAF scrapers (Army/Navy/NAVFAC first, then AF/DLA, then DHA/SOCOM/etc.) into `agency_forecasts`, reusing the civilian forecast pipeline. PRD: **`docs/PRD-dod-forecast-scrapers.md`** (parent: `docs/PRD-dod-forecast-coverage.md`). Eric: save for after current fixes.
- [ ] **Civilian office decode** — GSA/VA/HHS solicitation formats, or join `awards.awarding_office`. Scoped separately (decoder is DoD-only by design).
- [ ] **Expand DoDAAC name lookup** — only ~18 named; unknown DoDAACs show the raw code. A fuller reference table would name more offices.

---

## Session Handoff — 2026-06-05 (Target List perf + SAT data fix; Team filter; sidebar; invite email)

Screenshot-driven fixes. All merged to `main`, deployed, verified on prod.

### Target List — two SEPARATE bugs (Eric: slow load, then "SAT still not fixed")
- [x] **11–14s load → ~1.7s** — commit `b1259f2` ("backfill SAT...live lookup") added a live USASpending `find-agencies` call inside the GET (fires when any target lacks a SAT ratio). That endpoint takes **~40s** (measured), 45s timeout → the whole list BLOCKED on it every load. Fix: gate the live call behind `?live=1`; default load uses fast cache/profile backfill only. `enrichTargetsSat(allowLive)`.
- [x] **Animated loading state** — replaced bare "Loading your target list…" text with a spinner + pulsing skeleton cards (header stays visible), so a slow load never looks frozen.
- [x] **SAT ratio was WRONG (the real data bug)** — VA construction showed **0%** when it's actually **78%** ($16B of $21B set-aside). Cause: rows stored set-aside $ but no TOTAL $; the TMR cache was empty for construction NAICS; only fallback was the flaky 40s call. **Fix: `getAgencySatForNaics()` computes the real set-aside % per agency for a NAICS straight from the BQ awards table (set-aside$/total$), cached (~2.6GB cold scan/sector).** Target-list enrichment now uses BQ as PRIMARY, matched by normalized agency name; result is persisted back to the row. One-time backfill corrected the stuck VA row to 78%. Verified live: SAT now real (Energy 82%, DOT 75%, Interior 67%…), load 1.7s.

### Pipeline — Team / Mine / All filter
- [x] Owner filter on My Pursuits (`ownerOf = owner_email || user_email`). Only shows when the workspace has teammate-owned pursuits. Answers "one person on X, another on Y, but we share."

### Sidebar — collapsed tooltips AND pinned Collapse (the tradeoff, fixed)
- [x] Prior fix toggled nav overflow (visible = tooltips but Collapse pushed off; auto = Collapse but tooltips clipped — they fought over one overflow prop). Fix: nav ALWAYS overflow-y-auto (Collapse pinned) + tooltip rendered once at the aside root with `position:fixed` (escapes the scroll clip). Both now work.

### Team Access — verified + invite email fix
- [x] **Verified** Team Access is real & working: workspace = email domain, invite auto-sends email, shared pipeline (`workspace_id`), activity feed, member roles. `mi_beta_workspace_settings` table + save path healthy (0 rows = unused, not broken). Eric's govcongiants.com workspace already has 3 members.
- [x] **Invite email contrast** — email addresses were dark-blue auto-links on dark navy (unreadable). Wrapped in explicit-colored `<a>` (white inviter, emerald sign-in) so clients don't auto-link with their blue.

---

## Session Handoff — 2026-06-05 (Cron Dispatcher Phase 1 — SHIPPED + verified on prod)

Implemented Phase 1 of `docs/PRD-cron-dispatcher.md` — escapes the Vercel 100-cron cap so scheduling stops growing with features/users. **Live and verified on prod.**

### Shipped
- [x] **Tables** `cron_jobs` (registry) + `cron_job_runs` (history) — `migrations/20260604_cron_dispatcher.sql`. Hand-run in Supabase (no in-app DDL). NOTE: after CREATE TABLE, PostgREST needed `NOTIFY pgrst, 'reload schema';` before writes worked (stale schema cache — known Supabase quirk).
- [x] **Cron evaluator** `src/lib/cron/cron-expr.ts` — self-contained 5-field parser (no new dep), `isDue(expr, now)` in UTC. Unit-tested 12/12 (ranges, lists, steps, day-of-week).
- [x] **Dispatcher** `/api/cron/dispatch?tick=...` — reads enabled jobs, fires the due ones, this-minute dedupe, per-job overlap lock (stale-lock auto-recovers), records each run. Auth: CRON_SECRET / x-vercel-cron / password. `?dry_run=1`.
- [x] **Admin** `/api/admin/cron-jobs` — list jobs+runs, upsert/enable/disable/unlock/delete. **Adding a scheduled job = one POST, no deploy.**
- [x] **vercel.json**: added 2 ticks (`dispatch?tick=hour|day`), migrated 3 low-risk jobs off native cron (refresh-bq-rollups, aggregate-profiles, health-check). **100 → 99 entries**, but ticks now scale to thousands of logical jobs. Load-bearing send pipelines stay native (migrate LAST, Phase 2).

### Verified on LIVE prod (not just local)
Forced a real fire of `aggregate-profiles` via the deployed dispatcher → **HTTP 200, 11s, run row recorded, lock released, last_status=success**, and a second dispatch in the same minute correctly **skipped (dedupe)**. End-to-end proven.

### Bug fixed mid-build
The fireJob claim used `.or('last_run_at.is.null,last_run_at.lt.<iso>')` — PostgREST mis-parses an `.or()` with a colon/dot-laden ISO timestamp ("column does not exist") → claim matched 0 rows → nothing fired. Fixed to CAS via `.is(null)` / `.eq(value)`.

### Next (Phase 2, separate effort — NOT done)
- Migrate the remaining ~24 distinct routes into `cron_jobs` rows, collapse the 21 daily-alerts timezone windows into data-driven "whose local time is now," delete migrated vercel.json entries → target ~6 entries. Do the load-bearing send pipelines LAST, incrementally, with watchdogs intact. Keep briefing-watchdog on native cron as a backstop (dispatcher is now a single point of failure for scheduling).

---

## Planned (not executed) — mi.govcongiants.com → getmindy.ai cutover

**Runbook written + ready:** `tasks/mi-to-getmindy-cutover-runbook.md`. Execute on Eric's go ("do the final migration"). Memory: [[mi_to_getmindy_cutover]].

- [ ] **Final domain migration** — make getmindy.ai canonical, retire mi.govcongiants.com to a **permanent 301 redirect** (NEVER a shutdown — years of email links depend on it). Both domains already run the same code (host-based rewrites), so this is a URL/canonical/redirect migration, NOT an app rewrite. No data migration.
  - Surface (2026-06-05): **139 hardcoded `mi.govcongiants.com` refs / 61 files**, bucketed: (A) env-var fallbacks → set the var; (B) hardcoded URLs (send-email, stripe-webhook, planner, access-links) → code change; (C) host-pinned auth redirects (reset/setup-password) → flip carefully, auth-critical.
  - Sequence: infra/console (DNS, Supabase URL config keeping BOTH redirect URLs during overlap, OAuth, Stripe) → one-PR code change → verify on prod with both live → flip the 301. `auth.getmindy.ai` OAuth surface already done — verify only.
  - Re-run the audit grep first (the 139/61 count may have grown).

---

## Session Handoff — 2026-06-04 (Market Research 0-column + Grants + fiscal-year chart)

More screenshot-driven fixes from Eric clicking through. All merged to `main`, deployed. Render/API-verified (not authed-`/app` clicks — see verify note in the Decision Makers handoff below).

### Market Research (`MarketResearchPanel.tsx`, `api/app/target-market-research`)
- [x] **"Open opportunities / events" column was ALWAYS 0** — real bug. The TMR route matched `sam_opportunities.department` EXACTLY against spending-side agency names, but formats differ ("DEPT OF DEFENSE" vs "Department of Defense", "VETERANS AFFAIRS, DEPARTMENT OF" vs "Department of Veterans Affairs") → exact `.in()` never matched, despite **12,012 future-deadline opps + 1,100 events** in the tables. Fix: `normalizeAgencyKey()` strips department/agency filler to core tokens, buckets both sides by that key. Verified: DoD → 633 open opps, VA → 117, HHS → 21.
- [x] **Confusing headline labels** — Eric "not sure what 'Competition signals' / 'Upcoming signals' mean". Relabeled: "Competition signals" → **"Competitors in your space"** (hint: incumbent primes you'd compete with / team with); "Upcoming signals" → **"Upcoming opportunities"** (hint: forecasts 6–18mo out). `MetricCard` now takes a `hint` subtitle.
- Left alone (Eric said good): Agencies to review, Relevant spending, the report side.

### Federal Grants (`GrantsPanel.tsx`, `api/grants`)
- [x] **Only 25 results, no sense of total** — real bug: route read `data.totalHits` (NOT a real Grants.gov field → empty), so the UI only knew the 25 it fetched. The true total is `hitCount` (e.g. **1,209 posted**). Now: "Showing 25 of 1,209".
- [x] **Can't see more / paginate** — added offset/`startRecordNum` paging + a "Load more (N more)" button that appends. Pages through the full set.
- [x] **Forced profile ranking, no escape** — added a **"★ For me / Newest" sort toggle** (`sort=relevance|newest`). For-me ranks by profile; Newest browses the full unranked list. API returns `total`, `count`, `hasMore`, `hasProfile`, `offset`.

### Contractor award-history chart (`ContractorSalesHistoryDrawer.tsx`)
- [x] **Inconsistent fiscal-year window** — RQ showed 11 yrs ('16-'26), EXCELL only '24-'26 (looked incomplete). Eric: "show the last 10 years, $0 where there's zero, make them comparable." `displaySeries` fills a consistent window (last ~10 FY up to the latest data year, never truncating older real data) with $0 placeholder columns (dimmed + faint baseline stub). EXCELL now reads as a new entrant ('17-'23 = $0, then real bars), directly comparable to RQ.

---

## Session Handoff — 2026-06-04 (Proposal Assist one-one-one simplify)

Eric, testing a Fort Devens Sources Sought pursuit: "Available outputs has two 'Export LOI', then another export, then LOI response sections — a wall of options. For someone over 50 it's confusing. We want ChatGPT-simple: give me an answer. Go back to one-one-one." Merged to `main`, deployed.

### The problem
For SIMPLE responses (Sources Sought / RFI / RFQ — the common case), the output area had **3 overlapping sections doing the same job**: "Available Outputs" cards (Export LOI + Draft sections) + "Output · Word Response Template" (a DUPLICATE export button) + "Output · LOI Response Sections" (per-section editing). Two "Export LOI .docx" buttons, two draft paths. Deltek-style choice overload — the explicit anti-goal.

### Shipped (`src/components/app/panels/ProposalsPanel.tsx`)
- [x] **One hero, one button** — simple mode now shows "Let Mindy write your response" + a single **"Draft my response"** button (= `generateAllDrafts`, the full draft). The ChatGPT "give me an answer" moment.
- [x] **"✓ Pre-filled from the notice"** line in the hero (solicitation #, agency, deadline, NAICS…) so Mindy visibly did the homework.
- [x] **Everything secondary collapsed** behind ONE "More options" toggle (export .docx, blank template, per-section editing) — `showAdvancedOutputs` state gates the two redundant sections.
- [x] **Section editor auto-appears after drafting** (`draftAllSummary || hasAnyDraft`) so users can review/edit without hunting for "More options".
- [x] **Full-proposal (RFP) mode UNCHANGED** — it genuinely needs the multi-output flow (compliance matrix + drafts + package). Only `isSimpleResponseMode` was simplified.

### Principle
Low floor (one obvious action for the new/older user), high ceiling (full control on demand). Filtered through [[mindy_product_principles]].

### Verify
- Built clean + rendered the hero (collapsed + post-draft states). NOT clicked in authed `/app` (Supabase-gated). **This is a core-flow behavior change** — Eric should click through a real Sources Sought pursuit end-to-end and confirm "Draft my response" produces the expected draft + the "More options" reveal works. Screenshot if off.

---

## Session Handoff — 2026-06-04 (Contractors + Decision Makers overhaul, from screenshots)

A long screenshot-driven pass over the Contractors + Decision Makers surfaces. Every item below was render-verified (puppeteer screenshot of real data) before shipping. All merged to `main`, deployed.

### Contractors panel
- [x] **Wired to BigQuery** — was static `contractors.json` (2,768); now `/api/contractors/search-bq` → 317K award-winning recipients with real award $ + counts. Quota-aware (name search ~12-24MB; NAICS via rollup ~6MB; never the 1.2GB awards scan).
- [x] **Company rows link** to `/contractors/[slug]` (canonical `recipientSlug`, verified no 404s).
- [x] **HQ location on cards** (📍 McLean, VA) — disambiguates same-named firms. `recipients` has city+state.
- [x] **State filter** (dropdown) — name-search only; NAICS path has no location (rollup), dropdown hides + `locationAvailable:false`.
- [x] **Award-history drawer fixed** — was "Contractor not found" for ~all BQ firms (only resolved the static 2,768). New `getBqContractorHistory` (resolve by uei/slug → BQ per-recipient functions).
- [x] **Sales-by-Fiscal-Year → vertical column chart** (HigherGov/GovTribe style), was horizontal bars.
- [x] **Per-year agency drill-down** populated for BQ contractors (was empty `agencyBreakdown`); `getYearlyByAgencyForRecipient`.

### Decision Makers tab
- [x] **Honest roles** — SAM POC `title` is null at source, so "Primary Contact" is a POC designation, not a job title. Column → "Role/POC": real role when identifiable (`normalizeTitle`, ~700 of 112K), else muted "Primary POC", junk blanked.
- [x] **Agency → contracting-office drill-down** — built `agency_office_summary` BQ rollup (top 100 offices/agency by spend; one-time 7GB build, ~0.13MB reads). Pick an agency → "Top contracting offices" panel (DoD → NAVAIR $401B, NAVSEA $345B, DLA, DHA, MDA…). HONEST: it's agency intelligence (which commands buy), NOT a contact filter — SAM POC contacts don't carry office. `getOfficesForAgency` contains-matches SAM agency names → rollup names. **Verified against LIVE prod API** (HTTP 200; DoD 100 offices, VA 100, Energy 51) + rendered the panel markup with that live data.

### Research (no build — scoping)
- [x] **`docs/RESEARCH-gov-decision-maker-roles.md`** — probed the sources for real gov roles. Findings: roles are NULL at source (SAM POC title null; FPDS/awards has no CO name, only contractor execs) → real CO/PM/end-user roles need COMMERCIAL enrichment (a buy, not a build). But `awards.awarding_office` is 100% populated → the office drill-down (above) was the achievable win. Memory: [[gov_roles_not_in_sam_fpds]].

### Verification method (this session)
All UI work was verified by hitting the LIVE deployed API with a minted MI token + rendering the panel's real markup against that live data (puppeteer screenshot). NOT a click in the authed `/app` sidebar — `/app` is Supabase-session-gated, so headless can't reach the authed view without real Google/MS/password creds. `scripts/clickthrough-*.mjs` document this. If anything looks off in-browser, screenshot it (that workflow caught the grants "Email required", the contractor 404 drawer, and the empty-office issue this session).

### Follow-ups
- [ ] **Real gov roles** — only via commercial enrichment (HigherGov/LinkedIn-grade). Gate on the tab proving demand. See research doc.
- [ ] **Contractors NAICS+state combo** — state filter is name-search only (rollup has no location). Would need a costlier location-aware NAICS path.
- [ ] **Office → contact join** — solicitation_number prefix encodes the office; decoding it could eventually link POC contacts to offices (sub-project).
- [ ] **Monthly rollup refresh** must now also build `agency_office_summary` (added to `scripts/bq-build-agency-rollups.sql`).

---

## Session Handoff — 2026-06-04 (Vault/Settings IA + NAICS sync fix)

IA cleanup from Eric's review of Vault/Settings/Library + a real data bug found underneath it. All merged to `main`, deployed.

### Shipped
- [x] **Vault "Team" → "Key Personnel"** — the Vault tab is proposal CONTENT (people you put in proposals: PMs, leads, bios/clearances), a different thing from inviting workspace teammates. Renamed to kill the shared-word confusion; empty state points to Settings for account-teammate invites. (No data moved — Eric chose "rename, don't move".)
- [x] **Settings identity clarity** — "Opportunity Matching" now notes company profile (legal name, UEI, certs) lives in My Vault → Identity, so Settings NAICS reads as an alert-matching PREFERENCE, not the authoritative profile.
- [x] **NAICS sync bug FIXED** — the real bug behind the "NAICS in 3 tables" IA question. The daily-alerts cron reads NAICS from `user_notification_settings`, but Vault Identity save wrote `primary_naics` ONLY to `user_identity_profile`. So a user who set NAICS in the Vault (with SAM auto-fill) silently got no matching alerts. **Fix:** on Vault save, seed `user_notification_settings.naics_codes` from the Vault — but ONLY when the alert filter is EMPTY (never clobber a tuned filter). Vault primary_naics = all registered codes (identity); alert naics_codes = what the user chose to watch (preference) — they diverge in practice, so a blind copy would've been worse than the bug. Verified: empty→seeds, tuned→skips. Vault shows an "applied to alerts" note.

### Deliberately NOT done (correct scope)
- The 3rd NAICS copy (`mi_beta_user_settings`, display-only) left as-is — Settings already writes the cron table correctly, so it doesn't affect alerts. The Vault→cron gap was the only real bug.
- The two/three settings surfaces (sidebar gear "Personal Workspace" vs Settings nav) are INTENTIONALLY separate (Eric, May 20) — do NOT merge.

### Vault + Library visual redesign — SHIPPED (from screenshots)
- [x] **Vault content tabs** (Past Performance, Capabilities, Key Personnel) → one consistent **scannable-row** pattern: collapsed rows show key fields inline (e.g. PP = agency · $ · role · period · CPARS), click to expand detail + archive. Replaces the bulky always-expanded cards.
- [x] **Draft badges** — unfilled SAM auto-fill templates (bracketed titles / boilerplate-prompt scope / thin entries) get an amber **"DRAFT — ADD DETAILS"** badge + border; real/complete entries sort to the top. Fixes the "looks full but is all placeholders" problem. Helpers: `isPastPerfDraft` / `isCapabilityDraft` / `isTeamDraft` in VaultPanel.tsx.
- [x] **Library** — was ~40% dead space (empty "Click any entry to preview" pane) + tall snippet-heavy rows. Now: auto-previews the top entry (pane never empty), tightened rows to type · title · agency · date (snippet moved to preview pane), emerald left-border on selected row. Find-and-reuse optimized.
- Each redesign render-verified (puppeteer screenshot of the new markup) before shipping. Eric should eyeball live with real data.

### Verification note
- All Vault/Library/Settings UI work this session was render-verified against sample data, NOT clicked in live `/app` (Supabase-session-gated, headless can't reach the authed view). If anything looks off in-browser, screenshot it.

---

## Session Handoff — 2026-06-04 (Decision Makers tab + Contractors→BQ)

Two data-wiring fixes — surfaced data that existed but wasn't connected. Both merged to `main`, deployed to prod.

### Shipped
- [x] **Government Decision Makers tab** (sidebar → Research). New panel `GovDecisionMakersPanel` + `/api/app/federal-contacts` over the `federal_contacts` table (~112K SAM contacts, synced daily, was never surfaced in UI). Search by name/title, filter by agency + office, dedupes repeat people, reachable (email/phone) first. Honest footnote: SAM POCs = contracting officers/specialists, NOT PMs/end-users yet.
  - [x] **Agency-facet bug fixed (caught by render-verify)** — the agency dropdown returned only **3 of 56** agencies. Cause: `federal_contacts` is alphabetically ordered, so a single `.limit(5000)` only saw the first ~3 agencies' worth of rows. First fix attempt added an early-exit that wrongly returned 12 (DoD spans many consecutive pages, looked "done"). Final fix: page the WHOLE column with **NO early-exit** + a **6h in-memory cache** (`_agencyCache`) so the full scan is a once-per-6h cost. This is exactly why we render-verify — an API smoke test passed while the dropdown was broken.
- [x] **Contractors panel → BigQuery** — was stuck on static `contractors.json` (2,768). Now reads `/api/contractors/search-bq` → `searchRecipients` over BQ recipients: **317,106 award-winning contractors** with real award $ + counts. Dropped SBLO/contact filter (BQ has no contacts — those live in Decision Makers); rows degrade gracefully.

### QUOTA discipline (BigQuery bills by bytes scanned — measured via dry-run)
- Name/state search → `recipients` table: ~12-24 MB.
- **NAICS filter → `top_contractors_by_dimension` rollup (naics dim): ~6 MB.** The naive EXISTS-on-awards was **1.2 GB (200× worse)** — explicitly avoided. NAICS path returns top-50 per code (rollup is top-N), which is what the panel wants.
- All queries via `queryCached` → repeats cost 0 bytes.

### Verification
- API verified live (317K total, name + NAICS paths). Render layer + field-mapping verified by rendering the panel's row markup against the live prod API + screenshot (Booz $21B/858, Leidos $16.6B/11342, etc. — correct).
- **NOT verified:** a literal click in the real `/app` sidebar — `/app` is gated by a Supabase session (not the MI token), so headless can't reach the authed view without live creds. `scripts/clickthrough-contractors-panel.mjs` documents this. If the panel looks off in-browser, screenshot it (caught the grants "Email required" bug fast last time).

### Follow-ups
- [ ] **5-role gov contacts** — Decision Makers shows only `role_category='contracting'`; PM/engineer/end-user need a source (PRD §7).
- [ ] **Link contractor rows to /contractors/[slug]** — BQ route returns `slug`; could make the company name a link to the public profile page.
- [ ] **NAICS coverage** — Contractors NAICS filter = top-50 per code (rollup). Fine for "top performers"; full-list would need a different (costlier) path.

---

## Session Handoff — 2026-06-04 (Podcast Guest Insights · Today's Intel)

Founders-style guest quotes on the **Today's Intel** Mindy Insight hero card, sourced from `podcast_episode_metadata.key_lessons` (Groq extraction on ~312+ guest episodes). **Live in production** at full rollout.

### Shipped
- [x] **`src/lib/rag/podcast-insights.ts`** — NAICS-matched guest quote picker
- [x] **`src/lib/rag/podcast-naics-relevance.ts`** — industry-fit scoring (demotes tangential matches e.g. CMMC in construction NAICS)
- [x] **`src/lib/dashboard/insight-pulse-lesson.ts`** — **pulse vs lesson** selection (not calendar rotation)
- [x] **`/api/app/dashboard/insight`** — builds pulse + lesson candidates, picks winner
- [x] **`MindyInsightCard`** — footer: `today's market` vs `guest lesson`
- [x] **`/admin/podcast-highlights`** — QA UI + API (`op=stats|sample|preview`)
- [x] **Vercel prod** — `ENABLE_PODCAST_INSIGHTS=true`, `PODCAST_INSIGHTS_ROLLOUT_PERCENT=100`

### Pulse vs lesson (one card per day)
| Mode | Source | When |
|------|--------|------|
| **Pulse** | Briefing AI or opp stats | Urgent deadline in briefing (≤14d), weak guest fit, or variety after guest streak |
| **Lesson** | Podcast guest | ≥50% industry fit + primary/sector; ≥36% minimum |

### Env vars (Today's Intel only — NOT daily email)
```bash
ENABLE_PODCAST_INSIGHTS=true          # master switch
PODCAST_INSIGHTS_ROLLOUT_PERCENT=100    # 0–100, deterministic per email
```
**Still OFF for email:** `ENABLE_MINDY_INSIGHTS` / `MINDY_INSIGHTS_ROLLOUT_PERCENT` (per-notice-type RAG in daily-alerts cron — separate feature, crashed batch May 28–31).

### Key files
| File | Purpose |
|------|---------|
| `tasks/podcast-highlights-QA.md` | Ops runbook + enable/disable |
| `scripts/extract-podcast-metadata.js` | Back-catalog `key_lessons` extraction |
| `scripts/export-podcast-highlights-review.js` | Offline HTML QA report |
| `src/lib/rag/podcast-insights-flag.ts` | Feature gate |

### Follow-ups (optional)
- [ ] **`highlight_quotes` column** — shorter punchy pulls if card copy needs ≤15 words without trim
- [ ] **Email Mindy Insights (#91)** — re-enable with per-cron cache only; do not mix with this card path
- [ ] **Cap statement from podcast** (mindy-v2-build-list #8)

---

## Session Handoff — 2026-06-04 (Government Buyer Market Research)

New REVERSE-search feature for federal contracting officers ("find businesses for a requirement"). Merged to `main`, deployed to prod, gated to `gov_buyer` users. PRD: `docs/PRD-gov-buyer-market-research.md`.

### Shipped (all live on prod)
- [x] **`sam_entities` registry** — SAM public entity data, sourced via bulk extract (not the rate-limited API). Migration `20260604_gov_buyer_combined.sql` (hand-run; this DB has no in-app DDL).
- [x] **Active Performer rubric** — scores firms by award history (LEFT-join BQ recipients). Tiers: Active Performer / Capable / Emerging / Registered-Only. Emerging INCLUDED in Rule-of-Two count by default + toggle (fairness rule — never bury new entrants).
- [x] **`/agency` buyer UI** — gated (.gov/.mil → magic link), NAICS+state+set-aside search, market-depth headline, tier breakdown, ranked firm table.
- [x] **`.docx` determination memo export** — the filable artifact (`/api/gov-buyer/market-research/export`).
- [x] **Gov people search groundwork** — `federal_contacts` + `role_category` column (ships `contracting` now; PM/engineer/end-user buckets await a source).
- [x] **`user_type` gate** — `gov_buyer` vs `seller` on `user_profiles`.

### Data coverage (as of June 4, 2026)
- **487,660 entities loaded** (was 160K) across the **6 top services sectors**: 54 (Professional/Tech), 23 (Construction), 33 (Manufacturing), 56 (Admin/Support), 81 (Other Services), 62 (Health). ~85% of where federal set-asides happen.
- Source: SAM `SAM_PUBLIC_MONTHLY_V2_20260503` extract (138MB ZIP). Re-run `SECTORS=.. node scripts/import-sam-entity-extract.mjs` to widen further; `--all-naics` for the full registry.
- Cert rates verified realistic across all sectors: 8(a) 1.2%, HUBZone 0.9%, WOSB 23%, SDVOSB 8.9%, VOSB 13%.
- **Cert source caveat:** 8(a)/HUBZone are SBA-vetted (field 118); WOSB/SDVOSB/VOSB are self-certified (field 32) — memo footnotes this; rubric weights vetted higher.

### Follow-ups (not blocking)
- [ ] **Widen to remaining sectors** if COs query retail/wholesale/transport/ag/finance (44,42,48,11,52...) — extract on disk, cheap re-run.
- [ ] **Monthly freshness** — re-run the bulk import each month (SAM refreshes 1st Sunday); daily API cron top-ups new registrations between extracts.
- [ ] **Cap-statement search (Path A)** — link seller `user_boilerplate_docs` uploads to UEI so buyers see them (PRD §6).
- [ ] **5-role gov people** — source PM/engineer/end-user contacts beyond the KO (PRD §7).
- [ ] **Cron Dispatcher (P1 infra)** — see backlog below; the gov-buyer sync is chained off `sync-sam-opportunities` as a band-aid for the 100-cron cap.

---

## Session Handoff — 2026-05-25 (long Mindy polish session)

### Completed (all live on prod unless noted)
- [x] **Market Research filter strip header** (NAICS · Business · Set-asides · States)
- [x] **MarketMapLoadingBanner** with cycling status messages + shimmer + ping dot
- [x] **Loading banner extended through child-chart settle** (2.5s grace after tmrRows arrive)
- [x] **Data accuracy disclaimer banner** above All Agencies table
- [x] **fpds-top-n cache fix** (any-empty leaderboard now stale, not just all-empty)
- [x] **Total $ column + 'Top Total $' sort lens** (with caveat — uses same sampling pipeline, still inaccurate for high-volume NAICS)
- [x] **'Top Spending' renamed to 'Top Set-Aside $'** (honest label)
- [x] **Drawer Total Spending + Set-Aside Spending tiles** with explanatory hints
- [x] **Leaderboard agency drill-down** (click 'Department of the Army' → filter All Agencies + scroll)
- [x] **Top 10 Funding Agencies leaderboard cut** (near-duplicate of Departments)
- [x] **'Start Here' 3-card row deleted** (broken picker showing Homeland $0/0 as 'best first')
- [x] **SAT sampling fix** — `find-agencies` Pass 3 + target-list GET backfill (TMR cache, profile NAICS, live find-agencies, persists to DB)
- [x] **Pain pts badge clickable** in My Target List → expandable panel with documented issues + priorities
- [x] **Events split into 2 independent toggle buttons** (Scheduled Events purple, Sources Sought amber)
- [x] **SAT% shows 'SAT —' instead of misleading 0%** when sample has no small-dollar contracts
- [x] **Relationships NAICS/Agency inputs live-filter** (350ms debounce)
- [x] **Save+Attach on Discovery tabs** (Save also attaches to selected pursuit in one click)
- [x] **Contextual Teaming Candidates** — filters primes against user's saved target agencies; empty state nudges to save targets
- [x] **SAM.gov System Account application submitted** (eric ops, status: Pending Review)
- [x] **Vercel Static IPs enabled** for SAM allowlist (us-east-1: 34.203.20.143, 3.235.96.207)
- [x] **My Target List table** (`user_target_list` + `user_target_outreach`) created in Supabase

### Reverted — needs redo next session
- [ ] **Start Tracking triage flow** — broke /app with client-side React exception. Rolled back to pre-triage build, then `git revert` of `feb239b` + `939fa3f`. Code preserved in those reverted commits for resurrection. **Next session:** open DevTools console on the previously-broken deploy URL `market-assassin-9p34lmm7a-eric-coffies-projects.vercel.app`, get the actual stack trace, fix the specific line, redeploy. Likely culprits per code audit: TriageAgencyCard import order, useMemo dep array, or hook-order violation when triage modal mounts conditionally.
- [ ] **`user_dismissed_targets` table** was successfully created in Supabase already (NOT reverted). Safe to leave empty; triage code can reuse it on redo.

### Decisions made (and why)
- **Triage modal pattern over per-row buttons** — research showed per-row buttons invite overtracking (users click 20 buttons because it's cheap; capture nothing). Triage forces per-agency decision with rich context. Soft cap at 5.
- **Reverted broken triage rather than guess-fixing in prod** — followed our new "commit before deploy" rule and immediately rolled back when the crash hit. Diagnose with DevTools next session instead of guessing.
- **Honest "SAT —" dash instead of fake number** — for users on construction NAICS, SAT ratio is structurally wrong (sample skewed to mega-contracts). Tooltip explains. Real fix needs USAspending bulk-ingest pipeline (P2 backlog item) OR SAM Contract Data API (Pending Review).
- **Cut Funding Agencies leaderboard entirely** — 95% duplicate of Departments for SMB audience. Cleaner UX wins over preserving the awarding-vs-funding distinction.
- **Contextual Teaming filters by prime.agencies[] not USAspending live query** — fast (no extra API call), good enough. Future: USAspending recipient lookup per saved target for richer signal.
- **Loading banner uses 2.5s timer grace period, not child-state subscription** — the cheap path; child components don't currently expose loading flags upstream. Better v2: refactor to use loading callbacks.

### State at handoff
- Branch: `main`
- Working tree: clean (no uncommitted changes)
- Prod deploy: `market-assassin-nz69587kb` (10m ago, `7c5fc75 fix(research): keep loading banner visible until child charts settle`)
- Aliases: getmindy.ai, tools.govcongiants.org, mi.govcongiants.com (all 200)
- Supabase: `user_target_list`, `user_target_outreach`, `user_dismissed_targets` tables all live in main DB
- Dev server: not running

### Next session priorities (in order)
1. **Diagnose triage crash** (task #47): open DevTools console, get stack trace, fix specific line, resurrect from `git show feb239b -- src/components/app/panels/triage/StartTrackingModal.tsx` etc.
2. **SAT% fix (sampling)** — Pass 3 in `find-agencies` fetches ≤$350K awards; target-list GET backfills `sat_ratio` from TMR cache when snapshot was 0 (2026-06-04)
3. **Check SAM System Account status weekly** (task #20) — if approved → can build real office-level data layer
4. **Other ideas surfaced this session:**
   - Map "Reports" view is still confusing — needs an audit similar to what we did for Map view
   - Bigger USAspending bulk-ingest pipeline (P2 todo entry already written) becomes relevant if SAM access doesn't land

### Notes for next session
- The user has SAM Joint Account Holder still set as himself (against video instruction). May get rejected for self-approval. If so: pick a teammate (Branden was the planned choice), have them register a SAM account, edit the request.
- Vercel Static IPs cost $100/mo (us-east-1 only, dropped us-west-1 to save $50/mo). Live now.
- Memory `commit-before-deploy.md` saved — future sessions should commit then deploy, not the reverse. Saved us tonight when we needed to rollback.
- The user appreciates honest disclaimers over fake data. Pattern: when something's structurally inaccurate, surface a tooltip/banner explaining why instead of hiding the limitation behind nice-looking numbers.

---

## P0 - CRITICAL (This Week)

*No critical items - security audit complete!*

### Signup Health Monitoring System - Enterprise Grade
**Status:** ✅ COMPLETE - Deployed May 14, 2026

**Features Built:**
- [x] Synthetic monitoring (automated tests against signup endpoints)
- [x] Funnel analytics (track drop-offs at each wizard step)
- [x] Error rate tracking by type (auth_failed, validation, api_error, etc.)
- [x] Health score calculation (0-100) with degraded/critical states
- [x] HTML dashboard view at `?format=html`
- [x] Event logging in save-profile API

**Admin Endpoints:**
- Dashboard: `/api/admin/signup-health?password=xxx&format=html`
- JSON: `/api/admin/signup-health?password=xxx`
- Migration: `/api/admin/apply-signup-events-migration?password=xxx`

**Database Tables (pending migration):**
- `signup_events` — Individual funnel event tracking
- `signup_health_metrics` — Daily aggregated health metrics

**What It Tracks:**
| Event | When Logged |
|-------|-------------|
| `signup_started` | When user hits save-profile API |
| `signup_completed` | When profile successfully saved |
| `signup_failed` | On auth/validation/database errors |

**Health Scoring:**
- 95%+ success rate → 100 (healthy)
- 80-94% → 80 (healthy)
- 50-79% → 50 (degraded)
- <50% → 20 (critical)

---

### SAM.gov Sync Pipeline - Production Grade
**Status:** ✅ COMPLETE - Deployed May 14, 2026

**Features Built:**
- [x] Resumable sync with checkpoint tracking (per-page offsets)
- [x] Multiple cron schedules (1 AM full, 9 AM resume, 1 PM delta, 3 PM watchdog)
- [x] Watchdog cron with auto-recovery (triggers delta/full based on health)
- [x] Health monitoring dashboard (`/api/admin/sam-sync-status?format=html`)
- [x] Stale record cleanup only runs after successful FULL sync
- [x] Retry with exponential backoff (3 retries, 5s→10s→20s)

**Cron Schedule (UTC):**
| Time | Type | Purpose |
|------|------|---------|
| 1 AM | full | Complete 30-day sync |
| 9 AM | resume | Continue from last failed checkpoint |
| 1 PM | delta | Quick refresh of recent changes |
| 3 PM | watchdog | Health check + auto-recovery |

**Admin Endpoints:**
- Status: `/api/admin/sam-sync-status?password=xxx&format=html`
- Watchdog: `/api/cron/sam-sync-watchdog?password=xxx`
- Trigger sync: `/api/cron/sync-sam-opportunities?type=delta&password=xxx`

**Current Health (May 14, 2026):**
- Health Score: 100/100
- Active Records: 29,695
- Cache Age: ~11 hours
- Consecutive Failures: 0

---

## P1 - HIGH (This Sprint)

### MI Operating System - Skills and Agents
**Status:** Started (specs written, PRDs created)

**Why High:** Foundation for scalable team operations.

**Next Actions:**
- [ ] Review MI Operating System Roadmap (`tasks/MI-OPERATING-SYSTEM-ROADMAP.md`)
- [ ] Review Dashboard Clarity Skill with current admin dashboard
- [ ] Use Launch Memo Skill for May 30 bootcamp/MI launch
- [ ] Generate Annelle/Sikander qualified outreach list via Customer Qualification Agent
- [ ] Identify Eric's next founder-call list via 10-10 Forever Customer Strategy

### Wire MI Internal Launch Command Center
**Status:** ✅ V2 COMPLETE - Live data connected

**Connected Data Sources:**
- [x] MI Growth Brief (user engagement, email metrics, behavioral queues)
- [x] Customer Qualification Agent (purchase-based scoring, 10-10 candidates)
- [x] Launch Manager Brief (domain policy, launches, owner actions)

**Live Queues:**
| Queue | Source | Count |
|-------|--------|-------|
| Setup Invite | Growth Brief | 25 |
| Profile Nudge | Growth Brief | 25 |
| Activation Rescue | Growth Brief | 25 |
| Pro Upgrade | Growth Brief | 25 |
| Founder Calls | Qualification Agent | 10 |
| Sales Outreach | Qualification Agent | 14 |
| Rescue Queue | Qualification Agent | 1 |

**Remaining (Low Priority):**
- [ ] Add owner-updated launch action tracking
- [ ] Add "Mark Contacted" buttons on queue items

### Update Email Templates for Correct Domains
**Status:** Needed for domain migration

- [ ] Sales/content CTAs → `govcongiants.com`
- [ ] Product/account CTAs → `getmindy.ai` (was `mi.govcongiants.com`)
- [ ] Audit all email templates in `src/lib/send-email.ts`

---

## P2 - MEDIUM (Next 2 Weeks)

### Batch Enroll Bootcamp Attendees
**Status:** 8,804 emails ready in `data/bootcamp-attendees-to-enroll.txt`

**When:** After 2-3 weeks verifying current 457 users

```bash
cat data/bootcamp-attendees-to-enroll.txt | while read email; do
  curl -s -X POST "https://tools.govcongiants.org/api/alerts/save-profile" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$email\", \"naicsCodes\": [\"541512\", \"541611\", \"541330\"], \"businessType\": \"\", \"source\": \"free-signup\"}"
done
```

### Domain Migration to `getmindy.ai`
**Status:** Domain purchased May 13, 2026

Not blocking anything - `mi.govcongiants.com` works fine. Brand improvement.

- [ ] Configure DNS for `getmindy.ai`
- [ ] Add compatibility redirects from `mi.govcongiants.com` → `getmindy.ai`
- [ ] Update Supabase auth redirect URLs
- [ ] Update email templates for `getmindy.ai` links
- [ ] Update social/YouTube/LinkedIn URLs

### SEO Contractor Pages Improvements
- [ ] Add Search Console data to candidate scorer
- [ ] Add MI usage events tracking
- [ ] Add route-crawl canonical status
- [ ] Fix public contractor page canonicals to `govcongiants.com`

### Recompete Tracker: Expand to 2027 Data
**Current:** 9,450 contracts, all 2026 expirations
**Target:** Add contracts expiring through Oct 2027 (18-month window)

```bash
# Fetch and preview 2027 data
node scripts/fetch-2027-contracts.js

# Fetch and merge into contracts-data.js
node scripts/fetch-2027-contracts.js --merge
```

- [ ] Run 2027 fetch script
- [ ] Verify data quality (no duplicates)
- [ ] Update cron job date range
- [ ] Deploy with expanded dataset
- [ ] Update "Data Through" display

---

### USAspending Bulk Ingest → SAT% Precompute Pipeline
**Goal:** Replace runtime SAT% calculation (broken by USAspending API sampling bias — shows 0% / dash for large NAICS like construction) with a precomputed lookup table powered by USAspending's bulk award archive downloads.

**Why this exists:** Investigation 2026-05-25 found that find-agencies samples ~10K awards sorted by Amount desc, so for high-volume NAICS the sample is all mega-contracts; ZERO fall under the $350K SAT threshold; computed SAT% = 0. MA's Federal Market Assassin shows correct numbers (Coast Guard 95.5% etc.) only because the user happened to search a smaller NAICS where the sample captures the right awards. Same bug, different surface.

**Research finding (2026-05-25):** No public source publishes pre-aggregated "% under $350K per agency × NAICS." Closest is USAspending's free Award Data Archive (https://www.usaspending.gov/download_center/award_data_archive) which provides transaction-level `Contracts_Full_FYxxxx.zip` per agency. ~5GB total for FY2024+FY2025, ~50M rows.

**Architecture (locked):**
- **New analytics Supabase project** (`usaspending-analytics`) — holds 50M-row `usaspending_awards` raw table + ingest jobs + heavy aggregation queries. App never reads from it.
- **Main Supabase (market-assassin)** — adds small `agency_sat_stats` table (~5K rows) that the app reads at request time. Populated by a "publish" step at end of each precompute.
- **Granularity:** sub-agency level for civilian (Coast Guard ≠ FEMA), parent-agency level for DoD (Navy total, not split into NAVFAC/NAVSEA — DoD has too many sub-agencies to enumerate quarterly).
- **Scope:** 25 cabinet departments + their major sub-agencies (~30-50 ZIPs per FY).
- **Refresh:** Monthly delta for current FY using `Contracts_Delta` files + one-shot ingest for closed FYs.
- **Triggers:** Monthly cron (1st of month) + admin manual endpoint `/api/admin/recompute-sat?password=`.

**Consumers (read from `agency_sat_stats` in main DB):**
- Mindy `find-agencies` (replaces broken runtime calc)
- My Target List SAT badge
- Market Map drawer SAT % tile
- MA `ReportsDisplay` "Entry Accessibility" table

**Engineering ETA:** ~11hr total, split into 4 phases:
- Phase 1 (~4hr): Create analytics Supabase project, schema migration, one-shot script to download FY2024 closed data, parse, load
- Phase 2 (~3hr): SAT% computation query + summary table publish step to main DB
- Phase 3 (~2hr): Update find-agencies + UI consumers to read from `agency_sat_stats`
- Phase 4 (~2hr): Monthly delta cron + admin manual trigger endpoint

**Prerequisite from Eric:** Create new Supabase project named `usaspending-analytics` (us-east-1, free tier to start), share `URL`, `service_role_key`, `anon_key`.

**Potential blocker / decision point:** SAM.gov System Account application is currently Pending Review (submitted 2026-05-24, see [`oauth-branding-runbook.md`](./oauth-branding-runbook.md) and task notes). If SAM access is approved in <3 weeks, the SAM Contract Data API gives clean office-level real-time award data that makes this whole bulk-ingest approach redundant. **Recommendation:** check SAM status weekly; if still pending after 3 weeks, proceed with bulk-ingest build. If SAM approves first, scrap this and use SAM data directly.

**Interim state (shipped 2026-05-25):** Honest 'SAT —' dash + tooltip explaining the sampling skew. Users no longer see misleading 0%.

---

## P3 - LOW (Backlog)

### Phase 1A: 21-Day Free Trial System
- [ ] Add `trial_start_date`, `trial_end_date` columns
- [ ] Create trial signup flow
- [ ] Email sequence (welcome, day 14, day 18, day 21)
- [ ] Trial expiration cron

### Phase 1B: Weekly Bids Report
- [ ] New cron `weekly-bids-report` (Monday 6 AM local)
- [ ] Query SAM.gov for all open opps by user NAICS
- [ ] Categorize by notice type
- [ ] Format as digest email

### BD Assist Enhancements
- [ ] Add Teaming tab UI
- [ ] Connect Intel tab to Daily Briefings
- [ ] Add more forecast sources (DOD, HHS, USDA)

### Phase 3-4 Forecast Scrapers (Puppeteer)
| Agency | Source | Est. Coverage |
|--------|--------|---------------|
| HHS | procurementforecast.hhs.gov | $12B |
| Treasury | osdbu.forecast.treasury.gov | $2B |
| EPA | ordspub.epa.gov | $1.5B |
| USDA | forecast.edc.usda.gov | $4B |
| DOD | Multi-source | $40B |

### Teaming Network Visualization
**Blocked:** Waiting on SAM.gov System Account approval (1-4 weeks)

---

## DEFERRED - Infrastructure Scaling

### QStash Queue Architecture (For 10K+ Users)
**When:** Approaching 10K users or hitting cron limits

Replace multiple Vercel crons with queue-based processing:
- 1 cron enqueues all users → QStash processes in parallel
- Eliminates 100-cron Vercel limit
- Better retry handling and observability

### Supabase-Backed Access Links
**When:** KV costs become significant or need audit logging

Move access link tokens from KV to Supabase:
- Store hashed tokens in `mi_access_links` table
- KV becomes optional cache only
- Adds audit trail of link usage

### Mindy Mobile App (React Native)
**When:** User demand justifies 2-3 month build
**Decision:** May 14, 2026 - Eric chose Option 3 (React Native) for true native feel

Build native iOS/Android apps:
- React Native rebuild of MI dashboard
- Reuse existing APIs and backend
- Push notifications for daily briefings
- App Store ($99/yr Apple) + Play Store ($25 one-time)
- Estimated: 2-3 months development

---

## COMPLETED (Reference)

### May 13, 2026
- [x] **Command Center V2 - Live Data Wiring** - Connected real-time data to Command Center
  - Wired MI Growth Brief (behavioral queues: setupInvite, profileNudge, activationRescue, proUpgrade)
  - Wired Customer Qualification Agent (purchase-based queues: founderCalls, salesOutreach, rescueCandidates)
  - Added 4 segment stat cards (10-10 Candidates, Activation, Rescue, Total Purchasers)
  - Added Founder Call Queue with email/score/why display (top 8)
  - Added Sales Outreach Queue with email/score/why display (top 8)
  - Added Rescue Queue (at-risk paid customers)
  - Live: `mi.govcongiants.com/admin/launch-command-center`
- [x] **Customer Qualification Agent** - Built scoring system for outreach prioritization
  - Scores based on purchases (30pts Ultimate, 25pts MI Pro, 20pts multiple)
  - Scores based on engagement (15pts profile, 10pts NAICS, 10pts briefings)
  - Segments: 10-10 Candidate, White-glove, MI Pro Upgrade, Rescue, Activation
  - API: `/api/admin/qualify-customers` with CSV export
  - Commit: `8f0ca70`
- [x] **MI Daily Brief Generator** - Transform dashboard metrics into actionable brief
  - Health Score (0-100) with Decision Levers
  - Answers 10 key questions from MI OS
  - Copy to Slack button for team sharing
  - Commit: `e9fddd0`
- [x] **API Security Audit COMPLETE** - Hardened 31 routes with `verifyUserOwnsEmail`
  - Routes now verify authenticated user owns the email they're querying
  - 19 routes use `verifyUserOwnsEmail`, 12 use `requireMIAuthSession`
  - Commit: `0a648f7` (24 files, 813 insertions)
- [x] Daily Alerts Schedule moved earlier (1 AM - 6 AM ET)
- [x] Upstash KV upgraded to Pay As You Go
- [x] Upstash QStash installed (Pay As You Go)
- [x] Fixed 141 failed alerts from KV quota

### May 9-10, 2026
- [x] Created canonical route map
- [x] Confirmed MI sales pages belong in funnels repo
- [x] Built MI Internal Launch Command Center V1 shell
- [x] Converted agent specs into implementation PRDs
- [x] Built read-only MI Growth Brief endpoint
- [x] Built Launch Manager brief generator
- [x] Built SEO Contractor Pages candidate scorer
- [x] Created Team Alignment Slack Brief

### April 20, 2026
- [x] Fixed Briefing Type Collision (unique constraint)
- [x] Fixed Daily Briefings Dedupe
- [x] Fixed Pursuit Logging
- [x] Fixed Weekly-Alerts Batching
- [x] Fixed Precompute Capacity (10→25 profiles/run)
- [x] Fixed Rollout Tracking

### April 19, 2026
- [x] Expanded agency intelligence: 250→307 agencies
- [x] Added 280 pain points from GAO reports
- [x] Added 111 priorities from spending patterns

### April 16, 2026
- [x] Added SBIR + Grants tabs to MI Dashboard
- [x] Created `/api/grants` and `/api/sbir` endpoints

### April 14, 2026
- [x] Fixed Supabase lazy initialization build errors
- [x] Created `usaspending_awards` table
- [x] Created `sam_events` table

### April 11, 2026
- [x] Deployed BD Assist Platform Phase 1 & 2
- [x] Built Federal Market Scanner (6-question intelligence)
- [x] Built Pipeline Tracker Kanban
- [x] Built Teaming CRM

### April 6, 2026
- [x] Forecast Intelligence: 7,764 forecasts from 13 agencies
- [x] GSA Acquisition Gateway CSV import script

### Earlier Sessions
- [x] Agency Hierarchy API v2 (Moat 7)
- [x] SAM.gov API Integration (Phase 1-4)
- [x] Multisite Aggregation scrapers
- [x] Daily Briefings system (all 3 types)
- [x] USASpending MCP fix

---

## Quick Reference

**Projects:**
- Market Assassin (tools): `~/Market Assasin/market-assassin`
- GovCon Shop (production): `~/govcon-shop`
- GovCon Funnels (marketing): `~/govcon-funnels`

**Resume:** `/continue`

**Health Check:**
```
HTML: https://tools.govcongiants.org/api/cron/health-check?password=$ADMIN_PASSWORD&format=html
JSON: https://tools.govcongiants.org/api/cron/health-check?password=$ADMIN_PASSWORD
```

---

## Key Specs (for reference)

| Spec | Location |
|------|----------|
| Canonical Domain Map | `tasks/CANONICAL-DOMAIN-ROUTE-MAP.md` |
| MI Operating System Roadmap | `tasks/MI-OPERATING-SYSTEM-ROADMAP.md` |
| Dashboard Clarity Skill | `tasks/skills/dashboard-clarity-skill.md` |
| Launch Memo Skill | `tasks/skills/launch-memo-skill.md` |
| API Security Audit PRD | `tasks/PRD-api-security-audit-agent.md` |
| MI Growth Ops Agent PRD | `tasks/PRD-mi-growth-ops-agent.md` |

# Mindy — Later Backlog (deferred work, save & pick up)

> A standalone, prioritized list of everything queued for "later" as of
> **2026-06-05**. Each item links its PRD/research doc. Pick top-down; the
> P0/P1 items are the highest-leverage. Nothing here is in-flight — all current
> session work is shipped & deployed.

---

## ✅ SHIPPED 2026-06-05 (this session — all deployed to getmindy.ai)

**Proposal Assist Manual Drive (v1)** — Auto↔Manual·Sport toggle (top/Start-Here),
`/api/app/proposal/chat` grounded in user's RFP+Vault, ProposalChat.tsx,
Verify-on-SAM link. Loads ALL pursuit PDFs (was 1). PRD-proposal-manual-mode.

**Target-List hub** (PRD-relationships-from-target-list, **v1 + v2 SHIPPED**):
- Decision Makers defaults to **⭐ My Targets** (user's target agencies).
- Relationships: attach to **AGENCY not pursuit**; pursuit-attach optional.
- My Target List row → **🤝 Relationships at this agency →** (pre-scoped).
- **v2:** My Network grouped by agency + relationship **stages** (prospect→warm
  →contacted→met→champion, color chips, persist). Migration
  `20260605_relationships_v2.sql` RUN + verified (7/7 backfilled, writes work).
- Team Access moved **Pipeline → Account**.

**QA bug fixes (from Eric's live walk-through):**
- Today's Intel stat cards/tabs now scroll to results + show filter state.
- Contractor award-history drawer uses BQ (BL Harbert → 11yrs/$11B, was empty).
- Forecasts shows DoD early signals on the default "All agencies" view.
- DoDAAC office names: stripped FPDS code prefixes (W7NC… → real names).
- Decision Makers "Track" shows where it went (→ My Target List).

**Proposal RAG-as-standard + SOW (PRD-proposal-ingestion-rag-standard, v1 partial):**
- Manual Drive chat now retrieves the proposal RAG (winning volumes/templates)
  as the build STANDARD — not just RFP+Vault. Auto already did.
- SOW/PWS → standalone .docx ("📄 SOW for subs") for sub pricing/bids.
- Compliance matrix grouped BY section (L / M / C headers).
- **Remaining v1:** ingestion criteria doc + admin ingest path; full-proposal
  smoke test. **v2:** notes, who/status, draft versions.

**Knowledge Base repository (PRD-knowledge-base-repository — SHIPPED):**
- Searchable repository page over `mindy_rag_documents` (1,310 user-facing docs)
  in Research nav; split-pane reader + doc_type facets. PII/internal excluded.
- Mindy Chat source chips deep-link into it (`?doc=id`) — "show me the source"
  lands on the real page. NOT a separate domain (in-app panel, per architecture).

**Pursuit change/amendment alerts (SHIPPED, scale-ready):**
- Monitors tracked pursuits (notice_id, non-archived) for: deadline moves,
  amendments (SAM last_modified), notice-type changes (incl. cancelled/awarded),
  new documents. Email digest (sendEmail/Resend) + "⚠️ N changes" badge on
  pursuit cards (ack to clear). Owner-attributed (workspace-safe).
- **Scale:** BATCH + RESUMABLE like daily-alerts — `BATCH_SIZE` env
  (`PURSUIT_CHANGES_BATCH_SIZE`, default 100), least-recently-checked cursor,
  45s soft budget, returns `remaining`. On the dispatcher as a window
  (`*/15 13,21 * * *`) that drains remaining. Bounded load at 1000s of pursuits.
- Migrations RUN: `20260605_pursuit_change_alerts.sql` (pursuit_change_log +
  pursuit_monitor_state). 32 baselined. First run snapshots (no false alerts).
- **Manual Drive → Perplexity Spaces layout** (files rail + instructions).

**Growth/virality (earlier today):** Share button restored, share links →
getmindy.ai, dynamic share previews (OG), Meet Mindy strip on public pages.

---

## 🔄 Reviewed & updated 2026-06-26 (demo-prep session)

**Status corrections — these were marked deferred but are already DONE since the Jun 5 snapshot:**
- ✅ **Coach Mode v1 — SHIPPED** (was P0 #1z "designed, never built"). Client
  switcher + per-client pipeline/vault/profile, workspace-scoped reads
  (`src/lib/mindy/coach-access.ts`, `/api/app/coach`, Source Feed/Auto-setup
  scoped to active client). **v2 still deferred:** Slack/Outlook/Drive
  integrations, branding, coach analytics.
- ✅ **Cron Dispatcher Phase 2 — largely done.** Many jobs migrated since Jun 5
  (setup-invite-batch, zero-alert-nudge, snapshot-metrics, pursuit-changes,
  check-data-freshness, refresh-dodaac-directory, backfill-event-offices).
  Remaining: confirm the load-bearing send pipelines are migrated LAST with
  watchdog backstop intact.
- ✅ **dodaac_directory monthly refresh — SHIPPED** (`refresh-dodaac-directory`
  on the dispatcher).
- ✅ **Event office-tagging — SHIPPED this session (PR #28).** Events decode their
  buying office from the solicitation-number DoDAAC (`inferred_office`/
  `inferred_subagency`); backfill drained (~40% of ~1,980 events tagged). **This
  makes P2 "Civilian office decode" the clear next step** — civilian agencies
  (GSA/VA/HHS) have no DoDAAC and still fall back to department-level.

**Newly deferred this session (Jun 26):**

### Ingest the FULL GovCon Giants content library into Mindy RAG (moat) — ⭐ V2 FLAGSHIP
- **When:** **V2 — start AFTER Mindy Day** (demo Jun 27, 2026). Confirmed by Eric
  Jun 26: do the full ingestion post-demo as the headline v2 capability. Not a
  pre-demo task; the demo runs on the current ~1,364-doc slice.
- **Why:** the knowledge base IS the moat (8 yrs teaching). Mindy's RAG today
  (`mindy_rag_documents` ~1,364 docs / 12,534 chunks) has only a SLICE — ~136
  course_material, 103 slide_deck, 31 webinar_resource, 743 podcast_interview. Two
  big sources are NOT fully ingested (Eric, Jun 26 — "make sure later our Mindy RAG
  has all of this content"):
  1. **Federal Help Center course videos** — MUCH bigger than first noted (Eric
     screenshots Jun 26). VIDEO → transcription (Whisper) → embeddings (same pipeline
     as the 743 podcasts). Scope:
     - **Federal Contract Academy**: Essentials 81 + Comprehensive 108 + Mastery 68
       = 257 lessons; plus a 258-lesson Overview library.
     - **Bootcamp Replays**: years of **Coaching Call Replays 2018→2024** (~137
       lessons) + recent **Surge/Proposal/Business-Readiness Bootcamps 2024→2026**
       (~65 lessons).
     - **First Partner Challenge**: 1st Cohort Recordings (30) + cohorts + Blueprint
       to Consulting Course (13) + Resources/Templates/Scripts (~60 lessons total).
     - **Webinar Replays, Q&A Sessions, Roadmap/Action Plan**.
     - Rough total: **~700–1,000+ video lessons** — a real transcription budget;
       phase it (Academy first, then bootcamps/coaching, then replays).
  2. **GOVCON EDU "The Vault" Google Drive** — document library: Teaming/
     Subcontracting, Target Market List, Supplier Credit, Scripts, SB Certification,
     SAM Bid Sites, Proposal Writing, NAVFAC SB Specialist POCs, Joint Venture Docs,
     Indefinite Delivery Vehicles, FAR, Estimating, + more. DOCS → ingest via the
     existing RAG doc pipeline (pdf-extract + embeddings; Google Drive MCP available).
- **Scope/effort:** transcription cost for ~500+ videos + Drive folder crawl +
  embeddings + doc-type tagging. Strengthens the Data Core "knowledge base" count
  and every grounded surface (Mindy Chat + Proposal Assist's winning-proposal corpus).
- **Guardrail:** filter `has_pii` / internal-only docs (same as Knowledge Base repo).

### Auto-seed My Target List from the profile's chosen target agencies — V2 (Eric, Jun 27)
- **The gap:** today there are TWO disconnected concepts. The profile's **target
  agencies** (`user_notification_settings.agencies`) drive view filters/defaults
  (e.g. Decision Makers "⭐ My Targets"), but **My Target List** (`user_target_list`)
  only fills when the user clicks **"✨ Set up my Mindy"** — which seeds the top ~8
  *buying* agencies by set-aside spend from the NAICS scan (`/api/app/auto-setup`,
  `MAX_AGENCIES=8`), NOT the agencies the user explicitly picked. Onboarding doesn't
  seed the list at all. So a user who hand-picks target agencies never sees them in
  My Target List automatically — an expectation mismatch (Eric, coffiemiami test).
- **V2 behavior:** on onboarding finish AND on profile save, automatically upsert the
  user's chosen `agencies` into `user_target_list` — enriched the same way auto-setup
  enriches each row (spend, sources-sought, events, contacts). ADD-ONLY (reuse the
  existing 23505 unique-constraint → "skipped", never clobber Sport/hand-added rows).
- **Approach:** reuse `auto-setup`'s add-only insert + the find-agencies/office
  resolution to turn each chosen agency NAME into a proper target row (resolve its
  buying office/spend). Optionally MERGE: chosen target agencies first, then fill to
  N with the top NAICS buyers (so the list = "who I picked" + "who else buys my work").
- **Trigger:** onboarding completion hook + a `save-profile`/notification-settings
  write hook (debounced) so changing target agencies keeps the list in sync (add-only).
- **Guardrail:** never delete user rows on profile change (add-only); a removed target
  agency stays in the list unless the user removes it explicitly.

### Office / agency-name normalization — full pass (POST-DEMO, scope-first per Eric Jun 27)
- **Why:** terse military/civilian office codes read as alphabet soup, and command
  families blur together. PR #69 already added the Army command tokens; this is the
  REST, scoped as ONE deliberate pass instead of piecemeal token adds (Eric: "before
  making sweeping changes scope everything first").
- **Surface (why it's sweeping):** there are THREE parallel normalizers, consumed
  across ~14 files — do NOT extend them independently again:
  - `expandOfficeName` + `OFFICE_ABBREV` + `formatDodaacOffice` (`src/lib/gov-contacts/dodaac.ts`)
  - `cleanOfficeNameForDisplay` + `OFFICE_ABBREV` + `OFFICE_ACRONYMS` (`MyTargetListPanel.tsx`)
  - `enhanceOfficeName` (`src/lib/utils/usaspending-helpers.ts`)
  - Consumers: Alerts, MarketResearch, MyTargetList, Pipeline, Proposals, Recompetes
    panels + find-agencies / find-hit-list / government-contracts / forecasts /
    federal-contacts routes + `useDodaacNames.ts`.
- **Gaps (data-driven from public/contracts-data.js Office field):**
  - **GSA — biggest (~2,300 offices), slash-delimited soup** `GSA/FAS/PSHC/PROF SRVCS
    SCHED-PSS`: FAS→Federal Acquisition Service, PBS→Public Buildings Service,
    ITC→IT Category, PSS→Professional Services Schedule, SCHED→Schedule, ACQ→Acquisition,
    SRVCS/SVCS→Services. **Needs a splitter tweak** — the expander only splits on
    whitespace, so `GSA/FAS/ITC` is one token and never expands today.
  - **Air Force AFLCMC** (Life Cycle Management Center; strip the leading `FA####` DoDAAC,
    leave program codes `LPK/EBHK` as-is), **Navy NSWC** (Naval Surface Warfare Center),
    **VA NAC** (National Acquisition Center), **FWS** (Fish & Wildlife Service).
  - **Leave alone:** DLA (already reads fine), NIH internal codes (`NITAA DITA-DVI`),
    raw DoDAACs (`W6QK`, `36F797` — those should be DECODED/stripped, not expanded),
    generic words (TECH/INFO/HQ/AWARD).
- **Ambiguity to handle (don't blind-expand):** `ACC` = Army Contracting Command
  (`W6QK ACC-PICA`) vs Air Force **Air Combat Command**. Make it **context-aware**:
  expand to Army Contracting Command ONLY when the DoDAAC/PIID starts with `W`.
- **Proposed phases:**
  1. ✅ **DONE 2026-06-28 (phase 2a) — branch `feat/office-name-normalizer-consolidation`.**
     Consolidated the 3 normalizers into ONE shared `normalizeOfficeName(name, {mode})`
     (`src/lib/gov-contacts/office-name.ts`); the three legacy behaviors are ported
     VERBATIM as `mode: 'expand' | 'clean' | 'enhance'` (parity-first, ZERO display
     change). All in-scope consumers swapped + old fns deleted: `expandOfficeName`
     (dodaac.ts → federal-contacts + internal formatDodaacOffice), `enhanceOfficeName`
     + `officeNameEnhancements` (usaspending-helpers → find-hit-list + find-agencies),
     `cleanOfficeNameForDisplay` (MyTargetListPanel).
  2. ✅ **DONE 2026-06-28 (phase 2c) — GSA slash-soup.** `clean` mode gained a
     delimiter-aware path (split on `/ - ,`) + a GSA token set (FAS→Federal
     Acquisition Service, PBS→Public Buildings Service, ITC→IT Category, PSS, SCHED,
     ACQ, SRVCS/SVCS). Gated to strings starting `GSA/` → 22 GSA strings improved in
     My Target List; every non-GSA `clean` + all expand/enhance output stays
     byte-identical. Golden regenerated to bless the diff; parity green (2,379).
     **Scope held:** `clean` mode only (the wired GSA surface — My Target List).
     Wiring GSA normalization into other panels that show raw office (Recompetes
     fallback, etc.) is a 2d/display decision.
  3. ⏳ **NEXT (phase 2d)** — AF/Navy/VA acronyms + **context-aware ACC** + DoDAAC-code
     stripping. ALSO fold in the **4th cluster discovered during 2a**:
     `src/lib/government-contracts.ts` has its OWN `expandOfficeName` /
     `enhanceOfficeName` / `officeNameEnhancements` (agency-acronym expansion; only
     consumed by `/api/government-contracts/search`) — left untouched in 2a to hold
     scope; converge it here.
  4. ✅ **DONE 2026-06-28 (phase 2b) — Golden-file test.** `tests/office-name-parity.test.mts`
     locks `normalizeOfficeName` output against a frozen baseline of 793 REAL office
     strings (`tests/fixtures/office-name-corpus.json` from contracts-data.js) × 3 modes
     = 2,379 checks. Baseline regenerator: `scripts/office-name-golden.mts`. Wired into
     `tests/test-pre-deploy.sh`. When 2c/2d changes behavior, re-run the generator and
     commit the blessed diff.
- **Risks:** broad blast radius (14 files); over-expansion verbosity vs 28-char chart
  truncation (favor recognizable acronyms where space is tight); mislabeling from
  ambiguous tokens (the ACC trap). The golden-file test is the guardrail.
- **Effort:** ~½–1 day for the consolidation + GSA; the rest is incremental token adds
  behind the shared normalizer + test.

### Proposal Assist — Tier 2 multi-pass volumes
- **Status:** ✅ **MERGED 2026-06-28 (PR #34, commit `6d919b46`)** — still gated OFF
  via `PROPOSAL_MULTIPASS` (unset = no behavior change in prod). Code is on main.
- **What:** batches a section's compliance requirements → drafts each batch in
  parallel as a subsection → assembles 50-100+ page volumes. Tier 1
  (situation-aware single-pass length) already SHIPPED (PR #33).
- **REMAINING to turn it on:** set `PROPOSAL_MULTIPASS=1` in Vercel (+ optional
  `_THRESHOLD`/`_BATCH`/`_CONCURRENCY`) and QA one long RFP — this is a WATCHED step
  (a heavy section fires ~25 LLM calls), do NOT enable blindly. Follow-ups in
  `src/lib/proposal/multi-pass.ts` header: context-reuse refactor (load vault/RAG
  once per section), optional intro+TOC pass, per-user LLM budget guardrails.

### Free-user tracking (pricing decision — parked, Eric's call)
- **What:** let FREE users track opportunities (My Pursuits) from Market Research.
  Backend `/api/pipeline` already accepts free posts — it's purely a UI/pricing
  gate (UnifiedSidebar tier list + MarketResearchPanel track button + target-list
  402).
- **Open question:** full-free vs capped (e.g. 10 items) vs keep Pro-only.
  Changes a documented Pro differentiator → Eric decides.

### RFP-page-limit-aware section targets (Tier 1 refinement)
- **What:** Tier 1 (PR #33) scales section length by mapped-requirement count +
  fixed editorial defaults. v2 refinement: read the RFP's ACTUAL Section L page
  limits (the compliance matrix already extracts them) → map to per-section word
  targets (~500 words/page) and show "Target: 10 pages (~5,000 words) — per the
  RFP" instead of a generic number.

---

## ⏰ DEADLINE — June 19 (Juneteenth) work

### 0. Proposal Assist — Manual Drive (Perplexity-style proposal LLM)
- **PRD:** `docs/PRD-proposal-manual-mode.md`
- [x] **v1 SHIPPED 2026-06-05** — Auto↔Manual·Sport toggle in Proposal Assist
  (Auto = one-click draft, default; Manual = chat workspace). New
  `/api/app/proposal/chat` reuses the Mindy Chat SSE/Groq engine but grounds in
  the user's OWN docs (uploaded RFP + Vault via loadVaultContext/
  loadBidderProfile), proposal-writer prompt, no fabrication (placeholders when
  a fact is missing). `ProposalChat.tsx` streaming panel (sources, starters,
  copy). Verified live: 742 tokens, sources [RFP+Vault]. All auto sections gated
  to driveMode==='auto'.
- [x] **"Verify on SAM.gov" link SHIPPED** — deep link `sam.gov/opp/{notice_id}
  /view` in the pursuit header + Source Documents (shows when notice_id exists;
  33/58 pursuits have it). Trust-building: cross-check all docs + notice text;
  download/upload as needed.
- [ ] **v2.0 (NOT June 19, per Eric):** per-proposal notes area; compliance-
  matrix who/status assignee tracking; draft version history (v1/v2/v3);
  multi-user on one proposal (ties to Team Access).

---

## 🔴 P0 — Big features with a PRD, ready to build

### 1z. Coach Mode (APEX Accelerators) — ✅ v1 SHIPPED (see 2026-06-26 review above)
- **v1 DONE:** client switcher + per-client pipeline/vault/profile, workspace-scoped.
  Remaining v2: APEX cross-client Tab polish, Slack/Outlook/Drive, branding, analytics.
- **What:** one counselor manages MANY client businesses — client switcher +
  per-client pipeline/vault/profile + an "APEX Tab" (cross-client deadlines/
  alerts/news). Knowledge Base = the APEX "Workbench". From the APEX Illinois
  proposal ("designed, never built").
- **Key insight:** ~80% of the proposal already exists in Mindy (CRM, pipeline,
  market intel, teaming, events, proposal/compliance, Knowledge Base). Net-new =
  multi-client switching + the APEX Tab. **Architecture: reuse WORKSPACES** —
  each client = a workspace the coach belongs to (9+ routes already
  workspace-scoped). Main eng surface = explicit active-workspace plumbing.
- **v1:** client switcher + per-client operation + APEX Tab. **v2:** Slack/
  Outlook/Drive integrations; branding; coach analytics.
- **Risk:** cross-client data isolation must be airtight (workspace membership
  gates every read/write).
- **PRD:** `docs/PRD-coach-mode-apex.md` (open Qs: coach→client link, active-
  workspace mechanism, APEX-news admin, billing model).

### 1a. Relationships driven by Target List — ✅ v1 + v2 SHIPPED
- **Done:** entry from Target List, attach-to-agency, grouped My Network +
  relationship stages (see Shipped section). Migration run + verified.
- **Remaining v2 polish (optional, later):** smarter per-agency partner
  suggestions; tie relationship stages into outreach tracking; a true per-agency
  "who do I know here" rollup count on each Target List row.
- **PRD:** `docs/PRD-relationships-from-target-list.md`

### 1. DoD Forecast Coverage (the real one)
- **What:** DoD is the ~$400B largest buyer but we have **0 formal forecasts**.
  Option B (SAM Sources Sought as "early signals") already SHIPPED as the
  interim. This is **Option A** — real component LRAF scrapers.
- **Build:** Army → Navy/NAVFAC → Air Force → DLA scrapers into
  `agency_forecasts`, reusing the civilian forecast pipeline. Phase by spend.
- **PRD:** `docs/PRD-dod-forecast-scrapers.md` (parent: `PRD-dod-forecast-coverage.md`)
- **Effort:** medium per component; do one, verify, next.

### 2. Cron Dispatcher — Phase 2 (migrate the rest)
- **What:** Phase 1 SHIPPED (dispatcher live, 3 jobs migrated, refresh-dodaac
  added). Phase 2 migrates the remaining ~24 routes off `vercel.json` and
  collapses the 21 daily-alerts timezone windows into data-driven dispatch →
  ~6 native crons total.
- **Critical:** migrate the **load-bearing send pipelines LAST**, incrementally,
  with day-guards + watchdogs intact. Keep briefing-watchdog on native cron as a
  backstop (the dispatcher is now a single point of failure).
- **PRD:** `docs/PRD-cron-dispatcher.md` (§4 Phase 2)

---

## 🟠 P1 — Scoped features / meaningful UX

### Interactive product tour (in-app "click here" walkthrough)
- **What:** a guided click-through that runs INSIDE Mindy AFTER profile setup —
  spotlights each tab + has the user DO things (add first pursuit, run first
  proposal, add an agency, fill the Vault, Today's-Intel track/review/share,
  Contractors search/add, Expiring all-vs-yours toggle). NOT the setup wizard.
- **Net-new:** no tour engine installed. Recommend driver.js (~5KB) + data-tour
  anchors; drive nav via onPanelChange; tour_completed flag (localStorage + DB).
  Auto-start once + "Replay tour" in Settings.
- **Risk:** lazy-loaded panels (must poll for target before highlighting); empty
  states; mobile target drift.
- **v1:** ~6 core-workflow tabs. **v2:** rest + interactive checkpoints + analytics.
- **PRD:** `docs/PRD-interactive-product-tour.md`


### 3a. Knowledge Base — searchable repository ✅ SHIPPED 2026-06-05
- **What:** Mindy Chat answers well but getting to the SOURCE docs "gets lost."
  Build a searchable repository page over `mindy_rag_documents` (**1,364 docs**
  already there — templates, cap statements, past perf, training…). Chat
  citation chips deep-link into it.
- **Mostly surfacing, not a rebuild:** reuse the Library split-pane UI +
  `/api/app/rag-doc` viewer. Content + viewer already exist.
- **Naming:** distinct name ("Knowledge Base" — NOT "Vault" = company profile,
  NOT "Library" = user AI outputs). Don't migrate vault.govcongiants.org.
- **Guardrail:** filter `has_pii`/`usage_rights` — no internal/host docs leak.
- **PRD:** `docs/PRD-knowledge-base-repository.md`

### 3. Light / Dark mode (themeable Mindy)
- **What:** Mindy is dark-only. A real light mode is a **themeable-tokens
  refactor** (~29 components hard-code dark colors), not a toggle. Default stays
  dark; light is opt-in.
- **PRD:** `docs/PRD-light-mode.md` (phased: tokens → convert → toggle+setting)
- **Priority:** exploratory/nice-to-have (Eric, 2026-06-05).

### 4. Newcomer clarity — finish it
- **Done:** MeetMindyStrip shipped on /shared/opp + contractors/agencies/awards;
  dynamic share preview live.
- **Remaining:** specific OG previews on public pages that still lack them
  (agencies, awards, agency); the "card" strip variant lower on long pages.
- **PRD:** `docs/PRD-newcomer-clarity.md`

### 5. Real gov-contact roles (CO / PM / engineer / end-user)
- **What:** Decision Makers can't show real roles — SAM POC `title` is NULL at
  source, FPDS has no CO name. Needs **commercial enrichment** (HigherGov/
  LinkedIn-grade) — a BUY decision, not a build. Gate on the tab proving demand.
- **Research:** `docs/RESEARCH-gov-decision-maker-roles.md`

---

## 🟡 P2 — Follow-ups & polish (smaller, incremental)

### Decision Makers / DoDAAC
- [ ] **Civilian office decode** — GSA/VA/HHS solicitation formats don't use
  DoDAACs; decode those, or join `awards.awarding_office` for civilian. (DoDAAC
  decoder is DoD-only by design.)
- [ ] **5-role gov contacts** — Decision Makers shows only contracting POCs;
  PM/engineer/end-user need the enrichment source (P1 #5 above).
- [ ] **Office → contact join** — the solicitation prefix could link POC
  contacts to offices (sub-project).

### Contractors
- [ ] **NAICS + state combo** — state filter is name-search only (the NAICS
  rollup has no location). A location-aware NAICS path would be costlier.

### CRM / Target List
- [ ] **dodaac_directory refresh** is now automated via the dispatcher
  (monthly). Verify the first scheduled run lands (next: 6th of the month).

### Mindy product (longer-horizon, pre-existing PRDs)
- [ ] **Deal-flow board** — `docs/PRD-deal-flow-board.md`
- [ ] **SaaS landing page** — `docs/PRD-saas-landing-page.md`
- [ ] **Cal-AI simplification** sweep — `docs/PRD-mi-beta-cal-ai-simplification.md`

---

## ⚙️ Infra / ops notes (not tasks — things to remember)

- **mi.govcongiants.com → getmindy.ai final cutover** — runbook ready:
  `tasks/mi-to-getmindy-cutover-runbook.md`. `NEXT_PUBLIC_APP_URL` is ALREADY
  flipped to getmindy.ai (done for the share/viral loop), so part of the cutover
  is done. Run the rest on demand. ~139 hardcoded `mi.govcongiants.com` refs /
  61 files remain (re-grep before executing).
- **This DB has no in-app DDL** — every migration is hand-run in the Supabase
  SQL editor. After CREATE TABLE, run `NOTIFY pgrst, 'reload schema';` or writes
  fail with "table not in schema cache."
- **Always commit + push BEFORE `vercel --prod`.**
- **Re-run periodically:** `node scripts/populate-dodaac-directory.mjs` is now
  cron'd — no manual run needed unless verifying.

---

## How to use this
Pick a P0 or P1, open its PRD, and go. The PRDs have phasing + risks + success
criteria already worked out. P2 items are quick wins you can slot between
bigger work. Delete items as you finish them.

---

## v2.0 — Email-in to Mindy (TripIt-for-opportunities)

**Status:** v2.0, deferred (Eric, June 2026 — "save this for v2.0 not now").

**The need:** Mindy only knows SAM.gov today. Users get opportunities from sources
we don't scrape — NIH/DARPA/NSF labs, AF/Army open solicitations, agency portals,
NECO, GSA eBuy. They want to **forward any opportunity email into Mindy and have it
tracked + managed like a native pursuit** (the TripIt model: forward to
plans@tripit.com → it appears in your account).

**Decided shape (June 2026):**
- A forwarded email → **a tracked Pursuit** (extract title/agency/deadline/link →
  `user_pipeline` row). Then it gets the same change-alerts + Proposal Assist as a
  SAM opp.
- Ingest via a **per-user forwarding address** (e.g. `track+<userid>@getmindy.ai`
  or `<id>@in.getmindy.ai`) so mail maps to the right account automatically.

**Reuse (already in the codebase — don't rebuild):**
- `user_pipeline` table already has `source`, `external_url`, `title`, `agency`,
  `response_deadline`, `notes`, `notice_id` — a non-SAM `source='email-in'` slots
  right in.
- **Resend is already our email provider** → **Resend Inbound** is the natural
  inbound choice (no new vendor). Alternatives: SendGrid Inbound Parse, Postmark,
  Cloudflare Email Workers.
- Doc extraction exists: `src/lib/sam/pdf-extract.ts` (`extractPdf/Docx/Txt`) for
  forwarded attachments → Vault.
- `buildProfileFromText` / LLM extraction for parsing the email body into
  title/agency/deadline.

**Net-new infra to design in the PRD:** MX record + inbound webhook route
(`/api/webhooks/inbound-email`), per-user address mapping, **spoofing/security**
(verify the forwarding sender owns the account; DKIM/SPF on inbound), dedup
(forwarded twice), attachment size limits. Both-mode option: also save attachments
to Vault linked to the pursuit.

**Why deferred:** net-new inbound-email plumbing (provider + MX + webhook +
security) — not a small wiring change. Write the PRD when v2.0 starts.

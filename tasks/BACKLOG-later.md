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

### 1z. Coach Mode (APEX Accelerators) — strategic
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

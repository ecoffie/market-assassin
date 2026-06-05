# Mindy — Later Backlog (deferred work, save & pick up)

> A standalone, prioritized list of everything queued for "later" as of
> **2026-06-05**. Each item links its PRD/research doc. Pick top-down; the
> P0/P1 items are the highest-leverage. Nothing here is in-flight — all current
> session work is shipped & deployed.

---

## 🔴 P0 — Big features with a PRD, ready to build

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

### 3a. Knowledge Base — searchable repository page
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

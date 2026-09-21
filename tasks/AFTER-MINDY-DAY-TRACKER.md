# After Mindy Day — Build Tracker

> **Mindy Day = June 27, 2026** (the Elon-style product unveil, reframed from "Bootcamp").
> This is the single tracking doc for work scoped to run *after* Mindy Day. Consolidated
> 2026-07-07 from `BACKLOG-later.md` (Jun 26 demo-prep review), the P0/P1/P2 tiers, and
> `PLAN-rag-video-transcription-phase2.md`. **Source of truth for post-demo priorities —
> update HERE, delete items as they close.**

Legend: 🔴 open (real build) · 🟡 open (smaller/polish) · ⏸️ parked (needs Eric's decision) ·
✅ shipped since Mindy Day · ⛔ blocked on Eric (not code).

---

## 🎯 THE HEADLINE — RAG content-library ingestion (the moat)

**⭐ V2 FLAGSHIP. This is the one big genuinely-unstarted item.** The knowledge base IS
the moat (8 yrs teaching). Mindy's RAG today (`mindy_rag_documents` ~1,364 docs / 12,534
chunks) holds only a SLICE. Confirmed by Eric Jun 26: full ingestion is the post-demo
headline v2 capability.

### Phase 1 — Vault + Course DOCS — 🟡 IN PROGRESS
- **Done:** 21 high-value teaching docs ingested & retrievable (cap statements, teaming
  templates, 8(a) checklists, sources-sought samples, proposal system outlines…).
- **Pipeline:** `scripts/ingest-vault-docs.js` (Drive MCP → cache → Supabase insert,
  idempotent). Reuses FTS pipeline; no embeddings/transcription.
- **⛔ PENDING ON ERIC:** hand-run migration `supabase/migrations/20260628_rag_vault_doctype.sql`
  (vault_doc → 1.3 ranking boost). Until then vault_doc ranks at the 0.8 ELSE.
- **Key limitation:** bootcamp slide decks are Apple Keynote (`.key`) — NOT text-extractable
  via Drive. Decision (Eric Jun 28): SKIP the `.key` decks; the slide teaching comes via
  Phase 2 video transcripts.

### Phase 2 — The VIDEO library — 🔴 OPEN (the big lift)
**~700–1,000+ recordings, NO existing transcripts → needs real Whisper transcription.**
Full plan: `tasks/PLAN-rag-video-transcription-phase2.md`.
- **Two blockers:** (1) get the video bytes — `gcloud` not installed → use OAuth Playground
  token (`drive.readonly`, ~2 min, ~1h TTL); (2) no transcripts → Whisper-1 with audio
  chunking (25MB / ~30-min cap → a 2hr session = ~4 chunks). Needs `ffmpeg` locally.
- **Pipeline:** download mp4 → ffmpeg audio → split <25MB → Whisper (`response_format=text`)
  → chunk → ingest via Phase-1 `--from-cache` path.
- **Cost:** ~$190 raw Whisper ($0.006/audio-min × ~31,400 min), **~$200–400 all-in** with
  re-run buffer. Bigger cost = engineering time + bandwidth/disk.
- **Phasing (do NOT big-bang):**
  - **Pilot:** Proposal Bootcamp (~5 sessions) — highest value for Proposal Assist, small
    enough to validate download→ffmpeg→Whisper→ingest end-to-end + get a real per-hour cost.
  - **2a:** Federal Contract Academy (~515 lessons — structured curriculum).
  - **2b:** Bootcamp replays (Proposal / Business-Readiness / Surge / coaching 2018–24).
  - **2c:** Webinars / Q&A / First Partner Challenge.
- **Guardrail:** filter `has_pii` / internal-only docs (same as Knowledge Base repo).

---

## 🔴 P0 — Big features with a PRD, ready to build

### DoD Forecast Coverage (Option A — the real one)
- DoD is the ~$400B largest buyer but we have **0 formal forecasts**. Option B (SAM Sources
  Sought as early signals) already shipped as the interim.
- ⚠️ **Verified Jun 29:** "scrapers" framing is a dead end — no consolidated DoD feed exists
  (GSA FCO API = 0 DoD; component pages are .mil behind WAFs/Tableau). **Only real path =
  manual file → SheetJS importer per component** (cleanest = Air Force LRAF `.xlsx`). Build
  WITH the file in hand, not blind.
- **PRD:** `docs/PRD-dod-forecast-scrapers.md` (parent `PRD-dod-forecast-coverage.md`).
  Effort: medium per component; do one, verify, next.

### Cron Dispatcher Phase 2 — send-pipeline cutover — 🔴 DEFERRED (intentionally)
- **Decision (Eric Jun 28): DEFER the send cutover, hardening DONE.** `vercel.json` is at
  **53/100 crons** → no cap pressure → don't touch the 4 load-bearing send pipelines
  (daily-alerts, weekly-alerts, send-briefings-fast, send-weekly-fast) now.
- ✅ Hardening shipped (`dispatcher-watchdog`, native cron `0 */3 * * *` — independent
  liveness/overdue/stuck-lock/failing checks; the dispatcher was a SPOF).
- **Wrinkle for later:** daily-alerts runs every 15 min but the dispatcher ticks hourly →
  needs a sub-hour tick or proof one hourly batch drains everyone. Revisit when cap pressure
  returns; cut over incrementally, send pipelines LAST, day-guards intact.
- **PRD:** `docs/PRD-cron-dispatcher.md` §4.

---

## 🟠 P1 — Scoped features / meaningful UX

### Interactive product tour (in-app "click here" walkthrough) — 🔴 OPEN
- Guided click-through INSIDE Mindy AFTER profile setup — spotlights each tab + has the user
  DO things (add first pursuit, run first proposal, fill the Vault…). NOT the setup wizard.
- **Net-new:** no tour engine — recommend driver.js (~5KB) + `data-tour` anchors; drive nav
  via `onPanelChange`; `tour_completed` flag. Risks: lazy-loaded panels, empty states, mobile
  target drift. v1 = ~6 core tabs.
- **PRD:** `docs/PRD-interactive-product-tour.md`

### Light / Dark mode (themeable Mindy) — 🔴 OPEN (nice-to-have)
- Mindy is dark-only. A real light mode is a **themeable-tokens refactor**, NOT a toggle —
  **measured 2026-07-07: 74 files hard-code dark colors** (`bg-slate-900`, `bg-[#0f172a]`),
  not the ~29 the PRD estimated. A naive background flip = white-on-white in 74 places.
- Plan: semantic tokens (`bg-surface`/`text-text`/`border-border`) → convert files →
  `next-themes` toggle. **Default stays dark; light is opt-in** (per PRD decision log).
- **PRD:** `docs/PRD-light-mode.md`. Priority: exploratory/nice-to-have (Eric Jun 5).

### Real gov-contact roles (CO / PM / engineer / end-user) — ⏸️ BUY DECISION
- Decision Makers can't show real roles — SAM POC `title` is NULL at source, FPDS has no CO
  name. Needs **commercial enrichment** (HigherGov/LinkedIn-grade) — a BUY decision, not a
  build. Gate on the tab proving demand.
- **Research:** `docs/RESEARCH-gov-decision-maker-roles.md`

### Newcomer clarity — finish it — 🟡 MOSTLY DONE
- ✅ OG images DONE Jun 29 (dynamic per-entity for contractors/agencies/awards).
- **Remaining:** the "card" strip variant lower on long public pages; any public pages still
  lacking OG previews. **PRD:** `docs/PRD-newcomer-clarity.md`

---

## ⏸️ PARKED — needs Eric's decision (not blocked on code)

### Proposal Assist — Tier 2 multi-pass volumes
- Code MERGED Jun 28 (PR #34) but **gated OFF** (`PROPOSAL_MULTIPASS`, unset = zero prod
  change). Pushed to "next phase." **To enable:** set `PROPOSAL_MULTIPASS=1` in Vercel
  (+ optional `_THRESHOLD`/`_BATCH`/`_CONCURRENCY`), redeploy, QA one long RFP (a heavy
  section fires ~25 LLM calls — a WATCHED step). Follow-ups in `src/lib/proposal/multi-pass.ts`.

### Free-user tracking (pricing decision)
- Let FREE users track opportunities (My Pursuits) from Market Research. Backend
  `/api/pipeline` already accepts free posts — purely a UI/pricing gate. **Open question:**
  full-free vs capped (e.g. 10 items) vs keep Pro-only. Changes a documented Pro
  differentiator → **Eric decides.**

### RFP-page-limit-aware section targets (Tier 1 refinement)
- Read the RFP's ACTUAL Section L page limits (compliance matrix already extracts them) →
  per-section word targets (~500 words/page), show "Target: 10 pages (~5,000 words) — per
  the RFP" instead of a generic number.

---

## 🟡 P2 — Follow-ups & polish (slot between bigger work)

- **5-role gov contacts** — Decision Makers shows only contracting POCs; PM/engineer/end-user
  need the enrichment source (blocked on the P1 buy decision above).
- **Contractors NAICS + state combo** — state filter is name-search only (the NAICS rollup
  has no location). A location-aware NAICS path would be costlier.
- **Deal-flow board** — `docs/PRD-deal-flow-board.md`
- **SaaS landing page** — `docs/PRD-saas-landing-page.md`
- **Cal-AI simplification sweep** — `docs/PRD-mi-beta-cal-ai-simplification.md`

---

## ⛔ Blocked on Eric (not code)

- **Loom onboarding videos** — 3 walkthroughs (profile / find customers / first bid), 60–90s,
  Mindy-branded → Vimeo → send player URLs → wire into empty `vimeoUrl` slots. The only
  remaining piece of the Getting-Started tour.

---

## v2.0 — Email-in to Mindy (TripIt-for-opportunities) — 🔴 OPEN
- Forward an opportunity email to `plans@` → Mindy parses it into a pursuit. PRD written;
  needs an inbound-email provider. Full spec at the bottom of `BACKLOG-later.md`.

---

## ✅ Shipped SINCE Mindy Day (was "after Mindy Day," now done — kept for the record)

- ✅ **Auto-seed My Target List from profile agencies** — Jun 28 (`feat/auto-seed-target-list`).
  On profile save / onboarding finish, chosen agencies seed into `user_target_list` (add-only,
  Pro-gated, enriched with buying offices).
- ✅ **Office / agency-name normalization full pass** — track CLOSED Jun 28. Consolidated 3
  parallel normalizers → 1 shared `normalizeOfficeName(name, {mode})`, GSA slash-soup splitter,
  ACC context-awareness, golden-file parity test (2,379 checks). PRs #71, #72.
- ✅ **Coach Mode v1** — client switcher + per-client pipeline/vault/profile, workspace-scoped.
- ✅ **Civilian office decode + office→contact join** — Jun 29 (SAM `office`/`sub_tier` fallback
  for GSA/VA/HHS where no DoDAAC decodes).
- ✅ **Knowledge Base searchable repository** — Jun 5.
- ✅ **Dispatcher hardening (`dispatcher-watchdog`)** — Jun 28.

---

## How to use this
Work top-down: the RAG video library (Phase 2) is the headline; DoD forecasts and the product
tour are the next real builds. Parked items need a one-line decision from Eric, not
engineering. Each item names its PRD — open it, it has phasing/risks/success criteria. Delete
items here as they close, and mark newly-shipped ones ✅ so this stays the honest post-demo map.

# PRD: Capability Milestones + Quarterly Funder Report

> Org/Coach layer feature. Tracks each managed client business through 5 capability
> milestones and rolls them up into a quarterly report a center hands its funder (SBTDC/SBA).
> **Driven by a live customer: GCAP** (Government Contractor Assistance Program, SBDC-affiliated,
> 8→12 counselors, ~1,000 businesses). This is the wedge the GCAP proposal leans on — and the
> only two proposal claims **not yet built** (verified against code 2026-07-11).

---

## 1. Problem Statement

**Who has this problem?**
Org/enterprise Mindy customers — SBDC/APEX/chamber centers whose counselors manage many client
businesses. First real instance: **GCAP** (the deal that validates the $36K Single band).

**What's the pain?**
A center's funding renews on the numbers it reports to its funder (for GCAP: SBTDC/SBA). Today
that progress — which businesses hit SAM registration, got certified, wrote a capability statement,
submitted a first bid, won a first award — lives across spreadsheets, inboxes, and counselors'
heads, and every quarter is re-assembled by hand into a funder report. It's a second job, and it's
error-prone. **The center's value is capability progression; nothing measures it.**

**How do they solve it today?**
Manual spreadsheets + memory, re-keyed into a funder report template each quarter.

**Evidence this is real:**
- [x] Our own experience / direct customer — GCAP discovery questionnaire named reporting as THE
  wedge: *"if Mindy produces the numbers you already have to report, it becomes the system that
  renews your funding, not just another tool."*
- [x] It's the explicit ask in the live GCAP proposal (`docs/proposals/GCAP-Mindy-Proposal.html`,
  "The reporting engine — the part we most want to get right").

**Link to evidence:** `docs/strategy/GCAP-PROPOSAL-FACTS.md` · `docs/proposals/GCAP-Mindy-Proposal.html`

---

## 2. Solution

**One-sentence description:**
A counselor tracks each client business through 5 capability milestones (auto-detected where the
data exists, counselor-marked where it doesn't), and the org admin exports a one-click quarterly
rollup of businesses-served + milestones-reached + pipeline outcomes as CSV/PDF.

**Which tool does this live in?**
Coach Mode / "My Clients" (the org-admin layer). Extends the existing `coach` panel.

**User flow:**
1. Counselor opens a client in My Clients → sees a **milestone strip** (5 stages, with dates).
2. Auto milestones (SAM reg, first bid, first award) fill themselves from existing data.
3. Counselor manually checks the two we have no data source for (certification, capability statement).
4. Org admin clicks **Export quarterly report** → picks a quarter → gets CSV + PDF rolled up across
   all ~1,000 clients.

**Output:** an in-panel per-client milestone strip + an org-level quarterly report file.

---

## 3. What ALREADY exists (don't rebuild)

Verified against code 2026-07-11. The org/client management spine is **shipped and wired** — this
feature is an *extension* of it, not a new subsystem.

| Already built | File | Reuse for |
|---|---|---|
| Org / client / member model | `supabase/migrations/20260605_coach_mode_orgs.sql` (`organizations`, `org_members`, `org_clients`) | The rollup iterates `org_clients` by `org_id`; new `client_milestones` FKs to it |
| Coach API (org + clients + per-client stats) | `src/app/api/app/coach/route.ts` | The per-client pipeline/profile query at lines ~145–210 is the exact query the milestone rollup extends |
| Access tiers / caps | `src/lib/mindy/coach-access.ts` | Gate export to `org_admin`; respect Enterprise=unlimited |
| Coach UI panel | `src/components/app/panels/CoachPanel.tsx` (638 lines) | Add the milestone strip + export button here |
| Pipeline w/ stages | `supabase/migrations/20260410_pipeline_tracker.sql` — stages `tracking\|pursuing\|bidding\|submitted\|won\|lost` | **first bid = any row reaching `submitted`; first award = `won`** — auto-detect source |
| Client profile (NAICS/keywords/states) | `user_notification_settings` (read in coach route) | SAM-registration signal source (see §4) |
| Workspace auth / "work as client" | `src/lib/app/workspace.ts` `resolveActiveWorkspace()` | Milestone writes inherit the same server-side org_admin/assigned-coach authorization |

**Consequence:** no new auth, no new org model, no new workspace switching. Net-new = one table,
detection logic, one rollup/export route, and UI on an existing panel.

---

## 4. What's net-new (by layer)

### DB
- **New table `client_milestones`** — one row per (org_client, milestone), 5 milestone keys:
  `sam_registration`, `certification`, `capability_statement`, `first_bid`, `first_award`. Columns:
  `org_client_id` FK, `workspace_id`, `milestone_key`, `achieved_at TIMESTAMPTZ`, `source` (`auto`|`manual`),
  `marked_by` (counselor email, manual only), `note`, `created_at`. Unique on (org_client_id, milestone_key).
- Hand-run migration in Supabase (this DB has no in-app DDL). Idempotent `CREATE TABLE IF NOT EXISTS` +
  RLS mirroring `org_clients` + `NOTIFY pgrst`.

### Backend
- **Detection logic** (shared lib, e.g. `src/lib/mindy/client-milestones.ts`) — reused by read + a
  refresh path. **2 auto / 3 manual** (R1 resolved 2026-07-11):
  - `sam_registration` — **manual** (counselor checkbox; no clean stored signal — see R1).
  - `certification` (WOSB/HUBZone/8a) — **manual** (no data source).
  - `capability_statement` — **manual** (no data source).
  - `first_bid` — **auto**: earliest `user_pipeline` row for the workspace reaching stage `submitted`.
  - `first_award` — **auto**: earliest reaching stage `won`.
  - Auto milestones stamp `achieved_at` on first detection (idempotent — never overwrite an earlier date).
  - `set_milestone` covers all THREE manual keys (sam_registration, certification, capability_statement).
- **Extend `GET /api/app/coach`** to return each client's milestone state (piggyback the existing
  pipeline query — no new N+1).
- **`POST /api/app/coach` action `set_milestone`** — counselor marks/unmarks a manual milestone;
  authorized via existing org_admin/assigned-coach check.
- **New `GET /api/app/coach/report?quarter=YYYY-Qn&format=csv|pdf`** — org-admin-only rollup:
  businesses served, per-milestone counts + per-business detail, pipeline (bids/awards) by quarter.
  CSV always; PDF via Puppeteer (tool-pref) — **v1 generic-solid layout, reshaped to GCAP's exact
  SBTDC template during pilot** (we don't have their template yet — deliberate).

### UI
- **Milestone strip** in `CoachPanel.tsx` per-client card — 5 dots/checks with dates; manual two are
  clickable, auto three are read-only (tooltip "auto from pipeline/SAM").
- **Export button** (org_admin only) — quarter picker → download CSV/PDF.

### Integration
- None external. All data already in Supabase.

---

## 5. Scope

**In scope (MVP):**
- [ ] `client_milestones` table (hand-run migration)
- [ ] Shared detection lib: 2 auto (first bid, first award) + 3 manual (SAM, cert, cap statement)
- [ ] Coach API returns milestone state per client
- [ ] `set_milestone` action for the 3 manual milestones
- [ ] Milestone strip UI in CoachPanel
- [ ] Quarterly report route → CSV + PDF (generic-solid v1)
- [ ] Org-admin gating on the export

**Out of scope (defer):**
- GCAP's exact SBTDC/SBA field mapping (do during pilot, once they hand over their template)
- Auto-detection of certification / capability statement (no data source exists)
- Scheduled/emailed quarterly reports (manual export first)
- Branded org-tab logo/color rendering (separate half-built item — not this PRD)

**Dependencies:**
- [x] Supabase schema change — 1 new table (hand-run)
- [ ] Confirm the stored SAM-registration field on the client profile (Risk R1)
- [ ] Puppeteer for PDF (already a repo tool-pref; confirm present in this repo)

**Scale note:** rollup iterates one org's clients (~1,000 for GCAP). Batch the pipeline/milestone
queries by `workspace_id IN (...)` exactly like the existing coach route — not per-client. No
50K-user quota concern (org-scoped, admin-triggered, not a hot path).

---

## 6. Acceptance Criteria (QA gate)

- [ ] Migration run; `client_milestones` exists (verify columns before use — rule #6).
- [ ] For a test org with clients that have pipeline rows: a client with a `submitted` pursuit shows
      **first_bid** with the correct date; a `won` pursuit shows **first_award**; dates match the
      earliest qualifying pipeline row.
- [ ] Auto milestones are **idempotent** — re-running detection does not move an already-set date.
- [ ] A counselor can check/uncheck **certification** and **capability_statement**; it persists and
      stamps `marked_by` + `achieved_at`.
- [ ] A non-authorized user (not org_admin, not assigned coach) **cannot** set a milestone or pull
      the report (401/403) — proven, not assumed.
- [ ] `GET …/report?quarter=…&format=csv` returns a non-empty CSV whose businesses-served count
      equals the org's active `org_clients` count for that quarter.
- [ ] PDF export renders (HTTP 200, non-empty file).
- [ ] Verified on a real org's data (not just types compiling) before "done."

---

## 7. Estimated effort

Medium (2–3 days):
- **Phase 1 (~0.5d):** migration + detection lib + unit tests for stage→milestone mapping.
- **Phase 2 (~1d):** coach API extension + `set_milestone` + report route (CSV).
- **Phase 3 (~1d):** CoachPanel milestone strip + export button + PDF layout.
- Reshape-to-GCAP-template: separate, during pilot.

---

## 8. Risks + Open Questions

- **R1 (blocking for SAM auto-detect):** what field actually records a client's SAM registration on
  the profile? Verified reads show `naics_codes/keywords/location_states/primary_industry` on
  `user_notification_settings` — none is a clean "SAM registered" boolean. **Must confirm before
  coding SAM detection.** Fallback: make SAM registration a **manual** milestone in v1 too (→ 2 auto,
  3 manual) rather than fabricate a signal (rule #1). Decide with Eric.
- **R2:** "first bid = `submitted`" assumes counselors actually advance pipeline stages. If they
  don't use the pipeline, auto milestones stay empty (honest — better than fake). Surface in-UI that
  auto milestones follow pipeline usage.
- **R3:** GCAP's real report format is unknown → v1 is generic. Accepted (Eric's call: build v1 now,
  fit later).
- **Open:** does this MVP also power the *proposal's* "capability progression made measurable" claim
  enough to send as **live**? Yes for first-bid/first-award/manual; SAM pending R1.

---

## 8a. Isolation — why this cannot disrupt normal Mindy users (verified 2026-07-11)

The Coach layer is membership-gated at three independent levels; a solo Pro/Teams user never
crosses any of them, so this feature is structurally fenced:

1. **Panel invisible without membership** — `coachModeAllowed` defaults `false` in
   `src/app/app/page.tsx`; "My Clients" renders only if `accessData.coachMode.allowed` (requires an
   `org_members` row). Normal users never see it.
2. **API returns empty for non-members** — `src/app/api/app/coach/route.ts` (~line 61): no
   `org_members` row → `{ isCoach: false }`, immediate return. No data.
3. **New table keyed to `org_clients`** — `client_milestones` FKs to `org_clients`, which only exists
   for businesses a center added. **No row exists for any normal user's workspace**, so the milestone
   strip / report physically cannot read or write a solo user's data.

**Binding guardrails for the build (non-negotiable):**
- **Read-only on shared tables.** Detection *reads* `user_pipeline` + `user_notification_settings`;
  ALL writes go ONLY to the new `client_milestones` table. Zero mutation of any existing/shared table.
- **No new call path for normal users.** Extend the EXISTING batched `workspace_id IN (...)` query in
  the coach route — do not add a query that any non-coach code path reaches.
- **Migration is additive only** — `CREATE TABLE IF NOT EXISTS client_milestones` + its own RLS. It
  does NOT `ALTER` `user_pipeline`, `user_notification_settings`, `org_clients`, or any shared table.

## 9. Decision Log

- **2026-07-11** — Feature triggered by verification that the GCAP proposal's two core claims
  (milestone tracking + funder export) had **zero supporting code**. Eric: *"lets build them since
  we have a live customer"* — build the truth rather than soften the proposal.
- **2026-07-11** — Export: **build generic-solid v1 now, reshape to GCAP's SBTDC template during
  pilot** (don't block on their template).
- **2026-07-11** — Detection: **hybrid** — auto for SAM + first bid + first award; manual for
  certification + capability statement (no data source). Never fabricate a milestone (rule #1).
- **2026-07-11** — Reuse spine: extend Coach Mode (`org_clients`, coach route, CoachPanel), no new
  org model or auth. first_bid=`submitted`, first_award=`won` from `user_pipeline` stages.
- **2026-07-11** — Availability: **any org with Coach Mode**, NOT a GCAP-only flag. GCAP is instance
  #1; USHCC/APEX inherit it on signing. Same code, no per-customer branching. (Eric's call.)
- **2026-07-11** — Rollout: **standard** — build → verify on GCAP's real org data → ship. No
  staging/preview gate needed because isolation is structural (§8a) and the migration is additive.

---

**Status:** ☐ PRD only · ☑ **Approved to build (Eric, 2026-07-11)**

*R1 resolved: SAM registration is MANUAL (counselor checkbox) in v1 → **2 auto** (first_bid,
first_award) / **3 manual** (sam_registration, certification, capability_statement). No fabricated
SAM signal (rule #1). Proceed via `/from-prd`.*

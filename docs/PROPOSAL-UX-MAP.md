# Proposal Assist — UX Workflow Map & Gap Analysis

Grounded walkthrough of the bid → compliance → draft → export flow, from the
actual code (June 2026). Written to decide the roadmap, not from assumption.

---

## The two parallel paths (root of most issues)

There are **two compliance/proposal systems** that don't share state:

| | **Wizard path** | **Panel path** |
|---|---|---|
| Where | `/api/app/proposal/wizard` (`brief → compliance → draft`) | `ProposalsPanel.tsx` `generateCompliance()` |
| Persists? | **YES** — `archiveContent()` per stage, keyed to `pipeline_id` + `workspace_id` | **NO** — React `useState` only |
| Loads on open? | YES (`loadCached`) | NO — regenerates every time |
| Owner/status per row? | n/a | Fields exist (`owner`, `status`) but **never saved** |
| Used by the .docx export + scanner | — | YES (this is the one users drive) |

The path users actually work in (the panel — it has the matrix table, export
buttons, scanner) is the **ephemeral** one. The persistent one (wizard) is a
separate, lighter flow.

---

## The workflow, step by step

### Step 0 — Pipeline (saved pursuits)
Open a pursuit → loads `user_pipeline` row (`workspace_id`, `notice_id`, deadline).
Workspace-aware. ✅

### Step 1 — Bid / No-Bid gate (`BidDecisionGate`)
10-factor scorecard → pursue / watch / skip, gates derived from the solicitation
(`/proposal/bid-gates`).
- **GAP:** the decision is **not saved**. The gate just calls `onProceed()` to
  reveal the next step. No stage update on the pursuit, no recorded bid/no-bid,
  no "we decided to bid this on June 10." A "no-bid" leaves no trace.

### Step 2 — Compliance matrix (`generateCompliance` → `/proposal/compliance`)
LLM extracts `{requirement, category, section, source_quote}`. A shared
`compliance_matrix_cache` (keyed by **notice_id**) makes re-extraction instant
for the same notice.
- **GAP A — resets every time:** the matrix lives in `compliance[]` useState.
  Reload / navigate away → gone → regenerate. The notice-cache speeds the *re-run*
  but does **not** restore *your* matrix with *your* edits.
- **GAP B — check-off never persists:** rows have `owner` + `status` (open /
  in_progress / done / n_a), editable in the UI, but **saved nowhere**. Your
  assignments and progress vanish on reload.
- **GAP C — no pagination:** all rows render in one filterable list. A 200-req
  RFP is a 200-row scroll. (Lower priority until it persists.)

### Step 3 — Draft (`draft-all` / wizard draft)
Generates the section drafts (the LOI / RFP / IDIQ templates we built).
- **GAP D — draft is disconnected from the matrix:** `draft-all` does **not**
  read the compliance requirements. So the draft doesn't know which `shall`s it
  must cover; the matrix and the draft are two islands. (The scanner #11 bridges
  them at check time, but the *drafting* doesn't consume the matrix.)

### Step 4 — Export (.docx) + Scan
Export LOI / RFP / IDIQ (deterministic templates — done, live). Scanner checks the
draft vs. the matrix for DQ risks (done, live). ✅ — these are solid.

---

## Team / collaboration gaps

The data model is *almost* there (`workspace_id` on pursuits, `owner`/`status` on
rows, the archive system) — but the panel never wires them together:

- **No team check-off:** "Sarah owns L.3.2, marked in-progress" is local React
  state, invisible to Sarah, gone on reload.
- **No assignment / notification:** can't assign a requirement to a teammate.
- **No per-member view:** no "my items" / progress roll-up across the team.
- **Bid decision not shared:** the team can't see what was decided or by whom.

---

## The foundational fix (everything else builds on it)

**Persist the panel's compliance matrix + per-row owner/status to the pursuit,
workspace-scoped, and load it on open.** That single change:
1. Fixes "resets every time" (Gap A).
2. Makes team check-off real (Gap B) — owner/status survive + are shared.
3. Makes pagination worth adding (Gap C).
4. Sets up assignment/roll-up (the team layer).

The archive system (`archiveContent` / `proposal_wizard_compliance`) already
exists — the panel just needs to use it (or a dedicated `pursuit_compliance`
table with per-row owner/status). Then layer: pagination → assignment UX →
draft-reads-matrix (Gap D).

---

## Priority order (proposed)

1. **Persist matrix + owner/status** (workspace-scoped, load-on-open) — the unlock.
2. **Team check-off UX** — assign to teammate, "my items", progress roll-up.
3. **Persist the bid/no-bid decision** — record it on the pursuit (small, high-signal).
4. **Pagination / virtualization** for large matrices.
5. **Draft reads the matrix** — drafting covers the actual `shall`s (closes Gap D).

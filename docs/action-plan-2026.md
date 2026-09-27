# Federal Contracting Action Plan (2026) — canonical source

This is the repository's **source of truth for the GovCon Giants Action Plan**. Mindy Learn
(`missions.ts`) cites the step IDs below; nothing else in the repo defines the plan.

- **Source artifact:** *Federal Contracting Action Plan — "Follow all the steps to ensure success in
  the federal space"*, GovCon Giants (GCG), 6-page PDF, 2026 edition.
- **Source file SHA-256:** `62b69c6c40daf263f7426079db30d069b6679a517d0e82140f9e084f7fa351f5`
  (`action-plan-2026.pdf`, 521,164 bytes). The PDF itself is **not** committed: every page carries a
  per-licensee watermark ("Licensed to: …"), and this repository is public.
- **Transcribed:** 2026-09-26, verbatim. Step titles, their order, the phase names and the ONCE /
  REPEAT labels are copied exactly as printed, including the source's own capitalization and
  spacing (e.g. "Create/ Fix", "Vendor/ Supplier"). **Do not reword, reorder, merge or "modernize"
  a step here.** A wording change is a change to the Action Plan and needs Eric's sign-off first.
- **Guard:** `tests/unit/action-plan-2026-source.test.ts` pins the structure (5 phases, 27 steps,
  Business Development before Bidding, the cadence labels) and fails on drift.

## Structure at a glance

| Phase | Name | Cadence | Steps |
|---|---|---|---|
| 1 | Setup | ONCE | 6 |
| 2 | Business Development | REPEAT | 6 |
| 3 | Bidding | REPEAT | 5 |
| 4 | Business Enhancement | ONCE | 6 |
| 5 | Contract Management | REPEAT | 4 |
| | | **Total** | **27** |

**Business Development comes before Bidding.** That order is the plan's point: find and work your
buyers before you respond to what is already posted. The legacy `/planner` app
(`src/lib/supabase/planner.ts`, 36 tasks) swaps these two phases; it is **not** the source of truth.

## Phase 1 — Setup · ONCE

| ID | Step |
|---|---|
| `P1-01` | Choose your Business Structure |
| `P1-02` | Identify your Industry codes (NAICS) |
| `P1-03` | Create your SAM.GOV Profile |
| `P1-04` | Register for Local Gov Sites |
| `P1-05` | Talk to Local Apex Accelerator |
| `P1-06` | Create/ Fix your Business Resume (Cap Statement) |

## Phase 2 — Business Development · REPEAT

| ID | Step |
|---|---|
| `P2-01` | Identify Top 25 Buyers & Future Bids (NOT ON SAM) |
| `P2-02` | Setup and attend meetings with government buyers |
| `P2-03` | Attend Industry Events |
| `P2-04` | Attend Site Visits |
| `P2-05` | Get on Supplier List for top 25 Federal Suppliers |
| `P2-06` | Monitor Contract Awards and Identify Sub Opportunities |

## Phase 3 — Bidding · REPEAT

| ID | Step |
|---|---|
| `P3-01` | Review Immediate Bid Opportunities |
| `P3-02` | Assemble Team Based on Opportunities |
| `P3-03` | Apply for Vendor/ Supplier Credit |
| `P3-04` | Respond to Opportunity (RFP, RFQ, RFI, Task Orders) |
| `P3-05` | Evaluate Bid Results |

## Phase 4 — Business Enhancement · ONCE

| ID | Step |
|---|---|
| `P4-01` | Apply for Small Business Certification |
| `P4-02` | 8(a) Certification |
| `P4-03` | Mentor Protege Program |
| `P4-04` | Focus on Self Performance Capability as Differentiator |
| `P4-05` | Find Better Partners |
| `P4-06` | Speak at an event |

## Phase 5 — Contract Management · REPEAT

| ID | Step |
|---|---|
| `P5-01` | System Registrations (PIEE, WAWF) |
| `P5-02` | Subcontractor Compliance |
| `P5-03` | Project Compliance |
| `P5-04` | Communication |

## Known divergent variants (not sources of truth)

| Variant | Where | How it differs |
|---|---|---|
| Legacy `/planner` | `src/lib/supabase/planner.ts` | 36 tasks; Bidding before Business Development; adds duplicate lesson-titled tasks and "Identify Mid Size Mentor"; omits "Register for Local Gov Sites" |
| `/action-plan-2026` page | marketing route | Describes a quarterly plan that matches no version of the PDF |

Both are recorded in `tasks/mindy-learn-repair-board-2026-09-26.md` (P2-1, P2-4) and are retired or
redirected only after `/learn` is production-proven.

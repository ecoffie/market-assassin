# Proposal: exclude scanner-created pipeline saves from analytics (keep the data, let customers decide)

**Status:** PROPOSAL, 2026-10-13. Not implemented, not deployed. Needs approval per phase (§6).
**Context:** before #1845 (live 2026-10-06T11:36:36Z) the daily alert's save link was a GET, so mail
link scanners created pipeline rows nobody chose. #1845 fixed new saves (they need a confirmation
POST and carry a `pipeline_save_confirmations` record). #1847 (live 2026-10-13) suppresses
change-alert emails and automatic document fetches for the 3,198 high-confidence (T1) rows.
Evidence: `docs/engineering/email-scanner-saves-impact-2026-10-06.md`.
**Public repo:** aggregate figures only.

## 1. Why analytics need correcting (measured 2026-10-13, production, read-only)

| Measure | Raw | Without suspected rows (T1 + T2) |
|---|---|---|
| Pipeline rows | 10,225 | 4,947 (suspected = **51.6%**) |
| Users with any pipeline row | 598 | 553 (**45** users hold only suspected rows) |
| Demand heatmap: total "trackers" across tracked notices | 9,761 | 4,488 |
| Demand heatmap: notices with ≥ 1 tracker | 5,759 | 4,113 (**1,646** tracked only by suspected rows) |
| Heatmap top-10 notices, trackers | 37, 36, 36, 36, 33, 32, 31, 28, 28, 27 | 2, 4, 4, 3, 4, 2, 1, 1, 2, 4 |

**Why the rows are not human:**
- Email saves fell from **86.4/day to 2.3/day (−97%)** once a click had to be confirmed, while alert
  volume fell only 9% with the same ~10.7 opportunities per alert.
- Human confirmations land a median **4.5 h** after the link (fastest 64.5 s; 1 of 16 within 2 min).
- T1 rows land a median 32 s after the send, in sub-second bursts (median 23 ms apart).

## 2. The exclusion class
An **unconfirmed pre-fix email save** is a `user_pipeline` row with:
- `source = 'daily_alert'`, created **before 2026-10-06T11:36:36Z**;
- saved **< 120 s** after an alert to that user that contained the notice (`alert_log`);
- **no** `pipeline_save_confirmations` record.

| Tier | Rule | Rows | Analytics | Side effects |
|---|---|---|---|---|
| T1 | + another save for the same user within ±1 s | 3,198 | **excluded** | suppressed (#1847) |
| T2 | no burst | 2,080 | **excluded** | unchanged (fails open) |
| T3/T4/T5 | ≥ 2 min, or no matching alert | 1,201 | included | unchanged |
| Post-fix | has a confirmation | all | included | normal |

**False positives:** T1 ≈ 0 (a sub-second multi-save is not humanly possible). T2 holds an estimated
**≥ 11 genuine saves (≥ 0.5%)**: about 187 human email saves expected across the 81 pre-fix days at
the post-fix rate, about 6% of which land within 2 minutes. That matches the 9 T2 rows with human
signals (acted on, or opened in-app). Rows a person has acted on are re-included automatically (§3).
**Not classified:** about 111 `source='briefing'` email saves (no send log joined yet). They are
included, and their status is stated wherever analytics report exclusions.

## 3. Design (original data untouched, everything auditable)
1. **`pipeline_row_provenance`** (new table, additive): `pipeline_id` PK, `class`
   (`scanner_t1` | `scanner_t2`), `criteria_version`, `evidence` jsonb, `exclude_from_analytics`,
   `customer_decision` (`null` | `keep` | `remove`), `decided_at`, `created_at`.
   Populated once by a dry-run-first script (same pattern as `record-scanner-save-suppressions.ts`).
   T1 rows reuse the #1847 evidence.
2. **`pipeline_row_provenance_events`** (append-only): every classification, customer decision and
   reversal, with actor and timestamp. Nothing is ever updated in place without an event row.
3. **One shared predicate**, used by every analytics surface: a row counts when it has no
   provenance row, OR `exclude_from_analytics = false`, OR `customer_decision = 'keep'`, OR the row
   shows human action (stage moved off tracking, notes, next action, bid decision, history, or an
   in-app open of the notice). Exposed as a TS helper plus a read-only SQL view
   (`user_pipeline_analytics`) so SQL and code cannot drift.
4. **`user_pipeline` is never modified by this work.** A customer "remove" uses the existing,
   reversible `is_archived` flag, and only on that customer's explicit action (§5).

## 4. Surfaces to correct, raw and cleaned side by side

| Surface | File | Change |
|---|---|---|
| Demand heatmap (trackers per notice) | `src/lib/admin/demand-heatmap.ts` | count distinct trackers over the predicate; show raw next to cleaned |
| Customer qualification scoring | `src/app/api/admin/qualify-customers/route.ts` | pipeline-activity signals use the predicate |
| Admin dashboard pipeline metrics | `src/app/api/admin/dashboard/route.ts` | "users with a pipeline" and pursuit counts: raw and cleaned |
| Click-adoption | `src/app/api/admin/track-click-adoption/route.ts` | as above |
| Map funnel (pursuit step) | `src/app/api/admin/map-funnel/route.ts` | as above |
| OBS-005 / OBS-007 | per `observatory-obs-003-007-corrected-standards.md` | already require a confirmation record for email pursuits; the predicate is the historical form |

Each surface shows **both** figures with the excluded count and the criteria version (for example
"4,488 trackers (9,761 raw; 5,273 excluded as unconfirmed pre-fix email saves, v1)"). Raw stays
visible for at least two weekly review cycles before cleaned becomes the default. Raw is never
removed.

## 5. Customers: a reversible keep/remove choice, never automatic archiving
- In the pipeline, T1/T2 rows carry a quiet label: **"Added automatically from an email link"**
  with **Keep** and **Remove**. There is also a "Review N auto-added items" filter, with select-all.
- **Keep**: `customer_decision = keep`. The row counts in analytics, and #1847 suppression is
  lifted for that row.
- **Remove**: `is_archived = true` (the existing archive), with **Undo** in the toast and recovery
  from the archived view. Nothing is deleted.
- No automatic archiving, no deadline, no nagging modal. Precedent: Gmail and Outlook "suggested"
  items and Google Calendar's auto-added events, labeled in place and dismissable one by one or in
  bulk.
- **Optional, separate approval:** a one-time plain notice to the 161 affected users explaining the
  label.

## 6. Phases (each needs approval; none started)
1. Migration (two additive tables), then a dry-run population (counts, sample, assertions), then
   the write. Rollback: drop the tables; nothing else depends on them.
2. Shared predicate + view + unit tests (including a mutation check), then the five admin surfaces
   in raw/cleaned mode. Acceptance: every cleaned figure reconciles to raw minus exclusions, checked
   by an oracle test against production.
3. Customer label + keep/remove UI, with a browser check of the label, Keep, Remove and Undo.
4. After two review cycles: cleaned becomes the default view; raw remains one click away.

## 7. Explicitly not proposed
Deleting any of the 5,278 rows; editing `user_pipeline` content; extending side-effect suppression
to T2 (a separate decision after watching T1); classifying `briefing`-source saves (separate work).

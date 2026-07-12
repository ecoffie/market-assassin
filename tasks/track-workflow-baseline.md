# Track→Act workflow — baseline (2026-07-11)

Baselined right after deploying `bb83b900` (next-action + Today triage strip).
Re-run the same counts in ~1 week to measure lift.

## `user_pipeline` snapshot — 2026-07-11

| Metric | Value | Notes |
|---|---|---|
| Total tracked rows | 1,540 | |
| Stuck at `stage='tracking'` | 1,437 (93.3%) | bookmarked, never advanced |
| `next_action` NULL | 920 | |
| **`next_action` fill rate** | **40.3%** (620/1,540) | was 24% pre-deploy — write-time stamp already lifting it as new tracks land |

## What "working" looks like (check ~2026-07-18)
- `next_action` fill rate ↑ toward 100% for NEW tracks (write-time stamp) — legacy 920 nulls get a recomputed button at render but stay null in DB until re-touched.
- `stage='tracking'` share ↓ off 93% — items advance because the button gives them somewhere to go.
- browse→track rate ↑ off 4% (needs `user_engagement` join; measure separately).

## Deadline-realism problem — SHIPPED (2026-07-11 → prod 07-12)
"Surfacing opps with ~1-day notice nobody can pursue → users quit." Measured, worse than
described: of 21,962 ACTIVE respondable opps with a deadline, **55.2% (12,120) were already
PAST deadline** yet still `active=true` (SAM keeps a notice active until archive_date, weeks
after the response deadline). Only 44.8% had future runway.

Root cause in `/api/app/opportunities`: `.gte('response_deadline', <date-only midnight today>)`
— compared a full timestamp against a date string, leaking same-day-passed rows AND silently
excluding every NULL-deadline opp (nulls never satisfy `>=`).

**Fix (commits 74852d53 + 48b9195d):**
- New shared model `src/lib/opportunities/runway.ts` — single source of truth: `hasRunway`
  (filter), `runwayLabel` (🟢/🟡/🔴 badge), `runwayRank` (actionability sort).
- Query filters on full `now()` timestamp OR null (was date-only).
- `hasRunway` drops expired AND null-deadline **non-respondable** rows — 844 of ~900 active
  null-deadline rows are Award Notices/Justifications (already awarded, nothing to respond to);
  respondability gated via authoritative `classifyNoticeType().respondability !== 'none'`.
  Unknown/blank types kept (don't hide un-enriched real solicitations).
- Feed ranks by fit score, THEN real runway — pursuable opps float above ones closing tomorrow.
- AlertsPanel: one honest tier-colored runway badge per opp.

**Proof (default-NAICS slice):** 1,178 active-but-expired now HIDDEN; ~480 award-notice nulls
DROPPED; kept feed = 372 🟢 real-runway · 421 🟡 reasonable · 207 🔴 tight (tight ranked last).
22/22 + 11/11 unit assertions; tsc clean; build green; prod /app 200, route 401 (gated).

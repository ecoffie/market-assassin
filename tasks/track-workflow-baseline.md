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

## Deadline-realism problem (2026-07-11, IN PROGRESS)
Surfacing opps with ~1-day response windows → users can't realistically pursue → quit.
Fix direction: stop leading with un-actionable deadlines; rank/flag by whether there's
enough runway to respond. See deadline work below.

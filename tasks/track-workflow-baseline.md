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

## Measurement instrument — `scripts/measure-track-workflow.ts`
Run `npx tsx scripts/measure-track-workflow.ts` (14d vs prior 14d) or `--since 2026-07-11`
to split on the ship date. Customers only (staff/advocate/test excluded). Whale-capped
(`PER_USER_CAP=25`) so one power user can't dominate — one account created 761 pipeline rows
in 14d, so raw row counts are meaningless; distinct trackers + capped fill are the real signal.

### First read — 2026-07-12 (only ~1 day post-ship; mostly baseline-forming)
| Metric | prior 14d | last 14d | Δ |
|---|---|---|---|
| browsers (in-app: market_intelligence + source_feed) | 138 | 145 | — |
| distinct trackers (new pipeline rows) | 28 | 33 | +5 |
| browse→track rate | 20.3% | 22.8% | **+2.5 pts** |
| next_action fill (whale-capped) | 7.8% | 31.2% | **+23.5 pts** |
| give-up (browsed, never tracked) | 79.7% | 77.2% | **−2.5 pts** |

**Read honestly:** the next_action lift is real and immediate (write-time stamp on every new
row). The behavioral metrics (browse→track, give-up) are barely moved yet because <1 day of
post-ship data is in the window — the runway/expired fixes (feed, alerts, best-fit) shipped
07-11/07-12 and need ~1–2 weeks of users experiencing cleaner feeds before give-up moves.
**Re-run ~2026-07-19** for the first true before/after. NOTE: the plan's original "4%" browse→
track baseline used a different denominator (whole 1,540 alert audience, all-time) than this
script's in-window browsers — not comparable; use THIS script's numbers week-over-week.

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

## Keyword precision fix — SHIPPED (2026-07-12)
The pre-track nudge exposed generic auto-seeded keywords (law firm's "title" → matched a doc
title). Measured: 90% of keyworded profiles (609/624) had >=1 generic word; 531 were ENTIRELY
NAICS-title filler.
- **Forward-fix (live):** deriveKeywordsFromNaics now filters through isDistinctiveKeyword;
  GENERIC_SINGLE_WORDS gained 8 measured wildcards (public/title/certified/preparation/legal/
  computer/scientific/offices). New users get clean keywords.
- **Backfill (done):** scripts/clean-generic-keywords.ts --go wrote 78 strip-only profiles
  (kept real capability words; law firms → lawyers/notaries/accounting). 530 all-filler profiles
  LEFT UNTOUCHED (re-derive proved unsafe: IT profile → "pharmaceutical/steel/cutlery" via prefix
  fallback; NAICS matching still covers them). Snapshot saved to scratchpad before write.
  Verified: sample profiles hold cleaned arrays; strip-only remaining ~0.

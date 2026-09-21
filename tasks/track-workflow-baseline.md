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

### Second read — 2026-07-19 (first TRUE post-ship read — behavior moved) ✅
Enough post-ship days elapsed for behavioral metrics to move. The runway fix + keyword precision
+ "why fits you" nudge + "make it mine" banner WORKED on the two metrics they targeted.
| Metric | prior 14d | last 14d | Δ | verdict |
|---|---|---|---|---|
| browsers (in-app) | 146 | 203 | +57 | more traffic |
| distinct trackers | 30 | 74 | +44 | |
| **browse→track rate** | 20.5% | **26.6%** | **+6.1 pts** | ✅ lift |
| **give-up rate** (browsed, never tracked) | 79.5% | **73.4%** | **−6.1 pts** | ✅ the real test — dropped |
| next_action fill (whale-capped, script window) | 24.9% | 22.0% | −2.9 pts | ⚠️ see below |

- **profile_complete** (daily_metric_snapshots, `value` col — NOT `metric_value`): 1401 (07-11 ship)
  → 1459 (07-18) = **+58 in 7d (~8/day), every day positive.** The "make it mine" banner did NOT
  stall the funnel. Steady, not accelerated (historical ~13/day; last 7d ~8/day).

**The next_action "dip" is a REAL gap, not just the whale.** Diagnosed 2026-07-19:
- Capped fill on POST-SHIP rows only (created ≥07-11) = **30.6%** — right at the 31% target. The
  script's 22% is dragged by the pre-ship half of its 14d window + the whale (gary.grant@scientic.com,
  1,212 rows).
- BUT fill is **bimodal by `source`**, because the write-time stamp only fires on SOME track paths:
  | source | post-ship rows | next_action fill |
  |---|---|---|
  | mi_beta_expiring_contracts | 430 | **100%** ✅ |
  | briefings_dashboard | 83 | 86% ✅ |
  | interest_signal | 14 | 86% ✅ |
  | market_intel_dashboard | 398 | **0%** ❌ |
  | mi_beta_alerts | 385 | **0%** ❌ |
  | daily_alert | 102 | **0%** ❌ |
  | briefing | 12 | 0% ❌ |
- **Root cause:** `api/actions/add-to-pipeline` stamps `next_action` via `computeNextAction()`
  (`src/lib/pipeline/next-action.ts`) → 100%/86%. But `api/opportunities/save` + `save-redirect`
  (and the alerts/dashboard track paths → sources `daily_alert`/`market_intel_dashboard`/`mi_beta_alerts`)
  insert pipeline rows with `next_action = NULL`. ~900 of 1,424 post-ship rows (63%) come from these
  unstamped paths — that's the aggregate drag.
- **FIX (not yet done):** call `computeNextAction()` in the `opportunities/save` + `save-redirect`
  (and any track.ts) insert paths so every source stamps a next_action at write time. Would lift
  fill toward 100% for new tracks across all entry points.

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

## DENOMINATOR CORRECTION (2026-07-12) — measure against ELIGIBLE, not raw records
IMPORTANT for future sessions: do NOT measure profile/setup/give-up rates against the 10,236
`user_notification_settings` rows. That's raw account inventory — mostly dormant records that
never enabled alerts (the command-center dashboard note: "totals should not be compared directly
to daily sends"). Earlier work wrongly framed "86% un-set-up / 8,833 users" off this.

**ELIGIBLE = alerts_enabled=true = 1,664** (decided w/ Eric, matches dashboard "Alerts enabled
total"). Measured against THAT (non-excluded):
| segment | count | % of eligible |
|---|---|---|
| REAL profile (custom NAICS or distinctive kw) | 1,341 | 81% |
| un-set-up (generic/default/no real signal) | 323 | 19% |
| ├ default NAICS only | 34 | |
| └ no NAICS | 296 | |
| un-set-up AND active in 30d | 200 | |

So the audience is HEALTHY (81% set up). The generic-feed banner + setup nudges target ~200-323
real people, NOT thousands. The dashboard (getmindy.ai/command-center/dashboard) is the source of
truth — read it, don't re-derive off raw table counts.

## No-NAICS / setup-nudge funnel — MEASURED, healthy (2026-07-12)
Decision was "measure nudge conversion before building a 4th nudge." Done — funnel is working:
- **profile_complete** (daily_metric_snapshots): 1,088 (May 29) → 1,401 (Jul 11) = **+313 in 6wk,
  ~13/day and accelerating**. In-app nudges + onboarding convert steadily.
- **setup-invite-batch email cron**: enabled ✓, runs 2×/day (150/day cap), `last_status: success`.
  Queue is **DRAINED** — needsSetupRemaining=0, wouldSendThisRun=0 (all 937 entitled users
  invited/have-login). `setup_emails_sent`=0 recently = queue empty, NOT broken.
- **zero-alert-nudge**: enabled ✓, 50/day, still draining its ~217 cohort.
- The 296 no-NAICS eligible: 291 on daily alerts, 292 have ZERO signal, 177 active in-app.
  BOTH channels already nudge them (in-app "make it mine" banner shipped; email "Fix My Alerts"
  strip live via userNeedsMindySetup). **No 4th nudge needed** — funnel converting ~13/day.

GOTCHA logged: cron_jobs columns are job_name/enabled/cron_expr/last_run_at (NOT name/active/
cron_expression). A .select() with wrong names silently returns null → false "0 registered" alarm.

## Send health confirmed (2026-07-12) — Eric's "processed closer to 1500"
Daily-alerts today: **1,314 distinct recipients / 1,541 daily-eligible = 85%, still firing**
(pagination fix PR#113 working; was capped ~1,000). alert_log has NO status column (another
silent-null trap). Trending to ~1,500 as Eric expected.

## Daily-alerts window widened (2026-07-12) — finish before 8am EST
Goal (Eric): total processed complete by 8am EST with margin as the audience grows to ~1,500+.
Today drained fine (last send 6:05am EDT) but the old window's hard stop left little headroom.
Changed cron_jobs rows (NOT vercel.json):
- daily-alerts:    `0,15,30,45 5-9 * * *`  → `0,15,30,45 4-10 * * *`  (start 1hr earlier, end +1hr)
- daily-alerts-10: `0 10 * * *`            → `0 11 * * *`             (backstop after new window)
New window: 04:00–10:45 UTC + 11:00 backstop = 11pm–5:45am EST (12am–6:45am EDT). ~2hr more runtime.
Takes effect next window (tonight). WATCH on 07-19: actual completion time — if audience growth
outpaces throughput, bump DAILY_ALERT_BATCH_SIZE (currently 250) rather than widen further.

# Mindy activation framework

Owner: Agent 2 · Approved scope: Eric, 2026-11-14 (Phase 1: dashboard, signup logging, experiment design, measurement framework, stabilization checklist) · Status: **prepared, nothing customer-facing enabled**

**Central question:** what useful work does Mindy accomplish that makes customers want to return tomorrow?

**Working hypothesis (correlation, not proven):** track at least one real opportunity in the first seven days and return on a second day.

---

## 1. Two eras, never pooled

| | Early launch (2026-08-22 MCP launch → Stabilization Complete) | Stabilized (after Eric declares "Mindy Stabilization Complete") |
|---|---|---|
| How customers reached Mindy | Mostly Claude-connected MCP tools | Native app: Opportunity Map, tracking, card chat |
| Result quality | Search/intelligence defects being fixed; credits sometimes spent on unhelpful results | Verified by the stabilization checklist |
| Training | One Mindy Day session | To be planned |
| Free AI in the app | None (Ask Mindy chat is Pro-only; card chat not live) | Card chat, 10 credits per successful answer (unchanged) |
| Use of its numbers | **Diagnostic baseline only.** Never evidence about pricing, the free allowance or the business model | The activation, retention and conversion baseline |

The dashboard enforces this: `ACTIVATION_BASELINE_START` is unset, so every account is reported as early launch and the stabilized era is empty. It is set only after Eric declares stabilization complete.

## 2. Historical MCP behaviour (early-launch diagnostics)

> **Superseded definitions.** This table was measured with the first loader, before the corrections in §9: every in-app `link_click` counted as an email click, card opens were missed, in-app Ask Mindy tool calls counted as MCP use, 7-day windows started at UTC midnight and included accounts younger than 7 days, and accounts overlapping the 2026-08-21 → 09-27 telemetry outage were counted at face value. Most of this cohort overlaps the outage. Re-measure with the corrected loader before quoting any figure below; treat it as directional only.

Accounts registered 2026-08-16 → 10-14 (auth.users, staff/comp/advocate/test excluded), 1,107 accounts, measured by the dashboard loader against production (read-only, 2026-11-14):

| Experience | Accounts | First value ≤7d (proxy) | Tracked ≤7d | Milestone | Active days 15–30 | …with milestone | …without |
|---|---|---|---|---|---|---|---|
| Native app only | 410 | 53.7% | 20.2% | 13.4% | 21.7% | 47.3% (26/55) | 17.7% |
| App + MCP | 75 | 46.7% | 26.7% | 25.3% | 53.3% | 73.7% (14/19) | 46.4% |
| MCP only | 21 | n/a | 0% | 0% | 33.3% | — | 33.3% |
| Email only (signed up, reads Mindy email, no app use) | 51 | 0% | 3.9% | 0% | 0% in-app | — | — |
| No tracked activity | 550 | 0% | 0% | 0% | 0% | — | — |
| **All** | **1,107** | 23.0% | 9.5% | 6.7% | 12.3% | 54.1% (40/74) | 9.3% |

What these support and do not support:
- Half of registrations (550) never produced any tracked activity; 62.5% of those never signed in. That is a registration-quality and onboarding question, not a pricing one.
- Within native-app users only, the milestone group retained 2.7× better (47.3% vs 17.7%). The headline "5×" mixes in accounts that never used the app, so **2.7× is the fairer within-segment figure**. Still correlation: motivated people both track and return.
- MCP credit exhaustion (36 of 75 app+MCP and 11 of 21 MCP-only accounts hit the wall; most kept trying) happened while results were sometimes unhelpful. It is **not** evidence about the 100-credit grant or the 10-credit card-chat price.
- Paid conversion: 21 accounts were paying on day one (not conversions); 4 converted later. Too few to model.

## 3. Current native-app capabilities (verified state, 2026-11-14)

| Capability | State | Evidence |
|---|---|---|
| Opportunity Map browsing (no login) | Live | 15,026 anonymous IDs opened a listing in 90 days |
| Registration (email setup-password, password, Google, Microsoft, magic link) | Live | ~500 auth accounts/month |
| Introductory 100 credits at registration | Live (cutover set this session) | `registration-grant.ts` |
| Company profile | Live | 26% complete within 7 days |
| Track / save opportunities (pipeline) | Live | 134 users started a pursuit in 90 days |
| Saved searches / watches + alerts | Live; **evaluator parity open** (Agent 3: #2043 off, matcher changed 11-14) | Agent 3 |
| Contract change / deadline detection on tracked opportunities | Live (`pursuit-changes`) | `pursuit_change_log` |
| Ask Mindy chat | Live, **Pro only** | `api/app/chat` gate |
| Card chat (free, 10 credits/answer, Pro uncharged) | **Off**; charge-once fix in PR #2049 awaiting rollout | Agent 2 |
| Weekly digest of tracked opportunities | **Not built; not to be enabled without approval** | — |
| Pro trial | Live, new: 3 trials in 90 days, unattributable to accounts | `stripe_subscriptions` has no email |

## 4. Product-quality prerequisites

The new baseline cannot start until the essential journey works end to end in production. See `STABILIZATION-ACCEPTANCE-CHECKLIST.md` (owners: Agents 1, 2, 3, 4; Eric declares completion).

## 5. Metrics: three value stages, measured separately

All three are **proxies**. Mindy does not yet observe relevance or usefulness directly, and the dashboard labels them as such.

| Stage | Proxy (what the dashboard counts) | What it does not prove | Better signal, later (needs approval) |
|---|---|---|---|
| **First value**: discovered a genuinely relevant opportunity | Opened ≥1 opportunity listing/detail within 7 days | Relevance (a click can be curiosity or a mismatch) | A relevance rating on suggested opportunities; Agent 4's relevance labels |
| **Accumulated value**: kept useful work in Mindy | Tracked/saved an opportunity, created a watch, or got a saved card-chat answer within 7 days | That the saved item was worth saving | Saved items still tracked after 30 days; bid/no-bid decisions recorded |
| **Return value**: came back because Mindy did useful work | Mindy detected a change on a tracked opportunity AND the customer returned (app or email click) within 7 days | That the change was meaningful | Change type weighting (deadline/amendment vs cosmetic); "this was useful" feedback |

Reported alongside, never as value: **second active day ≤7d** (habit signal, not retention), **active days 15–30** (only for accounts observed 30+ days), **paid after day one** (day-one payers excluded), **credit wall and behaviour after it**.

Required measurements and where they are:

| Requirement | Dashboard field |
|---|---|
| Registration → first tracked opportunity | `everTracked` (pipeline minus bulk imports, saved opportunities, plus durable `pursuit_started` / `save_to_pipeline` events) |
| First meaningful search | `meaningfulSearch7d` (submitted Map search with results > 0; only accounts created after `searchMeasuredSince`) |
| First successful Ask Mindy answer | `askMindy7d` = card chat (`card_chat_turns` completed) or main chat (`mainChatAnswer7d`, see §9) |
| Time to first tracked opportunity | `medianHoursToFirstTracked` |
| Tracking adoption within 7 days | `tracked7d`, `tracked3plus7d` |
| Return on a second day | `secondDay7d` (labelled: not value, not retention) |
| Days 15–30 retention | `retained15to30` (+ with/without milestone) |
| Pro trial starts | **Gap**: trials cannot be tied to accounts (no email on `stripe_subscriptions`); needs a Stripe customer → email join, approval required |
| Paid conversion | `paidAfterSignup`, `paidAtSignup` |
| Credit exhaustion and subsequent behaviour | `hitCreditWall`, `activeAfterWall7d` |
| Email-alert registrants vs app users | `email_only` vs `native_app` / `app_and_mcp` segments |

## 6. Tracking-first onboarding experiment (design; disabled)

**Arms.** Control: today's onboarding. Treatment: (1) one-sentence business description, (2) 5–10 relevant open opportunities from Mindy's matcher, (3) a clear "Track this, Mindy will watch it for changes and deadlines" on each, with "track 1 to finish" as the goal. Skippable; nothing gated; no credits involved.

**Assignment.** `src/lib/activation/track-first-experiment.ts` (prepared, not wired): deterministic 50/50 hash of email, new accounts only (created at/after `TRACK_FIRST_EXPERIMENT_STARTS_AT`), never reassigns an account already in a cohort, excludes staff/comp/test. Stored in the existing `user_notification_settings.experiment_cohort` (all NULL today) as `track_first_v1_control` / `track_first_v1_treatment`, with an `experiment_log` audit row. Off unless `TRACK_FIRST_EXPERIMENT_ENABLED=true` **and** a start date is set.

**Primary outcome.** Milestone rate (tracked ≥1 + second active day within 7 days), treatment vs control, intention-to-treat (everyone assigned, whether or not they finished onboarding).
**Secondary.** Return-value rate; days 15–30 retention; time to first tracked; paid after day one (descriptive only at this volume).
**Guardrails.** Onboarding completion rate must not drop more than 5 points; first-value rate must not drop; no increase in support contacts about onboarding.

**Why it separates cause from population.** Random assignment at signup means both arms have the same mix of motivated and casual users, so a difference in milestone or retention is caused by the onboarding, not by who chose to track.

**Size.** ~500 accounts/month; ~50% sign in. To detect a milestone lift from ~7% to ~13% (80% power, two-sided 5%) needs ~400 accounts per arm: **roughly 6–8 weeks**. Days 15–30 retention reads 30 days after the last enrolment.

**Gate to start.** (1) Stabilization Complete declared; (2) the suggested-opportunity list passes Agent 4's relevance review for a sample of real business descriptions; (3) tracking, change detection and the customer's saved work verified on production; (4) Eric approves the final treatment screens and this plan.

## 7. Earliest safe point to begin measuring

1. Eric declares **Mindy Stabilization Complete** (checklist fully green on production).
2. Set `ACTIVATION_BASELINE_START` to that instant. Accounts created after it form the stabilized cohort; nothing earlier is mixed in.
3. First readable numbers: 7-day metrics for the first full week of sign-ups at **baseline + 14 days**; days 15–30 retention at **baseline + ~37 days**.
4. The experiment can start the same day as the baseline (after its own approval), so its control arm doubles as the stabilized baseline.

## 8. Rollout sequence and rollback controls

| Step | Change | Rollback |
|---|---|---|
| 1 | Merge Phase 1 (dashboard, logging, prepared experiment lib). No customer-facing change | Revert the PR |
| 2 | Apply `20261114_signup_events_account_verified.sql` via the runner (additive partial unique index) | `DROP INDEX signup_events_account_verified_once` |
| 3 | Verify: `/admin/activation` loads on production; a test signup writes `signup_started` → `signup_completed` → `account_verified` exactly once | — |
| 4 | Stabilization checklist driven to green by owners; Eric declares | — |
| 5 | Set `ACTIVATION_BASELINE_START` | Unset it |
| 6 | (Separate approval) Build treatment screens behind the flag; set `TRACK_FIRST_EXPERIMENT_STARTS_AT` + `TRACK_FIRST_EXPERIMENT_ENABLED=true` | Set the flag to anything but `true`: enrolment stops immediately; already-assigned accounts keep their label for analysis and see control onboarding |

Not part of this phase: the weekly digest, any alert delivery change, credit allowances, pricing, trial timing.

## 9. Measurement corrections (2026-11-14)

| # | Problem | Correction | Where |
|---|---|---|---|
| 1 | 7-day rates divided by every account, including ones created < 7 days ago; the window started at UTC midnight (up to ~8.9 days) | Windows are exact 24-hour steps from `createdAt`. A 7-day metric includes an account only once it is 7×24h old (`cohort.immature7d` reports the rest); days 15-30 need 31×24h | `framework.ts` |
| 2 | Every `link_click` counted as an email click; in-app clicks (source_feed, sidebar, market_intel_dashboard, opportunity_map) are thousands of rows | Email click = `link_click` whose `event_source` is an email tracking-token type (`EMAIL_CLICK_SOURCES`: daily_alert, weekly_alert, daily_briefing, weekly_deep_dive, weekly_deep_dive_retry, admin_briefing, legacy weekly_briefing / pursuit_brief). `daily_alerts` (plural) is the in-app Alerts panel and is an app event | `load.ts` |
| 3 | Card opens were missed (the card tracker stores the name in `metadata.kind`) | `kind` is read; `popup_open`, `click`, `cta_click` count as opening an opportunity. **Removed:** `pin_clicked` (logged even when no popup opens) and `office_viewed` (a buying office, not an opportunity) | `load.ts` |
| 4 | In-app Ask Mindy tool calls (`mcp_call_log.channel='app_chat'`) counted as MCP use | `app_chat` successes are app activity; MCP calls carry `channel` chatgpt / claude | `load.ts` |
| 5 | First meaningful search was not measured; the natural-language search path emitted nothing and no result count was recorded | The Map emits one `map_search` per submitted search (keyword and parsed intent), with `results`, `query_len`, `via` and the usual `filters`, after the round it caused settles. `results` is null when unknown (failed horizon, or no settled round within 20 s), never 0. Dedup on the lowercased text is unchanged. `searchMeasuredSince` (the first event carrying `via`) is derived from the data, so older accounts are "not measured", not 0% | `opportunity-map/route.ts`, `load.ts`, `framework.ts` |
| 6 | Only card chat counted as a successful Ask Mindy | Main chat is read from `mindy_chat_messages.trace` (see below) | `load.ts` |
| 7 | Outage-era accounts read as low numbers; deleted pursuits erase "ever tracked"; bulk imports counted as tracking | Windows overlapping 2026-08-21 → 2026-09-27T00:42:12Z are left out of engagement-based rates and counted in `cohort.telemetryGap*`; return value covers only accounts created after the outage. `pursuit_started` / `save_to_pipeline` events back up "ever tracked" / "tracked ≤7d" (never counts). `user_pipeline.source='base44_import'` rows are skipped | `framework.ts`, `load.ts` |
| 8 | `/api/welcome/choice` and `/api/government-contracts/search` attributed activity to a body-supplied email with no auth | Both record activity only for a verified session (`resolveMcpEmail`: signed MI token or Supabase session); otherwise nothing is recorded and the response is unchanged. Clients now send `x-mi-auth-token` when signed in | both routes, `welcome/choice-link.tsx`, `opportunity-hunter/page.tsx` |

**Denominators.** All accounts: signed in, ever tracked, median hours to first track, paid, credit wall. Mature (7×24h): tracked ≤7d, tracked ≥3, kept work, card / main chat / any Ask Mindy answer. Mature and outside the outage: first value, meaningful search, second day, milestone. Created after the outage: return value. Observed 31×24h and outside the outage: days 15-30.

**Known blind spot (deleted pursuits).** `user_pipeline` rows are hard deleted and `pipeline_history` / `pursuit_change_log` cascade with them. The engagement events are the only durable trace; a track from a surface that emits neither event and was later deleted is still invisible. A durable fix (soft delete, or an append-only `pursuit_events` row on create) needs approval.

**Main Ask Mindy success: what the loader reads, and the follow-up.** Since migration `20261114_ask_mindy_execution_trace`, the chat route persists a per-turn `trace` on the assistant message with `answer.finish_reason` and `notices`. The loader counts an assistant message as a successful answer when: trace present, no `trace.context` (card turns are counted from `card_chat_turns`), content non-empty, `finish_reason === 'stop'`, and no `truncated` / `tools_unavailable` / `lookup_failed` notice. Rows without a trace are reported as `mainChatUntraced` (unknown), never as failures. Limits that need a route change, deferred until PR #2053 (card-chat billing, same file) merges:
1. **The write is unawaited** (`persistExchange(...).catch()` after the stream closes). A serverless teardown can drop it, so main-chat success is a FLOOR. Fix: `await` the persist (or `waitUntil`) before closing.
2. **Failures are not persisted.** The error path (`catch (err)` in the stream) writes no row, so a failed answer is indistinguishable from no question. Fix: persist the assistant row with `trace.outcome = 'error'` (and the user row) on every path.
3. **A client disconnect is not in the trace** for main chat (`streamCut` only reaches card turns). Fix: push `client_disconnected` into `turnTrace.notices` when `streamCut`.
4. **Add an explicit outcome.** Write `trace.outcome: 'answered' | 'truncated' | 'tools_unavailable' | 'error' | 'client_disconnected' | 'empty'` computed by the same rule as `isBillableTurn`, so the loader stops re-deriving it. When it ships, `isSuccessfulMainChatAnswer` should prefer `trace.outcome` and keep the current rule for older rows.

**Effect on other dashboards.** `/admin/map-funnel` does not read `map_search`, so it is unaffected. `map_search` now fires after the search round settles (up to ~20 s later) instead of at submit, and natural-language searches now produce it, so raw `map_search` counts rise. Opportunity Hunter `search_completed` and `/welcome` choices are no longer attributed for visitors without a verified session, so those counts drop to verified users only.

**Rollback.** Revert the PR: the loader, dashboard and two routes return to their previous behaviour; the Map emitter returns to submit-time `map_search` without a count. No schema or data change to undo.

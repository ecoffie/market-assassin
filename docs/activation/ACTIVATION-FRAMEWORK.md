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
| Registration → first tracked opportunity | `everTracked` |
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

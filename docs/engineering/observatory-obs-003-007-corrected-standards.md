# Observatory OBS-003 – OBS-007: corrected standards (proposal for review)

**Status:** PROPOSAL, 2026-10-06. Methodology only. Nothing here is implemented, and no public label
(`/research/how-we-publish`, registry `lifecycle`) changes until this is approved and each measure
is rebuilt against it.
**Why:** `docs/engineering/observatory-obs-001-009-audit.md` §B found that OBS-003..007 accrue rows
but do not measure what their published methodologies describe. This document defines what each
measure *should* count, so the rebuild has a written target and the difference from today is visible.

**How to read the "today vs corrected" figures.** Every "corrected" number is an *indicative*
read-only computation on production (2026-10-06) under the definitions below, using an approximate
exclusion list. They show the size and direction of the correction. They are not publishable values
and must not be cited.

---

## 0. Headline: how much changes

| OBS | Published today | Under the corrected definition (indicative) | What drove the difference |
|---|---|---|---|
| 003 Return behavior | 12.1% of 17,191 ids return | **49.6%** of 690 new users return within 28 days | 87.7% of ids were anonymous browsers; email opens counted as activity |
| 004 Attention by agency | 6,005 "views", 74 users, top user **73%** | 885 viewer-department-days, 240 users, top user **2.3%** | 58% of "views" were dismissals; Map detail views never counted; no per-user cap |
| 005 Discovery index | **51.4%** browse-without-pursue | **97.3%** of 1,796 opened pairs not pursued (median user 100%) | one account was 47% of events and 75% of saves; pursuits were one panel's button |
| 006 Sharing | 22 shares (legacy table, 27% staff) | 179 attributable shares since 2026-09-23 (37 from 10 identified sharers) | read a retired table; the live share store was never read |
| 007 Decision time | median **0 h** | median of per-user medians **4.3 h** (1,008 pursuits, 365 users) | 91% of rows were email saves floored to "now"; most of those are automated (§2) |

---

## 1. Rules shared by all five measures

These apply unless a measure says otherwise. They are the main source of today's errors, so they are
defined once and enforced in one shared module.

### 1.1 Population classes
Every event belongs to exactly one class. Only **identified humans** count toward a headline.

| Class | Rule | Treatment |
|---|---|---|
| Identified human | `user_email` is a real address, not in any class below | counts |
| Staff | `@govcongiants.com`, `@getmindy.ai`, `INTERNAL_TEAM_EMAILS`, `MI_STAFF_EMAILS`/`MI_ADMIN_EMAILS` | excluded |
| Special | `isSpecialAccount()` (comp/testimonial, advocate, partner, billing canary) | excluded |
| Test / synthetic | reviewer and verification accounts, test/smoke/probe patterns, acceptance fixtures | excluded |
| Anonymous | `user_email LIKE 'anon:%'` (a browser id, not a person) | excluded from headlines; may be reported as a separate, clearly-labeled device series |
| Automation | see 1.3 | excluded |

⚠️ `isExcludedFromMetrics()` today covers only the **special** class. It does not exclude staff or
test accounts. The rebuild needs one `observatoryPopulation(email)` classifier used by every measure,
and the SQL side must use the same list (generated from the TS source, not retyped).

### 1.2 Email activity is not product activity
- `email_open` is never a qualifying event. Pixel opens are fired by mail clients and privacy proxies
  (Apple Mail Privacy Protection prefetches every image), so an open is not evidence a person read
  anything.
- Email `link_click` events (`daily_alert`, `weekly_alert`, `daily_briefing`, `weekly_deep_dive`,
  `pursuit_brief`) are not qualifying either. A click becomes evidence of a person only through the
  in-app event it leads to.
- Today email events store **no user agent at all** (48,765 of 48,765 in 30 days), so nothing can be
  classified after the fact. Writers must record UA and the alert/briefing id on every email event.

### 1.3 Automation
An event is automation when any of these hold:
- it comes from an API or programmatic surface (`players_api`, MCP, cron, admin tooling);
- it is an email-action write that completes **within 120 s of the email being sent**, or several
  actions from one email complete **within 1 s of each other** (the link-scanner signature; see §2);
- its user agent matches a known scanner or prefetcher (once UA is captured).

The 120 s / 1 s rule is a heuristic for history. The real fix is on the writer side (§2).

### 1.4 Identity and time
- **Person key:** `lower(trim(user_email))` for identified humans. Anonymous ids are never linked to
  accounts after the fact. `metadata.anon` is a boolean flag, not an id, and IP or user-agent
  fingerprinting is not acceptable. Forward linking via the share-attribution claim (`mindy_anon`
  cookie) may be adopted later, from its own contract date only.
- **Day:** the America/New_York calendar day.
- **Session:** there is no session column. Only 2,735 recent events carry `metadata.session_id`. No
  measure below depends on sessions. If one ever does, the writer must emit `session_id` everywhere first.

### 1.5 Concentration
Every published value carries **n events, n users, top-1 user share and top-5 user share**.
Rates are made concentration-robust by **equal weighting per user**: compute the rate per user, then
publish the median across users. Pooled rates are secondary. Counts are capped by a natural unit
(one per user per entity per day).

### 1.6 Freshness and coverage
- **Fresh:** the latest qualifying event is no more than 48 h old. Otherwise the measure shows
  `stale`, not its last value.
- **Coverage:** each measure lists the emitters it requires. A required emitter that has written
  nothing for 7 days puts the measure in `degraded`.
- **Unknown is never zero:** a failed or null count renders as `unknown` (Bug Prevention Rule #11).
  Three `?? 0` sites in `observatory.ts` violate this today.

### 1.7 Graduation ladder (all five)

| Stage | Requirements |
|---|---|
| **Collecting** | definition version recorded; the required writers emit; at least 1 qualifying event per day for 7 days |
| **Beta** | ≥ 30 qualifying users in the measurement window; top-1 user ≤ 20%, top-5 ≤ 50%; ≥ 60 days of clean collection under the current definition version; coverage met; exclusion and automation rules covered by unit tests |
| **Production** | ≥ 100 qualifying users; top-1 ≤ 10%, top-5 ≤ 30%; ≥ 180 days of clean collection; two consecutive monthly values within a stated tolerance, or the change explained; an oracle test against live data; no open writer defect for the measure |

- "Clean collection" restarts whenever the definition version changes or a writer defect is fixed.
- **Lifecycle comes from the registry only.** Today the engine auto-promotes OBS-003 to Beta at
  n ≥ 500 and demotes OBS-007 to Research, so the board and the public ladder disagree. The engine
  should report evidence; the registry should decide the label.

---

## 2. Cross-cutting finding: most email "saves" are automated (product defect)

This is outside the methodology, but it decides whether OBS-005 and OBS-007 can be measured at all.

The daily alert's one-click "add to pipeline" link is a **GET that writes a pipeline row**
(`src/app/api/actions/add-to-pipeline/route.ts`, signed-token auth). Mail security scanners
(Safe Links and similar) fetch links on delivery, and each fetch creates a save.

Measured on production, 2026-10-06:
- In the last 30 days, **2,472 of 2,965** (83%) `source='daily_alert'` saves landed **within 2
  minutes** of the alert being sent.
- Where one alert produced 2 or more of those saves (749 alerts), the saves land a **median 53 ms apart**, and 701 of the 749 (94%) within 1 second, which no person can do.
- Across non-staff pipeline saves with a notice id in the last 60 days, only **1,441 of 6,649** (21.7%)
  survive the automation rule.

**Consequence:** users' real pipelines contain items they never chose, and every pursuit-based measure
inherits that. **Recommended separate product fix (not part of this document):** the email link
opens a confirmation page and the save happens on a POST from that page. Until it ships, email saves
are ineligible for any Beta or Production pursuit measure.

---

## 3. OBS-003 Return behavior

| Item | Standard |
|---|---|
| Question | Of people who start using Mindy, how many come back on a different day? |
| Qualifying events | Any `page_view` or interactive event by an identified human on an **allowlisted app surface**: `opportunity_map`, `source_feed`, `market_intelligence`, `market_intel_dashboard`, `daily_alerts` (the in-app panel), `targeting_card`, `todays_intel`, `pipeline`, `pursuits`, `proposal`, `market_research`, `federal-market-assassin`, `forecasts`, `grants`, `settings`, `onboarding`, `sidebar`. It is an allowlist, so a new email or API source is excluded until someone deliberately adds it. |
| Exclusions | All email events (1.2), automation (`players_api` and similar), staff/special/test, anonymous ids |
| Identity / time | Person key; America/New_York active day |
| Numerator | Users in the cohort with **≥ 2 distinct active days** in `[first day, first day + 28 d)` |
| Denominator | Users whose **first** qualifying active day falls in the cohort month and who have been observable for ≥ 28 days |
| Secondary | Median active days in the first 28 days; the same rate for 56 days |
| Concentration | Not applicable per user (each person contributes one outcome). Report the surface mix of active days and flag any surface above 80%. |
| Minimum | Per monthly cohort: ≥ 30 users for Beta, ≥ 100 for Production |
| Freshness / coverage | Daily; the allowlisted surfaces must be emitting |
| Graduation | Ladder 1.7, judged on monthly cohorts. Production needs 3 consecutive monthly cohorts with ≥ 100 users. |
| Writer to correct | None for the data. Replace `observatory_return_behavior()` (no filters today) and remove the engine's n ≥ 500 auto-Beta. |
| History | **Repairable.** Identified in-app events exist from 2026-04-28 and recompute cleanly. Anonymous traffic (from 2026-08-17) is excluded by definition, so its arrival no longer bends the series. |

**Today vs corrected:** 12.1% of 17,191 ids (15,072 anonymous; email opens count as active days)
→ **49.6% of 690** new identified users (cohorts 2026-07-01..2026-09-08) returned within 28 days;
median 1 active day.

---

## 4. OBS-004 Attention concentration by agency

| Item | Standard |
|---|---|
| Question | Which buyers' opportunities draw contractors' attention, and how concentrated is it? |
| Qualifying events | **Detail views only:** Map `listing_open` (`opportunity_map`), Map card `popup_open` and `click` (`source_feed`), alerts-panel `open_details` on **both** tiers (`source_feed`, `daily_alerts`) |
| Not attention | `dismiss` (58% of today's "views"), saves, `pipeline_next_action`, `page_view`, and `impression` (121k passive renders; could become a separate "exposure" series) |
| Agency | Canonical buyer = `sam_opportunities.department` (sub-tier as a secondary breakdown), joined through the event's notice id. Without a notice id, map the label through the agency alias table. Anything unmapped is counted and shown as `unmapped`, never dropped. |
| Unit | Distinct **(person, department, day)**, so one user counts at most once per agency per day |
| Identity | Identified humans only. Anonymous device-days may be shown as a separate labeled series (7,909 in 90 days vs 885 identified). |
| Numerator / denominator | Agency share = agency viewer-days ÷ all viewer-days. Concentration = top-5 agency share and HHI across departments. Distinct viewers per agency is published alongside. |
| Concentration | Top-1 user ≤ 20% (Beta) / ≤ 10% (Production) of viewer-days. An agency row needs ≥ 5 distinct viewers to be shown. |
| Minimum | ≥ 30 / ≥ 100 users in a trailing 90 days |
| Coverage | **Department mapping ≥ 90%** of identified view events for Production. Today it is **36.8%**, which fails. |
| Writer to correct | Map card events emit the canonical `notice_id` (today `nid`/`opp`) plus department and sub-tier. The free-tier alerts panel is tagged the same way as Pro. Listing views of non-SAM records carry their record type so they can be excluded or mapped explicitly. |
| History | **Partially repairable.** Map popup/click events carry the agency label on 100% of rows and a joinable notice id on about 59% (from 2026-08-03). Alerts `open_details` carry agency (from 2026-05-21). Recompute, and report mapping coverage per period. |

**Today vs corrected:** 6,005 "views" from 74 users, 58% dismissals, top user 73% → **885
viewer-department-days from 240 users, top user 2.3%, top-5 10.2%**, across 31 departments (DoD,
VA, Interior, HHS and USDA lead). This version fails the coverage requirement (36.8% mapped).

---

## 5. OBS-005 Discovery index (browse without pursue)

| Item | Standard |
|---|---|
| Question | Of the opportunities people look at closely, how many do they not pursue? |
| Unit | A **(person, opportunity)** pair, keyed on the first detail view in the window |
| Qualifying open | Same detail views as OBS-004, with a notice id |
| Pursuit | A **human** pursuit: a `user_pipeline` row for that person and notice created within **14 days** of the first view. Email saves are excluded until the §2 fix ships, and afterwards only confirmed saves count. `save_to_pipeline` button events are not used: `user_pipeline` is the source of truth. |
| Numerator | Pairs **not** pursued within 14 days |
| Denominator | Pairs first opened in the window with ≥ 14 days of observation |
| Headline | **Median per-user browse rate** among users with ≥ 5 opened pairs. Pooled rate is secondary, with top-1 and top-5 shares. Also publish the inverse (pursuit rate), which is the more decision-useful framing at these levels. |
| Exclusions | 1.1–1.3 |
| Minimum | ≥ 30 / ≥ 100 users with ≥ 5 pairs |
| Concentration | Top-1 ≤ 20% / ≤ 10% of pairs (pooled) |
| Coverage | All four view emitters, plus the pipeline writer with a recorded save channel |
| Writer to correct | The §2 email-save fix. View events carry the canonical notice id. |
| History | **Partially repairable.** Opens recompute from 2026-08-03 (Map) and 2026-05-21 (alerts). Historical pursuits need the heuristic automation filter, so pre-fix values must be labeled heuristic and are not Beta-eligible. |

**Today vs corrected:** 51.4% (754 opens vs 712 saves from one panel; one account 47% of events and
75% of saves) → **97.3%** of 1,796 opened pairs from 241 users were not pursued within 14 days.
The median user's rate is 100%, top user 6.1% of pairs. The thesis ("browsing without pursuing is
the normal state") holds more strongly than today's number suggests. At 2.7%, pursuit is the
quantity to watch.

---

## 6. OBS-006 Sharing / referral

| Item | Standard |
|---|---|
| Question | How often do contractors pass opportunities to each other, and does anyone arrive? |
| Qualifying event | A **validated share**: the earliest `listing_share` carrying a well-formed `share_id`, as defined by the frozen contract (`docs/engineering/opportunity-share-attribution.md`, live from 2026-09-23, `e8c88086`) |
| Exclusions | Staff/special/test sharers; contract smoke and acceptance shares; visitors who are the sharer (same person key or anon id); link-preview fetchers once UA is captured |
| Identity | Sharer = identified human. Anonymous sharers are shown as a separate series. |
| Measures | (a) **shares by identified sharers per 28 days** and distinct sharers; (b) **reach** = share of validated shares with ≥ 1 validated non-sharer visitor (`entry=share`); (c) downstream signups and 7-day activation from the frozen funnel query (`src/lib/attribution/share-funnel.sql`) |
| Concentration | Top-1 sharer ≤ 20% / ≤ 10% of shares |
| Minimum | ≥ 30 / ≥ 100 distinct sharers in a trailing 90 days |
| Coverage | Every share surface emits the contract event. The legacy briefings `ShareButton` (the only writer of `opportunity_shares`) either emits the contract share or is retired. |
| Writer to correct | OBS-006 and `scripts/report-intel.mjs` must stop reading `opportunity_shares`. Visitor events should record whether the visitor is the sharer. |
| History | **Not repairable before 2026-09-23.** The 94 pre-contract shares carry no `share_id` and cannot be attributed. **Collection restarts at the contract date.** The 22 legacy-table rows stay a historical footnote only. |

**Today vs corrected:** 22 legacy rows (6 from staff, last 2026-09-18) → **179 attributable shares**
since 2026-09-23. 37 of those come from 10 identified external sharers (the top sharer has 10 of the
37), and 142 from anonymous sharers. 93 shares drew ≥ 1 visitor (180 visitors). Sharer self-visits
are not yet excluded. At 10 identified sharers this is still Collecting.

---

## 7. OBS-007 Average decision time

| Item | Standard |
|---|---|
| Question | How long after first exposure to an opportunity does a contractor decide to pursue it? |
| Qualifying pursuit | A human pursuit (§5 definition) by an identified human, with a notice id |
| Discovery | **First exposure** = the earlier of (a) the person's first in-app view of the notice under **any** id key (`notice_id`, `nid`, `opp`, `noticeId`, `opportunity_id`) and (b) the first alert or briefing delivered to them that contains the notice (`alert_log.sent_at`, delivered). Also report "first view → pursuit" as a secondary series. |
| Unknown discovery | **Excluded and counted** (coverage %). Never floored to the save time: that floor is what produces today's median of 0. |
| Value | Hours from discovery to pursuit |
| Headline | **Median of per-user medians.** The pooled median is secondary, with top-1 user share of pursuits. |
| Exclusions | 1.1–1.3, and email saves until the §2 fix |
| Minimum | ≥ 30 / ≥ 100 users |
| Coverage | Discovery known for ≥ 70% (Beta) / ≥ 85% (Production) of qualifying pursuits |
| Writer to correct | (1) The §2 email-save fix. (2) `resolveDiscoveredAt`: add the `nid`/`opp` keys and an `alert_log` lookup; store `discovered_at = NULL` plus a `discovery_source` when unknown, instead of `now()`. (3) Briefing emails record the notice ids they deliver (alerts already do, in `opportunities_data[].noticeId`). |
| History | **Partially repairable.** Exposure can be recomputed from `alert_log` and engagement (399 of 400 sampled email saves had a prior alert containing the notice). Separating human from automated email saves before the fix is heuristic only, so history is labeled heuristic. **Clean collection restarts when the email-save fix ships.** |

**Today vs corrected:** median 0 h over 6,592 stamped rows (91% email saves floored to "now") →
**median of per-user medians 4.3 h** over 1,008 human pursuits from 365 users (pooled median 0.3 h;
top user 3.5%). 433 human pursuits (30%) have no known exposure and are excluded, so coverage is
70%, at the Beta floor.

---

## 8. Repair vs restart, and suggested order

| OBS | History | Blocking writer work | Earliest realistic stage |
|---|---|---|---|
| 003 | Repair (recompute) | none | Beta after rebuild; Production after 3 monthly cohorts |
| 004 | Partial repair | notice id and department on Map events | Collecting until mapping coverage ≥ 90% |
| 005 | Partial (heuristic) | §2 email-save fix | Collecting until the fix plus 60 clean days |
| 006 | **Restart** at 2026-09-23 | read the contract store; retire or upgrade the legacy share button | Collecting (10 identified sharers) |
| 007 | Partial (heuristic) | §2 fix + resolver changes | Collecting until the fix plus 60 clean days |

**Suggested order:**
1. Shared population and automation classifier (1.1–1.3), with tests.
2. The §2 email-save fix (product, separate approval).
3. OBS-003 rebuild, which is history-repairable and needs no writer change.
4. OBS-006 store switch.
5. Writer changes for 004, 005 and 007, then their rebuilds.
6. Re-label in the registry only when each measure meets its stage.

## 9. Decisions needed

1. Approve the shared exclusion classes, in particular **excluding anonymous ids from every headline**.
2. Approve the **§2 email-save fix** as a separate product change. It affects users' pipelines, not
   just metrics.
3. OBS-005: publish browse rate (as defined) or switch the headline to **pursuit rate**.
4. OBS-007: headline on **first exposure** (alert delivery counts) or **first in-app view** only.
5. Graduation thresholds in 1.7 (30 / 100 users; 20% / 10% top-1; 60 / 180 days).

---

### Appendix: how the indicative figures were computed
All read-only SELECTs on production, 2026-10-06. Exclusions used: staff domains, the code-listed
internal team, comp, advocate and canary emails, and test patterns. Partner-contact emails and the
`MI_STAFF_EMAILS` env list were not included, so these figures are approximate.
- **OBS-003:** first qualifying in-app day per identified user. Cohorts with first day in
  2026-07-01..2026-09-08; returned = ≥ 2 distinct ET days within 28 days.
- **OBS-004:** detail views in the trailing 90 days, joined `notice id → sam_opportunities.department`;
  unit = distinct (user, department, ET day).
- **OBS-005:** pairs first opened 90..14 days ago; pursued = `user_pipeline` row within 14 days,
  excluding `daily_alert` saves within 120 s of an alert send to that user.
- **OBS-006:** earliest `listing_share` per `share_id`; visitors = distinct ids with `entry=share`.
- **OBS-007:** `user_pipeline` rows from the last 60 days with a notice id, the same automation
  exclusion, and discovery = min(first engagement under any id key, first `alert_log` delivery
  containing the notice).

# Observatory OBS-003 – OBS-007: corrected standards

**Status:** STANDARDS PROPOSAL, decisions recorded 2026-10-06 (§9). Methodology only.

**Implementation gate:** do **not** implement these calculations or change any public maturity label
(`/research/how-we-publish`, registry `lifecycle`) until both of these are fixed and verified in
production:
1. the email link-scanner save defect (§2; fix PR #1845, impact report #1846);
2. the missing Map-detail instrumentation (§4: detail views must carry a canonical notice id and
   department).

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
| 003 Return behavior | 12.1% of 17,191 ids return | **49.6%** of 690 new signed-in users return within 28 days | 87.7% of ids were anonymous browsers; email opens counted as activity |
| 004 Attention by agency | 6,005 "views", 74 users, top user **73%** | 885 viewer-department-days, 240 signed-in users, top user **2.3%** | 58% of "views" were dismissals; Map detail views never counted; no per-user cap |
| 005 **Discovery-to-pursuit rate** (renamed) | 51.4% "browse without pursue" | **2.7%** of 1,796 opened opportunities pursued within 14 days (complement 97.3%) | one account was 47% of events and 75% of saves; pursuits were one panel's button |
| 006 Sharing | 22 shares (legacy table, 27% staff) | 179 attributable shares since 2026-09-23 (37 from 10 signed-in sharers) | read a retired table; the live share store was never read |
| 007 Decision time | median **0 h** | only **11.6%** of human pursuits have a verified in-app discovery (167 of 1,441; 77 users) | 91% of rows were email saves floored to "now"; most of those are automated (§2); alert delivery no longer counts as discovery |

---

## 1. Rules shared by all five measures

These apply unless a measure says otherwise. They are the main source of today's errors, so they are
defined once and enforced in one shared module.

### 1.1 Population classes

| Class | Rule | Treatment |
|---|---|---|
| Signed-in human | `user_email` is a real account address, not in any class below | counts |
| Staff | `@govcongiants.com`, `@getmindy.ai`, `INTERNAL_TEAM_EMAILS`, `MI_STAFF_EMAILS`/`MI_ADMIN_EMAILS` | excluded |
| Special | `isSpecialAccount()` (comp/testimonial, advocate, partner, billing canary) | excluded |
| Test / synthetic | reviewer and verification accounts, test/smoke/probe patterns, acceptance fixtures | excluded |
| Anonymous | `user_email LIKE 'anon:%'` (a browser id, not a person) | **not excluded universally**; see 1.4 |
| Automation / bot | see 1.3 | excluded |

⚠️ `isExcludedFromMetrics()` today covers only the **special** class. It does not exclude staff or
test accounts. The rebuild needs one `observatoryPopulation(email, userAgent)` classifier used by
every measure, and the SQL side must use the same list (generated from the TS source, not retyped).

### 1.2 Email activity is exposure, not engagement
- `email_open` is never a qualifying event. Pixel opens are fired by mail clients and privacy proxies
  (Apple Mail Privacy Protection prefetches every image).
- Email delivery (`alert_log`) and email opens are **exposure signals only**.
- Email `link_click` events (`daily_alert`, `weekly_alert`, `daily_briefing`, `weekly_deep_dive`,
  `pursuit_brief`) are not engagement either. A click counts only through the in-app page event it
  produces (a page that loads and reports itself), which a link scanner does not do.
- Email events store **no user agent at all** (48,765 of 48,765 in 30 days). Writers must record UA
  and the alert/briefing id on every email event.

### 1.3 Automation and bots
An event is automation when any of these hold:
- it comes from an API or programmatic surface (`players_api`, MCP, cron, admin tooling);
- it is an email-action write that completes within **120 s** of the email being sent, or several
  actions from one email complete within **1 s** of each other (the link-scanner signature; §2).
  This applies to history only: after #1845 an email save requires an explicit confirmation POST;
- its user agent matches a known bot, crawler, preview or headless pattern. Anonymous Map events
  carry a UA on 100% of rows; about 4.5% match a bot pattern today.

### 1.4 Identity, anonymous traffic and time
- **Person key:** `lower(trim(user_email))` for signed-in humans.
- **Person-level measures** (OBS-003, OBS-005, OBS-007): the **headline uses signed-in users only**.
  Anonymous behavior is reported **separately** as its own labeled series, never mixed in.
- **Event / session measures** (OBS-004, OBS-006): anonymous sessions **may be included** only after
  automation, staff and bot filtering (1.3). The anonymous session unit is **(anon id, ET day)**,
  because there is no session column. Anonymous inclusion is disclosed with its own count.
- Anonymous ids are never linked to accounts after the fact. `metadata.anon` is a boolean flag, not
  an id, and IP or user-agent fingerprinting is not acceptable. Forward linking via the
  share-attribution claim (`mindy_anon` cookie) may be adopted later, from its contract date only.
- **Day:** the America/New_York calendar day. Only 2,735 recent events carry `metadata.session_id`;
  no measure depends on it.

### 1.5 Concentration
Every published value carries **n events, n users, top-1 user share and top-5 user share**. Rates
are made concentration-robust by **equal weighting per user**: compute the rate per user, then
publish the median across users. Pooled rates are secondary. Counts are capped by a natural unit
(one per person or session per entity per day).

### 1.6 Freshness, coverage and missing data
- **Fresh:** the latest qualifying event is no more than 48 h old. Otherwise the measure shows
  `stale`, not its last value.
- **Coverage:** each measure lists the emitters it requires. A required emitter that has written
  nothing for 7 days puts the measure in `degraded`.
- **Missing-data rate:** every published value states what share of in-scope records could not be
  classified or mapped (unknown discovery, unmapped agency, and so on).
- **Unknown is never zero:** a failed or null count renders as `unknown` (Bug Prevention Rule #11).
  Three `?? 0` sites in `observatory.ts` violate this today.

### 1.7 Graduation ladder (all five)

| Graduation | Minimum evidence |
|---|---|
| **Collecting** | definition version recorded; the required writers emit; at least 1 qualifying event per day for 7 days |
| **Collecting → Beta** | **100 distinct qualified users**; **60 clean days**; top user **≤ 20%**; mapping/attribution coverage **≥ 80%** |
| **Beta → Production** | **500 distinct qualified users**; **180 clean days**; top user **≤ 10%**; mapping/attribution coverage **≥ 95%**; **stable across two consecutive windows** (or the change explained) |

Additionally required **before Production**:
- **published uncertainty** (an interval or bootstrap range, with the sampling basis stated);
- **published missing-data rates** (1.6);
- **methodology versioning**: the definition version is shown with every value, and changes are
  recorded in the registry's version history.

Notes:
- "Qualified users" means users passing 1.1–1.4 for that measure. For OBS-006 it means distinct
  sharers.
- "Coverage" means the measure's mapping or attribution rate. That is department mapping for
  OBS-004, verified discovery for OBS-007, and the share of in-scope events the required emitters
  report for the others.
- "Clean days" restart whenever the definition version changes or a writer defect is fixed.
- **Lifecycle comes from the registry only.** Today the engine auto-promotes OBS-003 to Beta at
  n ≥ 500 and demotes OBS-007 to Research, so the board and the public ladder disagree. The engine
  should report evidence; the registry should decide the label.

---

## 2. Cross-cutting finding: most email "saves" were automated (product defect)

The daily alert's one-click "add to pipeline" link was a **GET that wrote a pipeline row**. Mail
security scanners fetch links on delivery, and each fetch created a save.

Measured on production, 2026-10-06:
- In the last 30 days, **2,472 of 2,965** (83%) `source='daily_alert'` saves landed **within 2
  minutes** of the alert being sent.
- Where one alert produced 2 or more of those saves (749 alerts), the saves land a **median 53 ms
  apart**, and 701 of the 749 (94%) within 1 second, which no person can do.
- Across non-staff pipeline saves with a notice id in the last 60 days, only **1,441 of 6,649**
  (21.7%) survive the automation rule.
- Across all history: **5,278 of 6,479** `daily_alert` saves (81.5%) match the signature; 161 users
  are affected; **3,408** pursuit-change emails were sent about suspected rows (#1846).

**Fix:** #1845. The email link opens a read-only confirmation page, and only an explicit button POST
saves, recorded with `confirmed_by_user` in `pipeline_save_confirmations`. After it ships, a
qualifying email pursuit is one with a confirmation record. Before it, email saves are ineligible.

---

## 3. OBS-003 Return behavior (person-level)

| Item | Standard |
|---|---|
| Question | Of people who start using Mindy, how many come back on a different day? |
| Qualifying events | Any `page_view` or interactive event by a signed-in human on an **allowlisted app surface**: `opportunity_map`, `source_feed`, `market_intelligence`, `market_intel_dashboard`, `daily_alerts` (the in-app panel), `targeting_card`, `todays_intel`, `pipeline`, `pursuits`, `proposal`, `market_research`, `federal-market-assassin`, `forecasts`, `grants`, `settings`, `onboarding`, `sidebar`. It is an allowlist, so a new email or API source is excluded until someone deliberately adds it. |
| Exclusions | All email events (1.2), automation and bots (1.3), staff/special/test |
| Identity | **Headline: signed-in users.** Anonymous return (per browser id, after bot filtering) is a separate series, not part of the standard's value. |
| Numerator | Users in the cohort with **≥ 2 distinct active days** in `[first day, first day + 28 d)` |
| Denominator | Users whose **first** qualifying active day falls in the window and who have been observable for ≥ 28 days |
| Secondary | Median active days in the first 28 days; the same rate for 56 days |
| Window | A rolling 90-day cohort window, so that the 100 / 500 user thresholds are measured on one window |
| Concentration | Each person contributes one outcome. Report the surface mix of active days and flag any surface above 80%. |
| Coverage | Allowlisted surfaces emitting; share of signed-in events from unknown surfaces reported as missing data |
| Writer to correct | None for the data. Replace `observatory_return_behavior()` (no filters today) and remove the engine's n ≥ 500 auto-Beta. |
| History | **Repairable.** Signed-in in-app events exist from 2026-04-28 and recompute cleanly. Anonymous traffic (from 2026-08-17) is outside the headline by definition, so its arrival no longer bends the series. |

**Today vs corrected:** 12.1% of 17,191 ids (15,072 anonymous; email opens count as active days)
→ **49.6% of 690** new signed-in users (cohorts 2026-07-01..2026-09-08) returned within 28 days;
median 1 active day. 690 users already clears the Beta user threshold; Production needs 500 per
window plus 180 clean days.

---

## 4. OBS-004 Attention concentration by agency (event measure)

| Item | Standard |
|---|---|
| Question | Which buyers' opportunities draw contractors' attention, and how concentrated is it? |
| Qualifying events | **Detail views only:** Map `listing_open` (`opportunity_map`), Map card `popup_open` and `click` (`source_feed`), alerts-panel `open_details` on **both** tiers (`source_feed`, `daily_alerts`) |
| Not attention | `dismiss` (58% of today's "views"), saves, `pipeline_next_action`, `page_view`, and `impression` (121k passive renders; could become a separate "exposure" series) |
| Agency | Canonical buyer = `sam_opportunities.department` (sub-tier as a secondary breakdown), joined through the event's notice id. Without a notice id, map the label through the agency alias table. Anything unmapped is counted and shown as `unmapped`, never dropped. |
| Unit | Distinct **(viewer, department, day)**; one viewer counts at most once per agency per day |
| Identity | Signed-in viewers, plus anonymous session-days **after** bot, automation and staff filtering (1.4). Each is reported with its own count (indicative 90 days: 885 signed-in vs 7,909 anonymous, before bot filtering). |
| Numerator / denominator | Agency share = agency viewer-days ÷ all viewer-days. Concentration = top-5 agency share and HHI across departments. Distinct viewers per agency is published alongside. |
| Concentration | Top-1 viewer ≤ 20% (Beta) / ≤ 10% (Production). An agency row needs ≥ 5 distinct viewers to be shown. |
| Coverage | Department mapping **≥ 80%** (Beta) / **≥ 95%** (Production) of qualifying view events. Today it is **36.8%**, which fails. |
| Writer to correct (**gate 2**) | Map card events emit the canonical `notice_id` (today `nid`/`opp`) plus department and sub-tier. The free-tier alerts panel is tagged the same way as Pro. Listing views of non-SAM records carry their record type so they can be excluded or mapped explicitly. |
| History | **Partially repairable.** Map popup/click events carry the agency label on 100% of rows and a joinable notice id on about 59% (from 2026-08-03). Alerts `open_details` carry agency (from 2026-05-21). Recompute, and report mapping coverage per period. |

**Today vs corrected:** 6,005 "views" from 74 users, 58% dismissals, top user 73% → **885
viewer-department-days from 240 signed-in users, top user 2.3%, top-5 10.2%**, across 31
departments (DoD, VA, Interior, HHS and USDA lead). This version fails coverage (36.8% mapped).

---

## 5. OBS-005 Discovery-to-pursuit rate (person-level), formerly "Discovery index"

The standard is renamed so the numerator is positive and decision-useful. **"Browse without pursue"
is reported as its complement**, not as the headline. The OBS id does not change.

| Item | Standard |
|---|---|
| Question | Of the opportunities people examine closely, what share do they go on to pursue? |
| Unit | A **(person, opportunity)** pair, keyed on the first detail view in the window |
| Qualifying discovery | Same detail views as OBS-004, with a notice id, by a signed-in human |
| Pursuit | A **human** pursuit: a `user_pipeline` row for that person and notice created within **14 days** of the first view. Email saves count only with a confirmation record (§2). `save_to_pipeline` button events are not used: `user_pipeline` is the source of truth. |
| **Headline** | **Median per-user discovery-to-pursuit rate** among users with ≥ 5 discovered pairs |
| Numerator | Pairs pursued within 14 days |
| Denominator | Pairs first viewed in the window with ≥ 14 days of observation |
| Complement | Browse without pursue = 1 − headline, reported alongside |
| Secondary | Pooled rate, with top-1 and top-5 shares |
| Identity | **Signed-in headline.** Anonymous detail views have no pursuit to match (pursuits require an account), so anonymous views are reported only as a separate volume series. |
| Concentration | Top-1 user ≤ 20% / ≤ 10% of pairs |
| Coverage | All four view emitters carry a notice id (≥ 80% / ≥ 95% of qualifying views); pursuits carry a save channel |
| Writer to correct | Gate 1 (#1845) and gate 2 (canonical notice id on views) |
| History | **Partially repairable.** Discoveries recompute from 2026-08-03 (Map) and 2026-05-21 (alerts). Historical email pursuits need the heuristic automation filter, so pre-fix values are labeled heuristic and do not count as clean days. |

**Today vs corrected:** 51.4% "browse without pursue" (754 opens vs 712 saves from one panel; one
account 47% of events and 75% of saves) → **2.7%** of 1,796 discovered pairs from 241 signed-in users
pursued within 14 days (complement 97.3%). Among the 98 users with ≥ 5 discovered pairs, the
median per-user pursuit rate is 0%; the top user holds 6.1% of pairs.

---

## 6. OBS-006 Sharing / referral (event measure)

| Item | Standard |
|---|---|
| Question | How often do contractors pass opportunities to each other, and does anyone arrive? |
| Qualifying event | A **validated share**: the earliest `listing_share` carrying a well-formed `share_id`, as defined by the frozen contract (`docs/engineering/opportunity-share-attribution.md`, live from 2026-09-23, `e8c88086`) |
| Exclusions | Staff/special/test sharers; bot user agents; contract smoke and acceptance shares; visitors who are the sharer (same person key or anon id); link-preview fetchers |
| Identity | Shares from signed-in sharers, plus anonymous-session shares **after** bot, automation and staff filtering (1.4), each reported with its own count. "Distinct qualified users" for graduation = distinct sharers (signed-in, or anon id after filtering). |
| Measures | (a) **validated shares per 28 days** and distinct sharers; (b) **reach** = share of validated shares with ≥ 1 validated non-sharer visitor (`entry=share`); (c) downstream signups and 7-day activation from the frozen funnel query (`src/lib/attribution/share-funnel.sql`) |
| Concentration | Top-1 sharer ≤ 20% / ≤ 10% of shares |
| Coverage | Every share surface emits the contract event (≥ 80% / ≥ 95% of observed shares carry a `share_id`). The legacy briefings `ShareButton` (the only writer of `opportunity_shares`) either emits the contract share or is retired. |
| Writer to correct | OBS-006 and `scripts/report-intel.mjs` must stop reading `opportunity_shares`. Visitor events should record whether the visitor is the sharer. |
| History | **Not repairable before 2026-09-23.** The 94 pre-contract shares carry no `share_id` and cannot be attributed. **Collection restarts at the contract date.** The 22 legacy-table rows stay a historical footnote only. |

**Today vs corrected:** 22 legacy rows (6 from staff, last 2026-09-18) → **179 attributable shares**
since 2026-09-23. 37 of those come from 10 signed-in external sharers (the top sharer has 10 of the
37), and 142 from anonymous sharers, before bot filtering. 93 shares drew ≥ 1 visitor (180
visitors). Sharer self-visits are not yet excluded. This is far from the 100-sharer Beta threshold.

---

## 7. OBS-007 Average decision time (person-level)

| Item | Standard |
|---|---|
| Question | How long after a contractor first genuinely engages with an opportunity do they decide to pursue it? |
| Qualifying pursuit | A human pursuit (§5) by a signed-in human, with a notice id |
| **Discovery** | **Verified human engagement only:** the person's first **in-app opportunity detail view** of the notice (any id key: `notice_id`, `nid`, `opp`, `noticeId`, `opportunity_id`), or a **scanner-safe opportunity click that reaches the page**, meaning a click whose landing page loads and reports an in-app event carrying the notice id. |
| Not discovery | **Email delivery and email opens are exposure only.** An email `link_click` by itself is not discovery (a scanner produces it too). |
| Unknown discovery | **Excluded and counted** as missing data. Never floored to the save time; that floor produces today's median of 0. |
| Value | Hours from discovery to pursuit |
| Headline | **Median of per-user medians.** The pooled median is secondary, with top-1 user share. A same-visit decision (detail view, then save in the same visit) is a real 0 and counts. |
| Identity | **Signed-in headline.** Anonymous viewers cannot pursue, so there is no anonymous series. |
| Concentration | Top-1 user ≤ 20% / ≤ 10% of pursuits |
| Coverage | Verified discovery for **≥ 80%** (Beta) / **≥ 95%** (Production) of qualifying pursuits |
| Writer to correct | (1) Gate 1 (#1845). (2) `resolveDiscoveredAt`: search the `nid`/`opp` keys, count only in-app engagement, and store `discovered_at = NULL` plus a `discovery_source` when unknown, instead of `now()`. (3) Opportunity links in emails land on a page that reports an in-app event with the notice id and `entry=email`, so a human click becomes verifiable discovery. (4) The surfaces that create most non-email pursuits (`market_intel_dashboard`, `mi_beta_*`, `briefings_dashboard`) must emit a detail-view event with the notice id. |
| History | **Partially repairable.** In-app views recompute under the new keys, but coverage is low (below). Clean collection restarts when gate 1 ships and the view emitters are fixed. |
| Future measure | **Exposure-to-decision** (first alert or briefing delivery → pursuit) is preserved as a separate, possible future standard. Delivery timestamps already exist in `alert_log.opportunities_data[].noticeId`. It is not part of OBS-007. |

**Today vs corrected:** median 0 h over 6,592 stamped rows (91% email saves floored to "now") →
under verified-engagement discovery, only **167 of 1,441** human pursuits in 60 days (**11.6%**) have
a prior in-app detail view; those come from 77 users, with a median of 0 h, mostly same-visit
decisions. **11.6% coverage is far below the 80% Beta bar**, so OBS-007 cannot graduate until the
writer changes above make discovery observable.

---

## 8. Repair vs restart, and order

| OBS | History | Blocking work | Gap to Beta (100 users, 60 clean days, top ≤ 20%, coverage ≥ 80%) |
|---|---|---|---|
| 003 | Repair (recompute) | none | users met (690); clean days start at rebuild |
| 004 | Partial repair | **gate 2** (notice id + department on Map views) | coverage 36.8% vs 80% |
| 005 | Partial (heuristic) | **gates 1 and 2** | 241 users met; clean days start after both gates |
| 006 | **Restart** at 2026-09-23 | read the contract store; retire or upgrade the legacy share button | 10 signed-in sharers vs 100 |
| 007 | Partial | **gate 1** + resolver + view emitters | coverage 11.6% vs 80% |

**Order:**
1. Gate 1: the email-save fix (#1845), then remediation per #1846 (separate approval).
2. Gate 2: Map-detail instrumentation (canonical notice id + department).
3. The shared population and automation classifier (1.1–1.4), with tests.
4. OBS-003 rebuild (repairable, no writer change).
5. OBS-006 store switch; OBS-004/005/007 rebuilds once their writers are fixed.
6. Re-label in the registry only when a measure meets its stage, including the pre-Production
   uncertainty, missing-data and versioning requirements.

## 9. Decisions recorded (2026-10-06)

1. **Anonymous users:** not excluded universally. Person-level measures (003, 005, 007) use signed-in
   users for the headline, with anonymous behavior reported separately. Event/session measures (004,
   006) may include anonymous sessions only after automation, staff and bot filtering.
2. **OBS-005:** renamed **Discovery-to-pursuit rate**. The headline is the pursuit rate;
   "browse without pursue" is its complement.
3. **OBS-007:** alert delivery is **not** discovery. Discovery is verified human engagement (in-app
   detail view, or a scanner-safe click that reaches the page). Delivery and opens are exposure.
   Exposure-to-decision is kept as a possible separate future measure.
4. **Graduation:** Collecting → Beta needs 100 users, 60 clean days, top user ≤ 20% and coverage
   ≥ 80%. Beta → Production needs 500 users, 180 clean days, top user ≤ 10%, coverage ≥ 95% and
   stability across two consecutive windows. Published uncertainty, missing-data rates and
   methodology versioning are also required before Production.
5. **Implementation gate:** no new OBS calculation and no public label change until gate 1 (#1845)
   and gate 2 (Map-detail instrumentation) are fixed.

---

### Appendix: how the indicative figures were computed
All read-only SELECTs on production, 2026-10-06. Exclusions used: staff domains, the code-listed
internal team, comp, advocate and canary emails, and test patterns. Partner-contact emails, the
`MI_STAFF_EMAILS` env list and bot user agents were not applied, so these figures are approximate.
- **OBS-003:** first qualifying in-app day per signed-in user. Cohorts with first day in
  2026-07-01..2026-09-08; returned = ≥ 2 distinct ET days within 28 days.
- **OBS-004:** detail views in the trailing 90 days, joined `notice id → sam_opportunities.department`;
  unit = distinct (user, department, ET day).
- **OBS-005:** pairs first viewed 90..14 days ago; pursued = `user_pipeline` row within 14 days,
  excluding `daily_alert` saves within 120 s of an alert send to that user.
- **OBS-006:** earliest `listing_share` per `share_id`; visitors = distinct ids with `entry=share`.
- **OBS-007:** `user_pipeline` rows from the last 60 days with a notice id, the same automation
  exclusion, and discovery = first non-email, non-open `user_engagement` event carrying the notice
  under any id key. Alert delivery is not used.

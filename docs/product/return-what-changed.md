# What changed since your last visit — the change-class audit

**Measured on production 2026-09-21. Read this before adding a number to the return brief.**

> RETURNING IS THE CONVERSION. This feature is not a news feed and not a summary. It answers
> one question — *what moved while you were gone?* — and it is allowed to answer only with
> change classes Mindy can prove from data it already holds.

## The measured problem

| | |
|---|---|
| Monthly users (30d) | 9,315 |
| Users who visit **one day and never return** | 8,096 (86.9%) |
| True-first-seen retention (excl. `email_open`) | D1 **6.7%** · D3 **10.9%** · D7 **15.9%** |
| Opportunity Map users (30d) | 8,540 — **8,214 anonymous (96.2%)**, 1,312 signed in |
| **Map returners** (30-minute sessionisation, ≥2 visits) | **414** — 219 anonymous, 195 signed in |
| …who returned after >12h / >1 day | 258 / 217 |

A returner sees exactly what they saw last time. Nothing on the map marks what arrived,
what closed, or what moved. Returning carries no reward, so the habit never forms.

## The audit — every candidate class, checked against the live database

### ✅ PROVABLE — shipped

**`new_in_market` — new opportunities in the market you were looking at**

- **Provenance.** `sam_opportunities.created_at` — *Mindy's own arrival clock*, i.e. "we learned
  about this after you left". Counted through the shared `applyMapFilters`, the same function the
  viewport API and the saved-search alert cron use, so the count and the page it links to agree.
- **Completeness.** 17,006 rows arrived in the 14 days before the audit; median lag behind SAM's
  `posted_date` **1.04 days**; **zero** arrivals in that window were backdated more than 2 days.
  `naics_code` is populated on **15,587 of 16,588** open rows (94.0%). Weekly rhythm is real
  (~1,800–2,500 weekdays, 30–1,000 weekends), not a sync artifact — checked across 30 days.
  `created_at` is deliberately preferred over `posted_date`: a late SAM publication cannot
  backdate itself past the visit boundary.
- **Current semantics — say it precisely.** The number is *new opportunities you can see on the
  map right now*, not *everything SAM published*. `applyMapFilters` defaults to `status:'active'`
  = `active = true AND response_deadline > now()`, and `.gt` on a NULL excludes it, so the 7,551
  active rows with no deadline never appear. Measured: of 1,264 rows that arrived in the last
  3 days and are still active, **447 (35.4%) carry no deadline**. Including them would be the
  worse choice — the CTA beside this number opens the map with the same scope, so a count that
  counted rows the map will not show would send the visitor to a page that contradicts it.
- **Simulated over the 414 real returners.** 110 had a recoverable NAICS scope; **70 of them had
  at least one genuinely new opportunity**, median **7**, max 970.
- **Honest failure.** No recoverable market → `state: 'no_basis'`, and **no number is rendered**.
  244 of 414 returners (59%) are in that position today.

**`listing_closed` — a listing you opened closed while you were gone**

- **Provenance.** Arithmetic, not a diff: `response_deadline` is a fixed future instant, so if it
  falls in `(last_visit, now]` it passed while the visitor was away. **No snapshot needed** — which
  matters, because no per-listing history exists for anything that is not a tracked pursuit.
- **Completeness.** Of the 3,973 distinct notice ids map visitors opened in 30 days, **1,415 still
  resolve** in `sam_opportunities` and **1,409 of those (99.6%)** carry a `response_deadline`.
  The 2,558 that do not resolve are recompete contract ids (532) and notices aged out of retention;
  they are **excluded and reported**, never counted as "unchanged". Resolving none of them yields
  `no_basis`, not `0 closed`.
- **Simulated over the 414 real returners.** **47 users, 92 listings.**

**Union: 93 of 414 returners (22.5%) would get at least one true, defensible statement.**
Today the answer for all 414 is nothing at all.

### ⛔ NOT SHIPPED — with the evidence

| Class | Verdict | Live evidence |
|---|---|---|
| `amendment` | **UNMEASURED** | `sam_opportunities.last_modified` is NULL on **215,098 of 215,098** rows. SAM's v2 `/search` response publishes no per-notice modified field at all (documented in `api/cron/pursuit-changes/route.ts`). The only amendment signal in the codebase is a re-posted `posted_date` compared against a **per-item snapshot**, and snapshots exist only for `user_pipeline` pursuits — **44 observations, ever**. A save is not a pursuit, so a saved listing has no snapshot to diff against. |
| `deadline_moved` | **UNMEASURED** | The detector has existed since 2026-06-30 and `pursuit_change_log` holds **0 rows** of `change_type='deadline'` across its entire life, against 3,004 `closed` and 44 `amendment`. A mechanism with no observations is unmeasured, not "0 changes". |
| `forecast_change` | **UNMEASURED** | `agency_forecasts.created_at` is **our import clock**: 1,981 rows landed on 2026-09-13 against 17–120 on ordinary days. Rendering that as "1,981 new forecasts" is a batch artifact wearing a market event's clothes. `updated_at` moved on **153 of 35,912** rows (0.43%) and records no field, so "the timing moved" and "a typo was fixed" are indistinguishable. |
| `recompete_moved` | **PROVABLE — withheld on scope** | `recompete_changes` is a real append-only log: **38,790 rows** since 2026-07-17, **5,793** `period_of_performance_current_end` changes in 30 days, each stamped `observed_at`, each carrying `naics_code`. The sweep is complete — all **478** NAICS attempted within 48h (oldest attempt 18h old at audit), so a multi-day window is not under-swept. Withheld because the **recompete horizon is OFF by default** on the map: this would be a fourth number answering a question the returning visitor did not ask. Ship it when the horizon is on. |

`WITHHELD_CLASSES` in `src/lib/return/change-classes.ts` carries these same strings, and
`change-classes.unit.test.ts` fails the build if a class is neither renderable nor withheld.

## How "last visit" is derived

No new identity system, no new table, no new cookie. `user_engagement` already records every map
event with a timestamp and a stable identity (`anon:<uuid>` for the 96% who are not signed in).

- A **visit** is a maximal run of that identity's events separated by less than **30 minutes**.
  Sessionising is not optional: `max(created_at)` alone answers "a few seconds ago" for anyone
  mid-session, which would make every window empty and every class read a confident zero.
- **Last visit** is the end of the run immediately before the current one.
- A gap shorter than **6 hours** is reported as *not a return*, not as a return with nothing in it.
  "Since your last visit" promises time passed; a coffee break did not clear that bar.

## Link discipline

`docs/engineering/record-links-vs-market-links.md` is frozen, and this feature emits both classes:

- **`new_in_market` → MARKET link.** `?naics=…&state=…` — carrying exactly the scope the count was
  computed from, allowlisted so telemetry noise (`bbox`, `zoom`, `device`) can never ride onto it.
- **`listing_closed` → RECORD link.** `?opp=<notice_id>` **alone**. Every listing in this class is
  past its deadline, so *any* status or scope param would delete the destination — the same failure
  as the daily-alert incident (PR #1441), only guaranteed rather than probable.

## Where it lives

| File | Role |
|---|---|
| `src/lib/return/last-visit.ts` | Pure sessionisation + the visit window |
| `src/lib/return/change-classes.ts` | The class registry, the withheld evidence, the link builders, `summarise()` |
| `src/app/api/app/return-brief/route.ts` | `GET /api/app/return-brief` — identity, scope, the two counts |
| `src/app/opportunity-map/route.ts` (`RETURN_BRIEF_JS`) + `template.html` (`#retBrief`) | The strip |

**No migration.** Every table this reads already exists. **No writes** — the brief creates no
`user_pipeline` row, no shortlist row and no identity; a page view is not a save and a save is not
a pursuit.

## Analytics

`return_brief_shown` carries `new_state` / `closed_state` alongside the counts, so "we showed
nothing" can be told apart from "we had nothing to show" — a `null` count with `state:'no_basis'`
is a coverage gap to close, not a quiet zero. `return_brief_click` carries `link_kind`
(`market` | `record`). Both ride the existing `__track` pipe into `user_engagement`.

## Verified against production

`GET /api/app/return-brief`'s own query path was run read-only over 60 real map identities,
through `parseMapFilters` + `applyMapFilters` (the shipping functions, not a hand-rolled copy):

```
candidates 60 · real returners 54 · with recoverable scope 28 (51.9%)
with a closed listing 2 · NON-EMPTY BRIEF 12 (22.2%) · 10 distinct scoped counts
```

Each scoped count was cross-checked against the **unscoped** arrival count for the same window,
because an unscoped count is what a broken filter looks like:

| scope | scoped | unscoped, same window |
|---|---|---|
| `naics=611699,611430,611519,541690` | 1 | 20 |
| `naics=236,237,238` | 3 | 20 |
| `q=saf/ia` | 6 | 20 |
| `agency=DEFENSE` | 4 | 22 |
| `state=CA` | 4 | 80 |
| `naics=336,334,335,423,…` | 86 | 607 |
| `state=TX` | 39 | 760 |

One identity resolved to `no_basis` on the market class (never filtered) and still received a
true brief from the listing class alone — *"2 you opened have closed"*. That is the intended
shape: a class with no basis contributes nothing and does not suppress the others.

⚠️ The **first** pass of this check applied only `naics` by hand and reported an identical
"20 new opportunities" for three different markets — which is exactly what an unscoped count
looks like. The check was rewritten to call the real shared filter before any of this was
believed.

## The metric this is meant to move

**D3 return rate for map visitors** (currently 10.9% platform-wide on true-first-seen).
Secondary: the share of returners who receive a non-empty brief — **22.5% today**, and the fastest
way to raise it is not a new change class but more recoverable scope, which is exactly what the
anonymous watch (W1) and anonymous shortlist (W2) now make possible.

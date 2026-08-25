# Observatory truncation defect (data integrity — HIGH)

**Found:** 2026-08-24, by the `audit-oversized-limits` guard built for the awards incident.
**Status:** OPEN. Captured deliberately outside the awards PR. Fix immediately after the
refresh worker is proven.

## What is wrong

Six Observatory query sites request far more rows than PostgREST will ever return.
`db-max-rows` is 1,000. `.limit(200000)` does not raise that ceiling — it returns
**1,000 rows and no error**. Every metric derived from those rows is computed from a
non-random prefix of the table (whatever the default order returns) and then presented
as a corpus-wide figure.

This is the same failure that cost getmindy.ai ~86% of its search impressions. It is not
a lint preference; it is a wrong number on a page.

## Expected versus observed

Measured against production, 2026-08-24:

| Query site | Rows it needs | Rows it receives | Coverage |
|---|---|---|---|
| `corpus()` — `observatory.ts:85` | 161,967 | 1,000 | 0.6% |
| `returnBehavior()` — `observatory.ts:145` | 161,967 | 1,000 | 0.6% |
| `attentionByAgency()` — `observatory.ts:175` | 5,485 | 1,000 | 18.2% |
| `discoveryIndex()` — `observatory.ts:200` | 24,810 | 1,000 | 4.0% |
| `decisionTime()` — `observatory.ts:242` | 2,022 | 1,000 | 49.5% |
| `report-intel.mjs` (4 sites) | up to 161,967 | 1,000 | 0.6%+ |

## The headline error

`corpus()` reports distinct users by building a `Set` over the rows it received:

    const { data } = await sb.from('user_engagement').select('user_email, created_at').limit(200000);
    const users = new Set(rows.map(r => r.user_email).filter(Boolean)).size;

Measured directly:

- **Displayed:** 23 distinct users
- **Actual:** 2,579 distinct users
- **Error:** −99.1%

`lastDay` is also wrong (2026-08-24 displayed vs 2026-08-25 actual) because the newest
events fall outside the truncated window. `returnBehavior()` builds its entire
distinct-active-days-per-user curve from the same 1,000 rows, so its `n` and every
percentile in the habit curve inherit the same 0.6% sample.

## Affected metrics and reports

Behavior domain only. The supply-side metrics use exact `head: true` counts and are
unaffected — that distinction matters and should survive the fix.

- `corpus` — events / **users** / firstDay / **lastDay**
- `return_behavior` — the habit curve, and its `n`
- `attention_by_agency` — rank order (already self-discloses the cap; see below)
- `discovery_index` — browse-without-pursue ratio
- `decision_time` — average discovery → pursuit
- `scripts/report-intel.mjs` — the same five, wherever that script's output was used

Output channels declared on these metrics: `annual`, `white_paper`, `press`, `weekly`.

## Were these published?

**Unresolved — must be answered before any restatement.** The metrics declare `press`
and `white_paper` channels, so the question is whether anything reached an external
audience carrying the wrong user count. Check the annual/white-paper drafts and any
outbound deck for a distinct-user figure near 23, or any habit-curve `n` under ~100.

Not every site is equally silent. `attentionByAgency()` already carries an honest note —
"Rank order from a N-event sample (PostgREST 1000-row cap)" — and is labelled `beta`.
That one disclosed the constraint; the other five did not.

## Exact query sites

    src/lib/analytics/observatory.ts:85    .limit(200000)  user_engagement   corpus()
    src/lib/analytics/observatory.ts:145   .limit(200000)  user_engagement   returnBehavior()
    src/lib/analytics/observatory.ts:175   .limit(60000)   user_engagement   attentionByAgency()
    src/lib/analytics/observatory.ts:200   .limit(60000)   user_engagement   discoveryIndex()
    src/lib/analytics/observatory.ts:242   .limit(50000)   user_pipeline     decisionTime()
    scripts/report-intel.mjs:117           .limit(200000)  user_engagement
    scripts/report-intel.mjs:155           .limit(60000)   user_engagement
    scripts/report-intel.mjs:186           .limit(60000)   user_engagement
    scripts/report-intel.mjs:220           .limit(60000)   user_engagement

## Interim posture (do this before the fix lands)

Until repaired, **the Observatory must not describe these five metrics as complete or
production-grade.** Downgrade their maturity and state the sample honestly, the way
`attentionByAgency` already does. A wrong number labelled `beta` is a known limitation;
the same number labelled production-grade is a false claim.

## The fix

1. Distinct counts and min/max belong in the database, not in a JS `Set` over a page.
   Use an RPC or `{ count: 'exact', head: true }` — a distinct-user count should never
   be derived from a row pull at all.
2. Where rows genuinely must be materialised (the habit curve needs per-user day sets),
   page with `readAllPages()` from `src/lib/paged-read.ts` and **refuse to publish unless
   `exhausted` is true**. Partial data must degrade to a disclosed sample, never to a
   confident wrong number.
3. Remove each fixed call's baseline entry — the ratchet requires it.

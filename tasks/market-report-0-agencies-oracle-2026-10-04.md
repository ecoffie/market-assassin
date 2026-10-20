# Market-report oracle: intermittent "0 agencies, $0.0B" — OPEN, needs investigation

Recorded 2026-10-04. **Not dismissed as harmless, not fixed.** Kept out of the saved-search UI PRs (#1825, viewport follow-up).

## What was observed
- Pre-push gate step 12 (warn-only oracles), `report: agency table uses the canonical 3-FY window (reconciles)`:
  `✗ FAIL … 0 agencies, $0.0B, canonical-window=true`
- Run: `mindy-prepush/ss-email-map-8ded54d3-20261004T184720-5684/oracles.log` (local time 18:47:20, branch `fix/ss-notice-inline-ux`, a presentation-only change that does not touch market code).
- Every other gate run found on 2026-10-04 (≈40, 08:12 → 18:49, all worktrees) passed with `10 agencies, $86.0B`. The next run, 2 min later (`…T184942…`), passed. Two manual reruns at 22:56Z passed.
- So: **1 failure in ~40 runs, self-cleared.** Cause unknown. (Gate runs later the same day, pushing
  #1826 at `cdf73a98`, `32e85333` and `970fab28`, all passed this check — still not an explanation.)

## Why "transient" is not an explanation yet
`scripts/verify-oracles.mjs` (report check) calls
`fetchSpendingCategory('awarding_agency', filters)` from `src/lib/market/spend-query.ts`
in its **default, non-strict mode** — which returns `[]` on a network error, a non-2xx, or the
25 s `AbortSignal.timeout`. Consequences:
1. The oracle cannot distinguish "USASpending did not answer" from "the canonical query returned
   no agencies" — both print `0 agencies, $0.0B`. (Silent-failure registry classes: no source ≠ zero;
   null → 0.)
2. Any product surface that calls `fetchSpendingCategory` without `{ strict: true }` would show an
   EMPTY agency table during the same window instead of an error. `generate_market_report` is
   documented as strict; the panel callers are not — **unverified which ones a customer saw at 18:47**.
3. The call passes no `limit` argument (signature: `(category, filters, limit, tag, opts)`), so the
   request body carries `limit: undefined` → omitted from JSON. Probably harmless (USASpending default),
   but it means the oracle is not exercising the same request the report makes.

## Questions for the investigation
- Did USASpending `spending_by_category/awarding_agency` error/timeout at ~22:47Z? (The oracle logs no
  error because the non-strict path only `console.warn`s — check whether the gate captured stderr.)
- Which customer-facing callers use the non-strict default, and what do they render on `[]`?
- Should the oracle call `{ strict: true }` so an outage reports as UNMEASURED, not FAIL-with-zero?

## Suggested first step (not done)
Re-run the oracle in strict mode in a loop (e.g. 50×) and log status/latency per call, to get a
failure rate and the actual error — before changing any product code.

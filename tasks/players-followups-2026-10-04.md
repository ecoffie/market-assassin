# Players — follow-ups and activation runbook (2026-10-04)

PR #1812 was merged **dormant**. The canonical code is in `main`, but the canonical path is not active and the production table does not exist yet. Audit: `tasks/players-naics-coverage-audit-2026-10-04.md`.

## Held state (do not change until the activation sequence below)

| Control | State | Owner of the change |
|---|---|---|
| `PLAYERS_SOURCE` | **unset** (= legacy top-50, labeled `coverage_incomplete`) | Eric, at step 6 |
| `players_naics_recipients` production table | **not created** | step 1 |
| `PLAYERS_REBUILD_AFTER_INGEST` | **unset** (no automatic rebuild) | Eric, after step 8 |
| BQ awards warehouse | **upstream-incomplete**: DoD 2026-02/03/04 at ~0% of prior year | BQ awards incident |

## Production invariants

- **Truth order:** filter → rank, never rank → filter.
- **Canonical identity:** UEI, not company name.
- **Canonical meaning:** Proven Players = companies with federal award history in this market.

## Open follow-ups

| ID | Pri | Item | Acceptance |
|---|---|---|---|
| PF-1 | P1 | **Players truth: the Contractors panel must keep unavailable as unknown, never convert it to 0.** `/api/contractors/search-bq` now returns `totalCount: null` plus `status`, but `ContractorsPanel.tsx` still does `setTotalCount(data.totalCount \|\| 0)`. | An unavailable search renders "couldn't load" (never 0). A `coverage_incomplete` count renders as a floor. Covered by a unit test. |
| PF-2 | P1 | **Players filtering: set-aside must be applied before candidate ranking/capping.** Today `contacts-map` ranks and caps to `MAX_PINS × 3` candidates and only then filters by set-aside. This is labeled `coverage_incomplete` with a reason. That labeling is acceptable temporarily. | The set-aside predicate is applied inside the Players query, before ORDER BY/LIMIT. This needs set-aside eligibility per UEI in the dataset, or a pre-filter on UEI. Oracle cell with a set-aside filter reconciles. |

## Activation sequence (only after the BQ awards incident is repaired AND reconciled)

1. **Canonical Players build:** `npm run players:rebuild -- --go`. The gate must pass on awards cohort completeness. Record shows `built_unreconciled`, and the table watermark equals the awards watermark.
2. **Reconcile:** `npm run players:rebuild -- --reconcile --go`. Record shows `reconciled`.
3. **Require parity:** all 48 oracle fixture cells, plus full NAICS×state parity (0 mismatched cells across the whole warehouse), via `npm run verify:oracles -- --only players` and the reconcile output.
4. **Browser-test Maps Players:**
   - Fixtures: 541512/TX, 238220/NY, 561720/CO, 541512/VA.
   - A zoomed-in city view.
   - A forced-error state that shows "couldn't load", never 0 or sales copy.
   - A partial (set-aside) state that shows "Top N shown".
   - Test this on a preview deployment with `PLAYERS_SOURCE=canonical` scoped to Preview.
5. **Test MCP `search_contractors`:** the fixtures return `_meta.status = success_nonzero` with `total` reconciling to truth.
6. **Activate:** run `printf 'canonical' | vercel env add PLAYERS_SOURCE production`, then trigger a fresh deploy.
7. **Verify live traffic:**
   - Read `user_engagement` `event_source='players_api'` `players_result` rows. Expect `source=players_canonical`, the status mix, and no unexpected `unavailable`.
   - Re-run the fixtures against getmindy.ai.
8. **Prove a cycle:** one subsequent awards ingest followed by a manual Players rebuild and reconcile passes. Only then set `PLAYERS_REBUILD_AFTER_INGEST=on`.

# Long-query statement timeouts on the Opportunity Map (Agent 3, 2026-11-14)

**Status:** documented, not fixed. Separate from C2 (#2048) and the security-guard fix (Eric, 2026-11-14).
Pre-existing: reproduced identically on the deployment before #2050 (`bh2k979v4`, plan v3) and after
(`aue1hpfim`, plan v4), and observed intermittently since before #2047.

## Symptom

`GET /api/app/opportunity-map?bbox=…&q=<long paragraph>` returns HTTP 500
`canceling statement due to statement timeout` after ~8.4 s. The user sees an error, not results.
Measured 2026-11-14 ~20:05Z, 3 attempts each, same result on both deployments:

| Sentence (Agent 4 benchmark) | Alternatives | Regex clauses in the text predicate | Result |
|---|---|---|---|
| We are a commercial cleaning company. We provide janitorial … | 5 | 55 | 500 timeout |
| We are a healthcare staffing firm. We place registered nurses … | 4 | 50 | 500 timeout |
| We are a mechanical contractor. We maintain, repair and replace HVAC … | 7 | 55 | 500 timeout |
| We are a construction contractor. We erect pre-engineered steel buildings … | 3 | 65 | 500 timeout |
| We are a supplier of industrial and defense replacement parts … | 5 | 45 | 200 in 7.7 s |
| We are a security services company … | 3 | 30 | 200 in 6.7–7.4 s |
| Short sentences (1 alternative) | 1 | 5–25 | 200 in 2–4 s |

Long keyword lists (8–9 s, e.g. the construction trades list, bakery list) intermittently 500 the same way.

## What the data says

- Every timeout has >=50 regex clauses; every search at <=45 completes, but 45 is already ~8 s. The cost scales
  with (concepts × columns): each concept is a case-insensitive word-boundary regex over 5 text columns
  (`OPEN_TEXT_COLS` = title, description, sow_text, department, solicitation_number), and `sow_text` is the full
  statement of work.
- The same predicate paged by `notice_id` in 500-row pages from a local script completes, so the failing step is
  the Map request's single bounded query + exact count under the request's statement timeout, not the predicate
  being invalid.
- Not caused by #2047 or #2050: neither changed the SQL shape; v3 and v4 time out on the same four sentences.

## Options (none started; each needs Eric's approval and must ship alone)

1. Cap the number of concepts/alternatives a typed paragraph can produce (fail narrow, label "searched the first
   N phrases"), no index change.
2. Precomputed or cached search per plan hash (same constraint found for C2 full-set totals, F8).
3. A text index for word-boundary search (needs a migration: not authorized).
4. Do not search `sow_text` on the request path for paragraphs above a size threshold.

Any option must be measured on the 36-search regression set (no target-trade loss) and on these four sentences.

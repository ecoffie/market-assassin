# #1696 — Maps Open 500 was a duplicate boot round, not a cold start (2026-09-26)

PRs: **#1706** (Part 2, the root fix). **#1704** (Part 1, Open count→pins reuse) is **kept DRAFT**; see the end of this file.

## Root cause
1. **Boot released round 1 before the Leaflet map had synced to its settled container.** The template's 450 ms `resize()` tick then shrank the map 2 px (818×698 → 818×696), fired `moveend`, and started a second full three-horizon round with counts.
2. **The client aborted round 1, but aborting a PostgREST request does not cancel its Postgres statement** (verified: it ran 4+ s past the abort). Both rounds therefore ran on a 2-core DB, and Open crossed PostgREST's 8 s `authenticator` statement_timeout → HTTP 500 `57014`.
3. **Second trigger, surfaced once the first was fixed:** the `render` wrapper auto-fit on every render, so the first horizon to paint moved the map while the others were still in flight.

## Fix (#1706)
- `releaseFit()` syncs the map size before release.
- `layout-move.ts`: a `moveend` with the same centre and zoom is a layout move and fetches only if it exposed area outside the last requested bbox.
- The map auto-fits only once the round has settled.
- `window.__mapBootTrace` instruments boot.

## Production baseline — `main` before #1706 (getmindy.ai, real browser, 2026-09-26)
| fixture | discovery rounds | requests per horizon | Open | settled | DB peak / heavy >1 s |
|---|---|---|---|---|---|
| fresh (memory cleared), `?q=software license` | **2** (round 1 aborted at 1.25 s) | 2 each | 200, 7.1 s | 8.55 s | 12 / 13 |
| warm reload | **2** (round 1 aborted at 0.6 s) | 2 each | 200, 7.6 s | 8.47 s | 13 / 14 |
| restored market (memory) | **2** (round 1 aborted at 0.8 s) | 2 each | **500, 8.2 s** | 9.74 s | 13 / 16 |
| default market | **2** (Open and Recompete aborted) | 2 each | 200, 1.4 s | 3.05 s | 13 / 0 |

## Preview (#1706 rebased, `pqfsr3oim`)
- **cold:** 1 round, 3 requests, 0 aborts, Open 200.
- **warm ×3:** 1 round, 3 requests each, all 200.
- **restored market:** 1 round.
- **default market:** 1 round.
- **Movement:** pan → pins only · zoom → pins only · layout grow → pins only · layout shrink → 0 requests.

**The "second round" seen once in five warm loads** was reproduced with `__mapBootTrace`. It is the **legitimate post-results auto-fit**:
- The remembered view (zoom 7, off the New England coast) did not frame the results.
- The last boot horizon finished at 5,988 ms, and the fit `moveend` followed at 6,061 ms, after settle.
- The follow-up round was **pins-only (`counts=0`)**, with 0 aborts.

It is not a boot duplicate. With a view that frames the results, 3 consecutive warm loads showed a single round each.

## Production after #1706
(filled in after the merge deploy; see the #1696 closing comment)

## #1704 — kept DRAFT (possible resilience fallback, not merged)
Measured against main + Part 2:
- **Ordinary searches:** no benefit.
- **Searches matching over 1,000 rows:** about 1 s slower (services 1.48 → 2.72 s, agency=Navy 0.97 → 1.62 s).
- **Single-user browser journey:** does not need it.
- **Where it helps:** only with simultaneous Open text searches. 4-way: A failed in 2 of 3 rounds (0/4, 4/4, 0/4) vs B 4/4 in all 3. 6-way: A 1/6, 0/6, 1/6 vs B 6/6, 5/6, 6/6.

Production logs cannot show whether several different users search at the same moment (1,895 Open requests in 24 h, all 200).

**If production telemetry ever shows simultaneous Open searches timing out, revisit Open text-search architecture and indexing** (the Recompete Gate-2 compute-once pattern) **rather than automatically merging #1704.**

# Maps P0 — speed + correctness (2026-09-24)

Scope approved by Eric: P0 only. **No transition screens, no Mindy Intel.** Audit that preceded it:
`tasks/maps-latency-transition-audit-2026-09-24.md`. PR #1684 (`perf/maps-p0`).

## How it was measured

- Same harness both sides: headless Chrome 154 (native arm64, own throwaway profile) driving the
  real page anonymously. It recorded the page's fetches and the timeline of `#rescount`, markers and
  rail, and read `window.__mapPerf` on the new build.
- **Before** = production `getmindy.ai` @ `c29974c5`, 4 runs across two sessions.
- **After** = the branch preview `market-assassin-git-perf-maps-p0-…vercel.app` @ `b3997f75 + 2nd
  commit`. That is the same Supabase and the same code path, but NOT production. **Production numbers
  still need re-taking after merge.**
- "first" = the first visible change after the action. "settled" = the last change, including the
  rail's off-screen cards finishing and late decorations. The harness polls at 16 ms, so every figure
  carries about 16 ms of polling slack.
- Medians are shown with ranges in parentheses.

## Before → after

| Journey | Before first / settled (reqs) | After first / settled (reqs) |
|---|---|---|
| Cold load | 9 horizon reqs in **3 rounds**; last response 12.0–12.7 s | 3 reqs in **1 round**; settled 4.5–5.6 s. The later boot triggers are answered from cache with 0 reqs |
| Search "ai governance" | 5.2 s / 5.2 s (3) | **2.0 s** / 4.0 s (3). The Recompete regex is the tail (see below) |
| Search "janitorial" | 2.6 / 2.6 (3) | **1.3** / 2.4 (3) |
| Search "cybersecurity" | 5.4 / 5.4 (3) | **2.0** / 4.9–9.2 (3). The Recompete regex again |
| Clear search | 2.6 / 2.6 (3) | **0.59** / 1.4 (**0**, cache) |
| NAICS 541512 | 1.3 / 1.3 (3) | **0.86** / 2.1 (3) |
| Agency USDA | 2.9 / 2.9 (3) | **0.73** / 2.0 (3) |
| Agency VA | 2.2 / 2.2 (3) | **0.71** / 1.8 (3) |
| State FL | 1.2 / 1.2 (3) | **0.35** / 0.9 (3) |
| 541512 + VA + FL | 0.77 / 0.77 (3) | **0.22** / 0.63 (3) |
| Horizon OFF | 1.6 / 1.6 (2) | **0.16–0.18** / 0.5–0.6 (**0**). `__mapPerf` render end: 117–124 ms |
| Horizon ON (unchanged) | 2.2–2.4 / same (3) | **0.18–0.23** / 0.9–1.0 (**0**). `__mapPerf` render end: 113–168 ms |
| Pan | 2.7 / 2.7 (3) | **1.3** / 2.9 (3, **all counts=0**) |
| Zoom in | 0.78 / 4.2 (3) | **0.19** / 3.3 (3, all counts=0) |
| Zoom out (back to a seen view) | 0.74 / 3.3 (3) | **0.23** / 1.7 (**0**, cache) |
| Open opportunity drawer | "Loading…" shell, full at 2.1 s | **Real shell in 3–5 ms** (title, buyer, est., due, NAICS…), full at 2.1 s |
| Start fresh | 2.3 / 3.0 (1) | **1.2** / 1.4 (1). 0 stale requests |
| Deep link `?q=cybersecurity` | first 0.76, settled 9.5 s (**9** reqs) | first 0.66, settled 5.3 s (**3** reqs) |

Warm server medians, measured with curl 4× per host:

| Request | Before (prod) | After (preview) |
|---|---|---|
| forecast-map, cybersecurity | 1.7–2.0 s | 0.65–0.8 s (concurrent reads) |
| opportunity-detail | 1.3–1.65 s | 0.72–0.83 s (5 reads concurrent) |
| recompete-map "ai governance", full | 2.6 s | 2.5 s (unchanged: see below) |
| recompete-map "ai governance", pan (`counts=0`) | 2.6 s | 1.2 s |
| opportunity-map CONUS, pan (`counts=0`) | ~1.0–1.5 s | 0.8–1.2 s (the viewport query itself dominates) |

Client render in the page:

| Page | Rows | render() | drawFeed |
|---|---|---|---|
| Prod | 3,150 | 528 ms | 316 ms |
| Preview | 3,079 | 141 ms | 2 ms (first 40 cards synchronous, the rest chunked) |

## Acceptance targets

| Target | Result |
|---|---|
| UI acknowledgement | **Not built** (P1 by design). A text search still shows the old market for ~1–2 s with nothing saying it is working. |
| Search/filter first useful result < 1 s where the backend permits | Structured filters **met** (0.22–0.86 s). Text searches **not met** (1.3–2.0 s). The fastest horizon's server time for text is ~1.2–1.8 s, so this is backend-bound. |
| Horizon toggle off < 100 ms | **Close, not met**: 117–124 ms render end, 0 requests. What remains is rebuilding every Leaflet marker (~2–3k). The next step is a diff-based marker layer. |
| Cached horizon toggle on < 300 ms | **Met**: 113–168 ms, 0 requests. |
| Pan/zoom: no market-count query | **Met**: every pan/zoom horizon request carried `counts=0`, and the server skips every bbox-independent count. |
| Stale response paints: 0 | **Met.** Proven in `newest-action-wins.unit.test.ts`: the pre-fix route fails 6/7, including the prod Start-fresh defect, and the fixed route passes 7/7. The live synthetic Start-fresh could not reproduce the stale request on EITHER build. The real-session reproduction was observed on prod in the audit (Browser 2). |
| Initial load: one discovery round after state resolution | **Met**: 1 round, 3 requests. |
| Drawer shell < 100 ms | **Met**: 3–5 ms. |

## The six opportunity-detail DB reads (concurrency decision)

Timed live on 2026-09-24:

| Read | Time | Decision |
|---|---|---|
| row | 142–483 ms | needed first |
| similar | 141–358 ms | concurrent |
| tracking count | 147–184 ms | concurrent |
| saved count | 199–203 ms | concurrent |
| distinct viewers (user_engagement JSON scan) | 321–327 ms | concurrent |
| family sidecar | 551–567 ms | concurrent; the slowest, so it sets the floor |

Candidates to make lazy next, if the drawer should get faster still: viewers and family are both
display-only sidecars. Intel, M-Win, events and contacts were already a separate, second fetch.

## Recompete keyword — query-plan evidence (NO index change made; awaiting approval)

EXPLAIN (ANALYZE, BUFFERS) on the live DB, read-only, transaction rolled back:

| Input | (a) market total | (b) unmapped | (c) pins + count | (d) follow-ons | Plan |
|---|---|---|---|---|---|
| naics=541512 | 19.5 ms | 9.8 ms | 39.0 ms | 30.3 ms | BitmapAnd on `idx_recompete_naics` |
| janitorial | 17.9 | 8.0 | 35.0 | 29.0 | preset → 3 NAICS, indexed |
| ai governance | **438.8** | **321.7** | **577.6** | 78.2 | 18 `~*`/`~` whole-word regexes over 6 text columns, applied as a Filter over ~142k in-window rows |
| cybersecurity | **860.3** | **637.5** | **858.2** | 78.1 | preset + 21 regexes (7 terms × 3 columns) ORed with the NAICS codes, so every row pays every regex |

- **Root cause.** No index can serve the regexes. There is no pg_trgm index on these columns. The
  existing `idx_recompete_fts` tsvector is unused by these plans. The window predicate leaves about
  142k of 178,601 rows, so the cost is CPU spent evaluating regexes (all cache hits, no disk reads).
- **The same predicate is evaluated about 5× per request.**
  - (a) and (b) each scan with it.
  - (c) runs with `count:'exact'`, so PostgREST evaluates it twice: the page plus a count subquery.
  - (d) is cheap because `data_source` narrows it first.
- **After P0**, a pan skips (a) and (b) entirely, and a new search runs them concurrently with (c)
  and (d) instead of as a separate phase before them.
- `pg_trgm` is already installed.

Recommendations, ranked, **none applied**:

1. GIN trigram indexes (`CREATE INDEX CONCURRENTLY … gin (col gin_trgm_ops)`) on `description`,
   `naics_description`, `incumbent_name`, `psc_description`, and possibly the two agency columns.
   - Expected: ~20–60 ms per read, down from ~850. This is an estimate that must be confirmed with
     EXPLAIN after a build.
   - The 2-character `\mAIs?\M` term can't use a trigram index, but the AND with the governance
     terms can.
2. Stop the double evaluation in (c): use `count:'planned'` for totalInView, or compute it once.
3. One RPC doing total, unmapped and pins in a single pass: measured 568 ms / 1,257 ms against
   1.5–2.6 s today. The cost is translating the canonical plan's ops to SQL, which is a drift risk
   with MCP.
4. Trim the matcher's agency columns (a matching-behaviour change, so it needs the relevance fixtures).
5. Server-side cache of (a)/(b) per plan hash (complements the client cache).

## Not done / next

- **P0.5: diff-based marker layer.** It is the last ~100 ms of a cached repaint, and the only miss
  on the toggle-off target.
- **Open viewport query.** At CONUS zoom the pins-only query is ~0.8–1.2 s: `count:'exact'` on the
  bbox, plus 1,000 rows carrying the `attachments` / `points_of_contact` JSON columns. That is a
  candidate payload trim.
- **P1 acknowledgement** is where the remaining 1–2 s text-search wait should be spent. See the
  audit's transition matrix.

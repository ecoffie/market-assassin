# Recompete performance Gate 2 — compute the canonical market ONCE (design + parity, 2026-09-24)

Status: **design, implementation of the pure pieces, and the parity oracle. NOT wired into the route. NOT deployed.**

Preceded by Gate 1 (`tasks/recompete-gate1-2026-09-24.md`), which shipped deterministic pagination, planner-independent follow-ons and six trigram indexes.

## The problem (measured)
- After Gate 1, prod `recompete-map` still takes **4.45 s** for "software license" and **4.53 s** for the broad capability list.
- The trigram indexes narrow the candidates, but these markets match 5–30k contracts. Rechecking 18–60 whole-word regexes on them costs ~0.9–2.5 s **per evaluation**.
- The route evaluates that predicate about 4 times per request:
  - market total (head count)
  - unmapped (head count)
  - the viewport page, whose `count:'exact'` makes PostgREST evaluate the page **and** an unlimited count
- Since Gate 1 the follow-ons no longer re-evaluate the text predicate: the regex runs only on ≤100 candidate ids at a time.

## The design

### One evaluation, everything derived from it
```
WITH m AS MATERIALIZED (                       ← the ONLY place the canonical predicate runs
  SELECT contract_id AS _id, period_of_performance_current_end AS _end, data_source AS _src,
         (map_lat IS NOT NULL) AS _mapped, COALESCE(<bbox>, false) AS _inview
  FROM recompete_opportunities
  WHERE <canonical plan ops> AND <Maps surface filters>)
page AS (… FROM m WHERE _mapped AND _inview ORDER BY _end, _id LIMIT cap)
fo   AS (… FROM m WHERE _mapped AND _inview AND _src = follow-on ORDER BY _id COLLATE "C" LIMIT cap)
SELECT total, unmapped, in_view (counts over m),
       pins (page ⋈ table by contract_id, full pin columns, in page order),
       follow_ons (fo ⋈ table, full pin columns)
```
- **Total, mapped/unmapped truth, viewport pins and follow-ons** all come from the single `m`.
- Pin columns are fetched **only for the ≤1,000 page rows and ≤1,000 follow-ons**, by `contract_id`, a unique-index lookup. The materialized set stays narrow even for a 30k-contract market.

### No second search interpreter
Meaning comes from exactly two places, both shared with the live path:
1. **`req.plan.horizons.recompete.ops`**, the Canonical Discovery plan, unchanged.
   - It is serialized by `src/lib/discovery/sql.ts`, the SQL twin of `apply.ts`: mechanical, no search decisions.
   - The grammar is closed. Top-level ops are `or | eq | is | gte | lte | ilike`. Leaf ops are `eq | like | ilike | imatch | match | is.null | not.imatch | not.match`. Anything else **throws**.
   - Every value is a bind parameter. Columns come from a typed whitelist (`RECOMPETE_COLUMN_TYPES`).
2. **`mapsRecompeteSurfaceOps()`** in `maps-recompete-discovery.ts`, the Maps surface filters as data.
   - This covers set-aside, sub-agency, value range, contract type (SAP), likelihood and the mapped bound.
   - **Both** appliers consume it: the PostgREST builder, which makes the same calls in the same order as before (pinned by a unit test against the verbatim pre-refactor function), and the SQL twin.

### Presentation stays separate
bbox, page order (expiry → `contract_id`), pin cap, pin columns and the follow-on source are **parameters** owned by the route. The route keeps its merge/dedupe and `toPin`. Nothing presentational moved into the plan.

**Collation:**
- The page tie-break uses the **database** collation (en_US.UTF-8), exactly like the live `.order('contract_id')`.
- The follow-ons use `COLLATE "C"`, because the live path (`map-follow-ons.ts`) sorts them in JavaScript, which is code-unit order. The two agree on all 410 current ids; `"C"` makes that hold for any future id too.

## Parity oracle (`scripts/recompete-parity.ts`) — CLEAN
It runs the live multi-read path (the same supabase-js/PostgREST calls as the route) and the one-pass statement on the full fixture suite, requiring **byte identity** on:
- market IDs
- total
- unmapped
- in-view count
- the ordered pin rows (full JSON)
- the follow-on rows (full JSON)
- the merged pin list the route ships

Any difference is re-run once on both sides before it counts, so hourly-sync churn cannot masquerade as a parity failure.

**2026-09-24 18:03–18:10 UTC: ✓ 48/48 byte-identical, 0 re-runs needed.** The suite:
- all **30 canonical discovery fixtures**
- the 3 Gate 1 queries not already among them (broad capability list, nonsense, NAICS 541512)
- **10 surface-filter fixtures**: every Maps-only filter, plus all of them at once
- **4 viewports**: DC ×2, ocean (0 in view), Alaska

Timings from the same machine (old = the route's reads via PostgREST; once = the single statement):

| Fixture | Old path | Once |
|---|---|---|
| software license | 4.1 s | **1.43 s** |
| broad capability list | 4.5 s | **2.58 s** |
| USDA / VA agency | 3.3–4.1 s | 1.1–1.26 s |
| cybersecurity | 1.8 s | 0.24 s |
| janitorial | 2.8 s | 0.14 s |
| typical selective query | 0.7–1.6 s | **0.09–0.25 s** |

Unit tests: `src/lib/recompete/maps-recompete-sql.unit.test.ts`.
- Every canonical fixture compiles.
- User text never enters the SQL string.
- Unknown operators and columns are refused.
- Exact leaf translation.
- The predicate appears **exactly once**, inside one MATERIALIZED CTE.
- Placeholders stay in lock-step with values.
- The surface-filter call sequence is identical to the verbatim old applier across 27 combinations.

## Deployment shape (proposed — needs approval; nothing below exists yet)
**A. Server-side `pg` through the Supabase transaction pooler (recommended).**
- The route runs the parameterized statement directly (node-pg unnamed statements are compatible with transaction pooling).
- No DDL, no RPC, and no endpoint that accepts SQL text.
- Needs a pooled `DATABASE_URL`-style secret in Vercel, plus a connection-reuse pattern for serverless.

**B. A plpgsql RPC that compiles JSON ops inside the database.**
- A second compiler, in SQL. That is a drift risk, and the oracle would have to guard both. Not recommended.

**C. An RPC that takes SQL text.**
- **Rejected.** It is arbitrary SQL execution behind PostgREST.

**Rollout, after approval:**
1. Flag `RECOMPETE_COMPUTE_ONCE` (off).
2. **Shadow mode.** Serve the old path, run the one-pass statement alongside, and log any field difference (the same comparison as the oracle, on real traffic).
3. Flip the flag once the shadow diffs are clean for N days.
4. Delete the multi-read path.

The parity oracle stays as the pre-deploy gate for any change to `discovery/sql.ts`, `maps-recompete-sql.ts` or the surface spec.

## Rollout implementation (approved 2026-09-24: shadow → canary → authority)
- **Execution:** `src/lib/recompete/compute-once-pg.ts`.
  - Server-side `pg` Pool (default 2 connections per instance) on the Supabase **transaction pooler** (:6543). `RECOMPETE_PG_URL` is used if set; otherwise it is derived from `DATABASE_URL`, and any host that is not a pooler is refused.
  - Every execution runs in `BEGIN READ ONLY; SET LOCAL statement_timeout` (default 8 s).
  - A connection that fails is destroyed, never returned to the pool.
  - `recompeteOnePassSql()` runs **before any I/O**, so an unrecognized plan op throws before anything is queried (fail closed).
- **Paths:** `src/lib/recompete/recompete-map-paths.ts`.
  - `readOld` is the PostgREST reads, moved verbatim.
  - `readNew` is compute-once.
  - `buildRecompeteMapBody` is the **only** response builder.
  - `compareReads` compares the market total, mapped, unmapped, in-view, ordered pin IDs, pin payloads, follow-on IDs, discovery status and the full response body.
- **Control:** `src/lib/recompete/compute-once-mode.ts`.
  - `RECOMPETE_COMPUTE_ONCE_MODE=off|shadow|canary|authority`, with `_SHADOW`, `_CANARY_PCT` and `_VERIFY` rates.
  - **`off` is absolute.** That is the rollback.
  - An operator can force a path for the controlled production sample with `x-recompete-force` plus `x-recompete-verify = CRON_SECRET`, compared in constant time.
- **Route:**
  - The decision is made per request.
  - A compute-once failure falls back to `readOld` **for that request**, and the body is the same.
  - The comparison, a both-sides re-read on any difference (so churn is classified rather than counted), and the log all run in `after()`.
  - The user never waits for them and never sees a difference.
  - `x-recompete-path: old|new|fallback` is operational metadata only.
- **Evidence:** table `recompete_compute_once_log`, migration `20260924_recompete_compute_once_log.sql`, additive, RLS on, service-role only. It holds one row per request while the mode is not `off`: served path, both latencies, outcome and mismatch fields.

## What compute-once does not fix
- For a 22–30k-contract market, a single regex evaluation is still ~1.4–2.6 s.
- The next lever would be precomputing concept → contract matches, a materialized concept index maintained by the hourly sync. That is a separate track, with its own product decision about freshness.

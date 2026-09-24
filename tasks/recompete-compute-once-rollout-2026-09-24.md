# Recompete Gate 2 — compute-once rollout record (shadow → canary → authority, 2026-09-24)

Design and parity: `tasks/recompete-compute-once-design-2026-09-24.md`. Code: #1688 (`8130e635`), #1689 (busy
fail-fast, `dfb3ccf8`), #1690 (old_degraded classification, `1a58550e`). Production serves **`1a58550e`** with
`RECOMPETE_COMPUTE_ONCE_MODE=authority`, `RECOMPETE_COMPUTE_ONCE_VERIFY=0.1`. The PostgREST path is still in
the code as the rollback. **Do not delete it until acceptance is signed off.**

Tools (all read-only against prod):
- `scripts/recompete-rollout-sample.ts --force shadow|new`: the controlled sample. 80 cases: 30 canonical
  fixtures, text (broad, selective, nonsense), NAICS (exact, prefix, multi), PSC, agency, multi-agency, state,
  exclusions, every Maps-only filter plus all at once, and 7 viewports (CONUS, DC, TX, CA, ocean, AK, HI).
- `scripts/recompete-rollout-report.ts --since <iso> --mode <m>`: outcomes, latency, every non-identical row.
- Operator force: `x-recompete-force: old|new|shadow` + `x-recompete-verify: $CRON_SECRET`.

## Stage 1 — shadow (user served PostgREST; compute-once compared in `after()`)

| Run | Deploy | Requests | Identical | Mismatch | Other |
|---|---|---|---|---|---|
| 1 | `8130e635` | 80 (conc. 2) | 75 | 0 | 5 `new_error` — pool connect timeout |
| 2 | `dfb3ccf8` | 160 (conc. 3) | 134 | 1 → **explained** | 23 `skipped_busy`; 2 HTTP 500 (old path) |
| 3 | `1a58550e` | 80 (conc. 2) | 61 | 0 | 19 `skipped_busy` |
| **Total** | | **320** | **270** | **0 unexplained** | |

**Finding 1: pool saturation (fixed in #1689).**
- Two concurrent broad-market statements (~5 s each) held both slots of the per-instance pool (max 2).
- The next four requests waited the full 3 s connect timeout.
- In canary that would have cost the user 3 s before the fallback.
- Now `runComputeOnce` throws `ComputeOnceBusy` instead of queueing:
  - while serving → immediate PostgREST fallback (`new_busy`)
  - while comparing → skip (`skipped_busy`)
- DB concurrency stays bounded.

**Finding 2: the one "mismatch" was the OLD path failing (classified in #1690).**
- The row was `served=old`, `market_total=null`, broad capability list, CONUS.
- Under load, the PostgREST total count hit the `authenticator` role's **`statement_timeout=8s`**. The old path lost its count, so the user would have seen `totalForFilters: 0`. Compute-once returned it. Pins identical.
- `isOldDegradedOnly()` classifies such a row as `old_degraded` only when the old side has a null count **and** filling exactly those nulls from compute-once makes the reads byte-identical.
- Any other difference stays a `mismatch`.
- The 2 HTTP 500s in run 2 were the old path's view query hitting the same 8 s timeout. That is existing behaviour under load, not something introduced here.

## Stage 2 — canary (`CANARY_PCT=10`, `VERIFY=1`, deploy `1a58550e`)

- 80 forced-new requests plus 160 organic requests. 0 non-200 responses out of 240.
- Served paths: **97 new**, 141 old, **2 fallback**. Organic: 18 of 160 served new, consistent with 10%.

**Correctness**
- 129 verified comparisons, **all identical**, 0 mismatches.
- 1 `old_error`: the PostgREST verification timed out. The user had already been served correctly by compute-once.

**Fallbacks**

| Cause | User wait |
|---|---|
| 1 `new_busy` | immediate, 1.0 s total |
| 1 `new_error`: broad capability list hit compute-once's own 8 s `statement_timeout` under concurrent load | ~8 s + the 10.5 s old read. **Known tail case.** |

**Served latency (P50 / P95)**

| Path | P50 | P95 |
|---|---|---|
| new, organic | 0.79 s | 3.2 s |
| new, forced | 0.59 s | 6.2 s |
| old | 0.84 s | 5.1 s |

**DB load (`pg_stat_statements` deltas, 3.9 min)**
- PostgREST recompete: 1,743 calls, 548.8 s exec (315 ms/statement).
- compute-once: 130 calls, 113.9 s exec (876 ms/request).
- In shadow run 2 the per-request DB time was ≈ **3.2 s old vs ≈ 1.0 s compute-once, about 3× less**. The old path issues 4–7 statements per request: two head counts, the page with an exact count, and the follow-on candidates plus chunks.

**Connections**
- Stable: Supavisor 3–4 idle, PostgREST 51 idle before and after.
- No pile-up. `application_name=recompete-compute-once` stays within `RECOMPETE_PG_POOL_MAX` (2) per instance.

## Stage 3 — authority (`MODE=authority`, `VERIFY=0.1`) — performance acceptance on production

Paired and interleaved, forced-old vs forced-new on the SAME deployment, full endpoint wall time.

**Gate 1 fixtures (5 runs each):**

| Fixture | Old | New | Change | Bodies identical |
|---|---|---|---|---|
| ai governance | 0.93 s | 0.35 s | −63% | 5/5 |
| cybersecurity | 1.81 s | 0.84 s | −54% | 5/5 |
| janitorial | 0.94 s | 0.61 s | −35% | 5/5 |
| software license | 5.54 s | 2.44 s | −56% | 5/5 |
| nonsense | 0.83 s | 0.41 s | −50% | 5/5 |
| broad capability list | 4.95 s | 3.36 s | −32% | 5/5 |
| NAICS 541512 | 0.79 s | 0.69 s | −13% | 5/5 |

Against the pre-Gate-1 baseline: software license **11.96 → 2.44 s**, broad list **8.71 → 3.36 s**, ai governance **2.82 → 0.35 s**.

**Canonical suite (31 fixtures × 3 runs):**
- **93/93 bodies byte-identical**, all 200.
- New is faster on 30/31. Examples:

| Fixture | Old | New |
|---|---|---|
| software licenses | 7.00 s | 2.40 s |
| agency=VA | 3.26 s | 1.65 s |
| Show me USDA opportunities | 3.81 s | 2.11 s |
| veterans affairs | 2.76 s | 1.50 s |

- The one exception is exact NAICS `541320`, 0.66 s old vs 0.72 s new. The old path is already cheap there, and compute-once pays ~3 round trips to us-west-2 for `BEGIN`/`SET`/`COMMIT`.

**Parity oracle** (`scripts/recompete-parity.ts`, re-run after authority, ~21:50Z): **✓ 48/48 byte-identical** (market IDs · total · unmapped · in-view · ordered pin rows · follow-on rows · merged pins), exit 0.

## Rollback proof (production)
1. Set `MODE=off` and redeploy (`vercel redeploy … --scope team_w3016JFXskPwzWfNUjFO8fes`).
2. Organic requests 5/5 served `x-recompete-path: old`. **Forced `new` and forced `shadow` also served `old`**, because `off` is absolute.
3. Zero log rows were written after the off deploy. The last row was 21:39:58Z, from the authority run.
4. Per-request fallback is proven in canary: the `new_busy` and `new_error` rows served `fallback` with HTTP 200 and the old body. The route test pins the fallback body as identical.
5. Restored `MODE=authority` and redeployed. Organic requests 4/4 served `new` on `1a58550e`.

**To roll back:** `vercel env rm RECOMPETE_COMPUTE_ONCE_MODE production` → `printf off | vercel env add …` → redeploy.

## Known bounds (not fixed here)
- **Broad markets (22–40k contracts) under concurrency** can exceed compute-once's 8 s statement timeout. The fallback is then correct but slow (timeout + old read). The lever is concept precomputation, which is explicitly **out of scope** here.
- **PostgREST `authenticator` `statement_timeout=8s`** makes the old path lose counts or 500 under load. That is another reason not to go back to it as the default.
- **Busy fallbacks** mean some fraction of requests is served by the old path during bursts. That is by design, and `new_busy` in the log measures it.

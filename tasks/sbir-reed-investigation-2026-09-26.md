# search_sbir — Reed Analytics failed SBIR search (evidence packet, 2026-09-26)

**Release scope: a RESULT-CLASSIFICATION and FAILURE-REPORTING repair.** It does **not**
restore an open-topic source. After it ships, `search_sbir` still cannot return a single open
SBIR/STTR topic. What changes is that it now says so, labels award history as award history, and
reports each source's failure (§6, §7).

Separate batch from #1692. PR #1708 is **in review — no merge, no deploy**. No production-data
change, refund, credit adjustment or customer message has been made. Billing items (§9) are
**proposals only**.

Legend: **REPRODUCED** = demonstrated against code + live read-only upstreams ·
**RECONSTRUCTED** = inferred from logs, with the gap stated · **CURRENT** = measured on
2026-09-26 · **HISTORICAL** = evidence about the incident dates (2026-09-16 → 09-24) ·
**UNVERIFIED** = not established.

---

## 1. Incident attribution — Session C is a CANDIDATE, not confirmed

The account was **not** inferred from the name. `mcp_call_log` stores no inputs, but
`user_search_history` (written by `recordMcpSearch` in `metered.ts`) records each MCP call's
keyword/agency/NAICS. Searching it for the TimeWeaver vocabulary finds one account with matching
`search_sbir` activity. That account is the one registered for this advocate in
`src/lib/mindy/advocate-accounts.ts`; its email is deliberately not repeated here.

**Not logged anywhere:**
- `search_sbir`'s `source` / `phase` / `limit`;
- `get_winning_playbook`'s `topic`;
- any returned payload;
- the host conversation.

Vercel runtime logs for the incident windows are past retention: `vercel logs --since
2026-09-24T01:33Z` returns HTTP 400, while a 3 h window works.

| Session | UTC window | Serving SHA (latest GitHub prod deployment before it) | SBIR calls | billed | uncharged |
|---|---|---|---|---|---|
| A | 2026-09-16 15:34:36–15:35:03 | not pinned | 16 | 6 (30 cr) | 10 |
| B | 2026-09-17 12:19:10–12:22:53 | `8cab32a2` | 8 | 7 (35 cr) | 1 |
| C | 2026-09-24 01:21:53–01:57:30 | `60b2857a` | 22 | 8 (40 cr) | 14 |

- **The partial time "around 01:30 UTC on…" has no date.** Across the account's whole call history
  (111 calls, 2026-08-22 → 09-24), only two dates have activity between 00:45 and 02:15 UTC:
  - **2026-09-24**: 22 `search_sbir`, 3 `get_winning_playbook`, 4 `get_balance`;
  - **2026-09-13**: no `search_sbir` at all (only SAM/past-contracts/forecasts tools).
- Session C is therefore the **only logged SBIR activity consistent with that time**. It is still
  a candidate: the date is missing, and a request that never completed would leave no row (§2).
  **Confirmation needs the full date/time or the conversation export.**
- The SHA pins are best estimates (GitHub deployments don't record a manual `vercel --prod`). They
  don't affect any conclusion: the SBIR code last changed in `5fc15118` (2026-07-28), both pinned
  SHAs contain it, and 0 SBIR commits follow it.

## 2. Timeout boundary

**No timeout is observed in the retained Mindy call logs.** That is the full claim.

| Layer | Evidence | Verdict |
|---|---|---|
| Mindy handler | All 46 logged SBIR calls have latency 100–536 ms; 0 `failed`, 0 null latency. | No timeout **observed in retained logs** |
| Upstreams (NIH, Supabase) | Same latencies. Before this PR the NIH fetch had **no timeout at all**. | None observed; unbounded by design (fixed, §6) |
| MCP transport (`maxDuration = 60`) | A request killed at 60 s (or dropped before completing) writes **neither** an `mcp_call_log` row **nor** a `user_search_history` row. Runtime logs are expired. | **UNVERIFIED — an unlogged timeout cannot be excluded** |
| Chat host / conversation | No host data. | **UNVERIFIED** |

Fast logged calls do **not** rule out an unlogged timeout. What the logs *do* show is a run of
calls that failed **instantly** (§4).

## 3. What the results were — CURRENT vs HISTORICAL

### 3a. CURRENT (measured 2026-09-26), REPRODUCED with the pre-fix code

- **Default `source=nih` returned AWARDS as `opportunities`**, each with an `endDate`. The only
  "these are awards" text was in `_ai_hint`, which is off by default.
- **Relevance:** `cybersecurity` → *"AmblyoGo: … Occlusion Dose Monitor"*. For every logged
  keyword, 0 returned awards have the keyword in the title.
- **Multisite corpus:** 42/42 `sbir_sttr` rows are `nih_reporter` project pages, and their
  `close_date` is the project END date.
- **`dod_sbir_topics` = 0 rows.**

### 3b. HISTORICAL (the incident dates)

These show what the sources held on 09-16 → 09-24 — not what they hold today.

| Source | Historical evidence | What it supports |
|---|---|---|
| Multisite (`aggregated_opportunities`) | Every sbir row has `created_at` 2026-06-29 → 09-08 (all before the incident) and `updated_at = created_at`. `pg_stat_user_tables`: `n_tup_upd = 0`, `n_tup_del = 0`. No code path deletes from the table. | During the incident the slice held these 42 NIH award pages (plus any deleted row the counters missed — none recorded). No open non-NIH notice is evidenced. |
| Multisite query | The select named `set_aside_type`, a column absent from the table. The code has been unchanged since `03fd544c` (#158, 2026-07-13). | **Every multisite call on the incident dates errored.** The multisite source returned nothing, whatever the table held. |
| DoD cache (`dod_sbir_topics`) | Table created 2026-07-28. `pg_stat_user_tables`: `n_tup_ins = 0`, `n_tup_del = 0`. The sync upserts only; no code path deletes. All 40 `sync-dod-sbir` runs from 09-15 → 09-24 were `success`/200 in ≤2.5 s, but their response bodies (`upserted`, `stopped`) are **not stored**. | **Strongly consistent with the cache being empty on the incident dates. Not conclusive:** the stats window's start is unknown (the counters were reset at some point — `aggregated_opportunities` shows 853 inserts against 1,584 live rows), and a manual SQL delete would leave no trace outside the counters. |
| NIH RePORTER | Live API, no snapshot of what it returned then. The re-run today is only a proxy (awards change slowly). | Award-only by construction. It could never supply an open topic on any date. |

**What can and cannot be claimed:**
- Mindy's sources offered **no evidenced open topic** on the incident dates:
  - NIH is award-only by construction;
  - multisite errored on every call;
  - the DoD cache is evidenced empty (strong, not conclusive).
- This says **nothing about whether open DoD/other SBIR topics existed in the real world** on those
  dates. That was not examined, and Mindy's empty caches are not evidence of market absence.

## 4. The failures, explained

**REPRODUCED:**
- The multisite `set_aside_type` select error (§3b).
- A comma or parenthesis in a keyword breaks the PostgREST `.or()` filter. None of the logged
  keywords contained one.

**RECONSTRUCTED:** the old code's billing outcome depends only on `source` and on whether NIH has
rows:
- `all` → uncharged iff NIH is empty;
- `multisite` → always uncharged;
- `nih` → always billed.

All 45 keyword-matched logged outcomes are consistent with this model (appendix). The
discriminating run is 2026-09-24 **01:34:10–01:34:24Z**:
- 8/8 calls came back uncharged, including 6 keywords that NIH answers today;
- only `source="multisite"` produces that;
- the tool description advertised that source as "open notices".

Caveats: `source` is not logged, and NIH is compared as of today.

**UNVERIFIED:** intermittent NIH 429/5xx. Sequential and 8-way bursts today all returned 200.
The model doesn't need it to explain any logged outcome.

## 5. Default `source: "all"`

`all` is acceptable only because award history can **never** satisfy an open-topic request:
- awards live only in `award_history`;
- `opportunities` aliases `open_topics` only;
- `coverage.open_topics_established` is false unless an open-topic source actually answered;
- awards carry `project_end_date`, never `close_date`.

Pinned by `src/mcp/tools/sbir-open-request.unit.test.ts`, which drives the **real** library
through the tool wrapper with the DoD cache unavailable and NIH returning awards (default source).
It asserts:
- `open_topics`, `opportunities` = `[]`; `open_topics_established` = false;
- the statement says "could NOT be established" and "none of them can be proposed to";
- `dod_sbir_topics` reports `unavailable`;
- every award has `status: awarded` and no `close_date`/`endDate`;
- the open side of the payload contains no award date;
- **no deadline-named key** (`close_date|endDate|deadline|response_date`) appears anywhere in the
  payload.

The same holds for explicit `source="nih"`.

## 6. What this PR changes (classification + failure reporting)

1. `open_topics` and `award_history` are separate lists, with `record_kind`/`status` on every row.
   Awards never carry `close_date`. `opportunities` is now an alias of `open_topics` only.
2. `sources[]` reports each source as `ok | empty | error | timeout | unavailable`, with upstream
   detail. `unavailable` ≠ `empty`, and a null count is `error`, never 0.
3. `coverage.statement` ships unconditionally (not behind `_ai_hint`), and `_meta` adds
   `partial`, `open_topic_count`, `award_history_count` and `open_topics_established`.
4. **NIH budget = ONE 8 s deadline for the entire operation.** A single `AbortController` is armed
   once. Its signal goes to every attempt, and every await is raced against it: headers, the
   **response-body read**, and the **backoff sleep**. A callee that ignores the signal still ends at
   the deadline. A retry (at most one, only on 429/5xx) starts only if `backoff + 500 ms` still fits
   in the *remaining* budget. The report carries `budget_ms` and `attempts`. DB reads carry a 5 s
   abort signal.
5. The multisite column is fixed (`set_aside`), and keywords are sanitized for `.or()`.
6. A word-bounded `relevance` signal (title / body / upstream_only) ranks title matches first. No
   rows are dropped.
7. The default `source` is now `all` (§5).

### Budget proof — `src/lib/sbir/search-nih-budget.unit.test.ts` (real timers, 400 ms budget; callees IGNORE the signal)

| Case | Result |
|---|---|
| Slow 429 (150 ms) + backoff (50 ms) + a retry that hangs forever | timeout at ~406 ms, attempts 2 — **not 2× the budget** |
| Headers arrive, body read never finishes | timeout at ~409 ms |
| Backoff sleep never returns | timeout at ~404 ms |
| 429 at 300 ms, backoff 150 ms: no longer fits | no retry; `error HTTP 429` at ~305 ms |
| 150 + 50 + 150 + 150 ms (each piece under budget, sum over) | timeout at ~406 ms — one clock |
| 100 ms headers + 100 ms body | `empty`, attempts 1 (inside budget) |
| Same signal across attempts | identical instance; aborted at budget end |

**Mutation-proven:**
- Leaving the body read unbounded turns 2 cases red.
- Restarting the clock per attempt (the per-attempt semantics) turns 3 cases red.
- Restored → 7/7 green.

## 7. Separate work required to restore an open-topic source (NOT in this PR)

The specialty feeds are **PARKED** (CLAUDE.md, 2026-09-13; SBIR 🔴 RED = coverage, "product
decision before implementation"). Nothing below was touched. What restoring one would take:

1. **Product decision first:** which open-topic source(s), for which agencies. DoD alone, or the
   ~11 SBIR agencies (multisite has 1 of ~11).
2. **DoD cache (`dod_sbir_topics`), diagnose before repair:**
   - Persist the sync's response (`upserted`, `stopped`, `rateLimited`) or add per-source
     advancement monitoring. Today the job is "success/200" with 0 rows ever inserted — the
     *dead operation reported as success* class.
   - Establish whether `api.www.sbir.gov` is reachable from Vercel, rate-limited, or returns a
     shape `normalizeSolicitation` drops (it skips topics without a number).
3. **A freshness/advancement oracle** that fails when an open-topic source holds 0 open rows, so
   `unavailable` can't persist silently for two months again.
4. **Multisite:** ingest real open SBIR notices, or stop presenting that source as one. Today it is
   NIH awards by construction.
5. Only then revisit billing P3 (§9) and host guidance.

## 8. Tests & gates (this head)

- `search-open-vs-award.unit.test.ts` (15) — classification, `unavailable` vs `empty`, null
  count, partial, retry once on 429 / not on 400, sanitizer, relevance.
- `search-nih-budget.unit.test.ts` (7) — the whole-operation budget (§6).
- `sbir-coverage.unit.test.ts` (5) — wrapper coverage, default source, alias, billing
  classification.
- `sbir-open-request.unit.test.ts` (2) — default-`all` open-topic request with the real library (§5).
- `scripts/verify-sbir-search.ts` — live read-only oracle; exits 1 on any source error or any
  mislabeled row.
- `tsc`, the MCP/SBIR suites, catalog drift, the silent-failure gate and the ledger audit are run
  at the frozen head. Results are in the PR.

## 9. Billing — PROPOSALS ONLY (nothing applied)

The ledger matches the call log exactly, and none of the 25 failed SBIR calls was debited.

### P1 — proposed correction for the 105 SBIR credits

- **What:** 21 `search_sbir` debits × 5 cr, 2026-09-16 → 09-24. All on the personal balance
  (`charged_pool_id` null). They bought unlabeled NIH award history for an open-topic request:
  - 0 awards had a title match;
  - 2 calls returned no rows at all (09-17 12:19:10Z, 09-24 01:22:16Z);
  - no open-topic source was functional.
- **Proposed amount:** **105 credits** (full). Alternative: 10 credits (the two empty results only).
  Recommendation: full. The unlabeled payload is a Mindy defect, not a user error.
- **Mechanism (idempotent — do NOT use `POST /api/admin/mcp-credits`, whose `grantCredits`
  is not idempotent, so a double click grants twice):**
  ```ts
  applyCreditOnce('service_correction:search_sbir:2026-09-16..24:reed', <account>, 105, 'admin_grant')
  ```
  - `mcp_apply_credit` guards on the idempotency key, so re-running is a no-op.
  - `admin_grant` renders as "Complimentary credits" in billing history.
  - `admin_grant` counts as paid standing for the extraction guard. This account already holds
    `admin_grant` and `pro_monthly` rows, so there is no side effect.
- **Pre-apply check:** the balance is 3,165 today, so the correction doesn't depend on it; the
  ledger `balance_after` will read +105.
- **Post-apply verification:** one new ledger row (+105, `admin_grant`) and a `mcp_credit_topups`
  row carrying the key; a second run returns `applied=false`.
- **Debits covered (ledger ids):** see table below.
- **Customer message:** not drafted, per instruction.

### P2 — `get_winning_playbook` ×3 at 2026-09-24 01:57: NOT established as retries → no adjustment proposed

| Call | Started (≈ logged − latency) | Finished (logged) | Status | Credits |
|---|---|---|---|---|
| 1 | 01:57:22.66 | 01:57:23.29 | success | 20 |
| 2 | 01:57:24.40 | 01:57:24.82 | success | 20 |
| 3 | 01:57:26.18 | 01:57:26.75 | success | 20 |

- **Sequential, not concurrent.** Each call began 1.1–1.4 s *after* the previous one completed
  successfully. A transport or client retry follows a failure or timeout, and there was none.
- **The recorded axis is identical** (`naics = 541512,541511` on all three), but the **required
  `topic` argument is not recorded** (`recordMcpSearch` captures keyword/query/q, not `topic`).
  Nothing logged distinguishes three different questions from one question asked three times.
- The pattern matches the host's behaviour in the same session: several successive single-topic
  calls about 1–2 s apart, as with the SBIR keywords that followed at 01:57:27–30.
- No JSON-RPC request id, `api_key_id` or payload hash is stored.

**Conclusion:** the evidence does not support calling these duplicates, so no duplicate-charge
adjustment is proposed. **Prerequisite for ever deciding this class:** record a hash of the full
args (and the JSON-RPC id) in `mcp_call_log`. That is a separate change, not in this PR.

### P3 — policy question (unchanged by this PR)

A call whose only open-topic source is `unavailable`, and which finds no awards, is
`billable_no_result` — exactly as `source="dod"` billed before. Should "the source that answers
this question cannot answer" be non-billable? That is a billing-policy decision, deliberately not
made here.

### Debits covered by P1

| ledger id | UTC | delta | balance_after |
|---|---|---|---|
| `46b1a734-7f62-4eed-8932-fad115b9be4b` | 2026-09-16T15:34:59 | -5 | 3325 |
| `ef4cfb00-9dfd-49fe-9b9c-41e52e31d86f` | 2026-09-16T15:34:59 | -5 | 3320 |
| `7c0febfb-b283-4ffe-a02f-de4901002149` | 2026-09-16T15:35:00 | -5 | 3315 |
| `729253aa-a37e-4504-9653-331999fd23aa` | 2026-09-16T15:35:00 | -5 | 3310 |
| `f55f5d89-9655-4cf5-a305-330f4f80aa5c` | 2026-09-16T15:35:00 | -5 | 3305 |
| `5e6eeb66-fc9e-4de0-8fa8-2e4c515a9d6e` | 2026-09-16T15:35:02 | -5 | 3300 |
| `224938c9-89cb-4a2e-8b47-1aadaa8d8320` | 2026-09-17T12:19:10 | -5 | 3295 |
| `29ae800f-21c3-473b-a249-38bcee6d9fbf` | 2026-09-17T12:19:12 | -5 | 3290 |
| `37a9fea4-da27-4b64-abdb-7ff1109b708a` | 2026-09-17T12:19:15 | -5 | 3285 |
| `96395a6f-0e23-4c87-ae48-f76002a80078` | 2026-09-17T12:22:45 | -5 | 3280 |
| `0b32d2d0-baa5-43e0-8188-ffeca9df0778` | 2026-09-17T12:22:47 | -5 | 3275 |
| `4fe535bc-fd9e-4e8b-9d2e-9bf69e6341df` | 2026-09-17T12:22:49 | -5 | 3270 |
| `f49c0e14-9ca2-4bff-8077-304d66ed0b75` | 2026-09-17T12:22:51 | -5 | 3265 |
| `cae746d8-06d9-4e97-a9a8-fe6fb42179b9` | 2026-09-24T01:21:53 | -5 | 3260 |
| `06c27201-4543-4c54-b867-2a6cc158907e` | 2026-09-24T01:21:55 | -5 | 3255 |
| `3e721f05-294f-42ec-a9ed-bbf3c84d42da` | 2026-09-24T01:21:57 | -5 | 3250 |
| `1f22232f-9182-467a-bf07-d753efa7d6fa` | 2026-09-24T01:22:10 | -5 | 3245 |
| `4acd6c0e-ce97-43da-a715-bbc72baa3696` | 2026-09-24T01:22:12 | -5 | 3240 |
| `96146a01-5fa3-49ef-a62d-58802b83d9ed` | 2026-09-24T01:22:13 | -5 | 3235 |
| `8ac11e6e-1477-4cc5-afaf-8f452b138763` | 2026-09-24T01:22:14 | -5 | 3230 |
| `74436893-1984-4387-b5bc-276ae2286c11` | 2026-09-24T01:22:16 | -5 | 3225 |

## 10. Other observations (not fixed)

- `sync-dod-sbir` reports success while `dod_sbir_topics` has never received an insert (§3b, §7).
- `src/app/api/sbir/route.ts:241` (in-app panel) reads `opp.set_aside_type`, which is always
  undefined. It is harmless (falls back to `'SBIR/STTR'`) and was left alone per scope.

## Appendix — SBIR calls, joined to inputs (UTC)

Observed (call log × search history; `Δ` = input-row offset):

```
2026-09-16T15:34:36.643Z  uncharged   0cr  168ms | keyword=zero trust continuous monitoring (Δ+0.02s)
2026-09-16T15:34:36.715Z  uncharged   0cr  196ms | keyword=cyber incident response (Δ+0.00s)
2026-09-16T15:34:37.125Z  uncharged   0cr  157ms | keyword=digital forensics incident reconstruction (Δ+0.02s)
2026-09-16T15:34:37.458Z  uncharged   0cr  202ms | keyword=temporal reasoning cybersecurity (Δ+0.01s)
2026-09-16T15:34:39.101Z  uncharged   0cr  142ms | keyword=cybersecurity telemetry correlation (Δ+0.18s)
2026-09-16T15:34:39.208Z  uncharged   0cr  163ms | keyword=trustworthy AI cybersecurity (Δ-0.03s)
2026-09-16T15:34:39.931Z  uncharged   0cr  118ms | keyword=security operations automation (Δ+0.00s)
2026-09-16T15:34:40.623Z  uncharged   0cr  164ms | keyword=data provenance evidence integrity (Δ-0.16s)
2026-09-16T15:34:59.568Z  uncharged   0cr  150ms | keyword=situational awareness (Δ-0.00s); keyword=telemetry (Δ+0.22s)
2026-09-16T15:34:59.611Z  success     5cr  207ms | keyword=evidence (Δ-0.02s)
2026-09-16T15:34:59.748Z  success     5cr  144ms | (no input row)
2026-09-16T15:35:00.428Z  success     5cr  168ms | keyword=provenance (Δ+0.14s)
2026-09-16T15:35:00.671Z  success     5cr  108ms | keyword=cybersecurity (Δ+0.07s); keyword=forensics (Δ+0.10s)
2026-09-16T15:35:00.952Z  success     5cr  267ms | (no input row)
2026-09-16T15:35:02.494Z  success     5cr  125ms | keyword=incident (Δ-0.51s)
2026-09-16T15:35:03.949Z  uncharged   0cr  536ms | keyword=threat hunting (Δ+0.01s)
2026-09-17T12:19:10.739Z  success     5cr  190ms | keyword=artificial intelligence cybersecurity (Δ+0.28s); agency=DOD (Δ+0.31s)
2026-09-17T12:19:13.066Z  success     5cr  134ms | keyword=AI (Δ+0.11s)
2026-09-17T12:19:15.679Z  success     5cr  208ms | keyword=cybersecurity (Δ+0.13s)
2026-09-17T12:22:45.492Z  success     5cr  198ms | keyword=trustworthy AI (Δ-0.01s)
2026-09-17T12:22:47.654Z  success     5cr  150ms | keyword=cybersecurity AI (Δ+0.09s)
2026-09-17T12:22:49.685Z  success     5cr  142ms | keyword=data provenance (Δ+0.13s)
2026-09-17T12:22:51.707Z  success     5cr  173ms | keyword=digital evidence (Δ+0.10s)
2026-09-17T12:22:53.587Z  uncharged   0cr  115ms | keyword=security telemetry incident response (Δ-0.02s)
2026-09-24T01:21:53.542Z  success     5cr  197ms | keyword=incident response (Δ+0.14s)
2026-09-24T01:21:55.350Z  success     5cr  159ms | keyword=data provenance (Δ+0.32s)
2026-09-24T01:21:56.594Z  uncharged   0cr  146ms | keyword=security telemetry (Δ+0.01s)
2026-09-24T01:21:57.912Z  success     5cr  126ms | keyword=trustworthy AI (Δ+0.13s)
2026-09-24T01:21:59.219Z  uncharged   0cr  146ms | keyword=digital forensics (Δ+0.03s)
2026-09-24T01:22:01.053Z  uncharged   0cr  509ms | keyword=cyber situational awareness (Δ+0.01s)
2026-09-24T01:22:11.021Z  success     5cr  117ms | keyword=cyber (Δ+0.12s)
2026-09-24T01:22:12.514Z  success     5cr  117ms | keyword=forensic (Δ+0.12s)
2026-09-24T01:22:13.867Z  success     5cr  114ms | keyword=provenance (Δ+0.11s)
2026-09-24T01:22:15.053Z  success     5cr  100ms | keyword=telemetry (Δ+0.12s)
2026-09-24T01:22:16.806Z  success     5cr  145ms | keyword=zero trust (Δ+0.13s)
2026-09-24T01:34:10.224Z  uncharged   0cr  331ms | keyword=cybersecurity (Δ-0.00s)
2026-09-24T01:34:14.297Z  uncharged   0cr  283ms | keyword=incident response (Δ-0.02s)
2026-09-24T01:34:17.791Z  uncharged   0cr  134ms | keyword=cyber resilience (Δ-0.01s)
2026-09-24T01:34:19.010Z  uncharged   0cr  131ms | keyword=continuous monitoring (Δ+0.01s)
2026-09-24T01:34:20.496Z  uncharged   0cr  114ms | keyword=data integrity (Δ-0.03s)
2026-09-24T01:34:22.171Z  uncharged   0cr  136ms | keyword=explainable AI (Δ-0.02s)
2026-09-24T01:34:23.431Z  uncharged   0cr  105ms | keyword=zero trust (Δ+0.00s)
2026-09-24T01:34:24.690Z  uncharged   0cr  122ms | keyword=threat hunting (Δ-0.01s)
2026-09-24T01:57:27.741Z  uncharged   0cr  155ms | keyword=knowledge data management provenance (Δ+0.00s); agency=NSF (Δ+0.01s)
2026-09-24T01:57:29.234Z  uncharged   0cr  110ms | keyword=data privacy integrity (Δ+0.00s); agency=NSF (Δ+0.01s)
2026-09-24T01:57:30.232Z  uncharged   0cr  116ms | agency=NSF (Δ-0.12s); keyword=cloud security (Δ-0.00s)
```

Reconstruction (§4): observed outcome vs the old code's outcome per `source`, using today's NIH rows:

```
2026-09-16T15:34:36.643Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | zero trust continuous monitoring
2026-09-16T15:34:36.715Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | cyber incident response
2026-09-16T15:34:37.125Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | digital forensics incident reconstruction
2026-09-16T15:34:37.458Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | temporal reasoning cybersecurity
2026-09-16T15:34:39.101Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | cybersecurity telemetry correlation
2026-09-16T15:34:39.208Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | trustworthy AI cybersecurity
2026-09-16T15:34:39.931Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | security operations automation
2026-09-16T15:34:40.623Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | data provenance evidence integrity
2026-09-16T15:34:59.568Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | situational awareness
2026-09-16T15:34:59.611Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=25 | evidence
2026-09-16T15:34:59.748Z   no keyword row
2026-09-16T15:35:00.428Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=1 | provenance
2026-09-16T15:35:00.671Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=5 | cybersecurity
2026-09-16T15:35:00.952Z   no keyword row
2026-09-16T15:35:02.494Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=12 | incident
2026-09-16T15:35:03.949Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | threat hunting
2026-09-17T12:19:10.739Z billed    | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | artificial intelligence cybersecurity agency=DOD
2026-09-17T12:19:13.066Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=25 | AI
2026-09-17T12:19:15.679Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=5 | cybersecurity
2026-09-17T12:22:45.492Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=3 | trustworthy AI
2026-09-17T12:22:47.654Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=1 | cybersecurity AI
2026-09-17T12:22:49.685Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=1 | data provenance
2026-09-17T12:22:51.707Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=25 | digital evidence
2026-09-17T12:22:53.587Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | security telemetry incident response
2026-09-24T01:21:53.542Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=2 | incident response
2026-09-24T01:21:55.350Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=1 | data provenance
2026-09-24T01:21:56.594Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | security telemetry
2026-09-24T01:21:57.912Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=3 | trustworthy AI
2026-09-24T01:21:59.219Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | digital forensics
2026-09-24T01:22:01.053Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | cyber situational awareness
2026-09-24T01:22:11.021Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=6 | cyber
2026-09-24T01:22:12.514Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=4 | forensic
2026-09-24T01:22:13.867Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=1 | provenance
2026-09-24T01:22:15.053Z billed    | all→billed    nih→billed    multisite→uncharged | nihRows=6 | telemetry
2026-09-24T01:22:16.806Z billed    | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | zero trust
2026-09-24T01:34:10.224Z uncharged | all→billed    nih→billed    multisite→uncharged | nihRows=5 | cybersecurity
2026-09-24T01:34:14.297Z uncharged | all→billed    nih→billed    multisite→uncharged | nihRows=2 | incident response
2026-09-24T01:34:17.791Z uncharged | all→billed    nih→billed    multisite→uncharged | nihRows=1 | cyber resilience
2026-09-24T01:34:19.010Z uncharged | all→billed    nih→billed    multisite→uncharged | nihRows=25 | continuous monitoring
2026-09-24T01:34:20.496Z uncharged | all→billed    nih→billed    multisite→uncharged | nihRows=17 | data integrity
2026-09-24T01:34:22.171Z uncharged | all→billed    nih→billed    multisite→uncharged | nihRows=7 | explainable AI
2026-09-24T01:34:23.431Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | zero trust
2026-09-24T01:34:24.690Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | threat hunting
2026-09-24T01:57:27.741Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | knowledge data management provenance agency=NSF
2026-09-24T01:57:29.234Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | data privacy integrity agency=NSF
2026-09-24T01:57:30.232Z uncharged | all→uncharged nih→billed    multisite→uncharged | nihRows=0 | cloud security agency=NSF
```

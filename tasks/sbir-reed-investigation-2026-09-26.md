# search_sbir — Reed Analytics failed SBIR search (evidence packet, 2026-09-26)

Separate batch from #1692. Read-only investigation + one code PR. **No merge, deploy,
production-data change, refund or customer message.**

Requested outcome (per the report): a low-credit shortlist of **five relevant OPEN SBIR/STTR
topics** for TimeWeaver — cybersecurity, AI, data provenance, zero trust, cross-domain security
analytics.

Legend: **REPRODUCED** = demonstrated today against code + live read-only upstreams ·
**RECONSTRUCTED** = inferred from logs with a stated gap · **UNVERIFIED** = not established.

---

## 1. Locating the request

The account was **not** inferred from the name. `mcp_call_log` has no inputs, but
`user_search_history` (written by `recordMcpSearch` in `metered.ts`) records each MCP call's
`keyword`/`agency`. Searching it for the TimeWeaver vocabulary finds exactly one account with
`search_sbir` activity on these terms. That account is the one registered for this advocate in
`src/lib/mindy/advocate-accounts.ts`. Its email is deliberately not repeated here.

⚠️ **Not logged anywhere:** `source`, `phase`, `limit` (recordMcpSearch keeps keyword/agency
only), the returned payload, and the host conversation. Vercel runtime logs for these windows are
past retention (`vercel logs --since 2026-09-24T01:33Z` → HTTP 400; a 3 h window works).

Three sessions match the vocabulary. **Which one the screenshot shows cannot be established
without the approximate time or the conversation export.** Session C is the strongest candidate
(an 8-call run that failed in full; see §4).

| Session | UTC window | Serving SHA (latest GitHub prod deployment before the window) | SBIR calls | billed | uncharged |
|---|---|---|---|---|---|
| A | 2026-09-16 15:34:36–15:35:03 | not pinned (older than the deployment pages read) | 16 | 6 (30 cr) | 10 |
| B | 2026-09-17 12:19:10–12:22:53 | `8cab32a2` (deployed 10:46:48Z, status success) | 8 | 7 (35 cr) | 1 |
| C | 2026-09-24 01:21:53–01:57:30 | `60b2857a` (deployed 00:42:18Z) | 22 | 8 (40 cr) | 14 |

The SHA pins are a best estimate: GitHub deployments do not record a manual `vercel --prod`.
**This does not affect any conclusion.** The SBIR code last changed in `5fc15118` (2026-07-28).
Both pinned SHAs contain it, with 0 SBIR commits after it, so every session ran identical
`search_sbir` code.

Per-call rows are in the appendix (UTC, status, credits, latency, keyword/agency). The inputs are
joined to calls by nearest timestamp; the offset is ≤0.5 s, and two calls in session A have no
input row.

## 2. Timeout boundary

| Layer | Evidence | Verdict |
|---|---|---|
| Mindy handler (`runMeteredTool` → `searchSbir`) | 46/46 SBIR calls logged with latency 100–536 ms. 0 `failed`, 0 null latency. | **No handler timeout** (logged calls) |
| Upstreams (NIH RePORTER, Supabase) | Same latencies. The NIH fetch had **no timeout at all** before this PR. | No upstream timeout recorded; unbounded by design (**defect, fixed**) |
| MCP transport (`maxDuration = 60`) | A request killed at 60 s writes **neither** an `mcp_call_log` row **nor** a `user_search_history` row, and runtime logs are expired. | **UNVERIFIED** — cannot be excluded; would be invisible |
| Chat host / conversation | No host data available. | **UNVERIFIED** — the most likely home of a "timeout" message, given every logged call returned in <0.6 s |

**Conclusion:** no individual Mindy tool call timed out. If the host reported a timeout, it was
either conversation-level or a request that died before any logging, and neither is observable
now. What the logs *do* show is a run of calls that **failed instantly** (§4).

## 3. What the results actually were

**REPRODUCED** against live NIH RePORTER + the production DB (read-only), running the pre-fix
code (`git show origin/main:src/lib/sbir/search.ts`):

- **Default `source` was `nih`, which returns AWARDED projects, in a field named
  `opportunities`, with an `endDate`.** The only statement that these are awards lived in
  `_ai_hint`, which is **OFF by default**, so the host received funded projects with no in-band
  label. A 2027 `endDate` reads as a deadline.
- **Relevance:** `cybersecurity` → *"AmblyoGo: a 'Smart' Easy-to-use Occlusion Dose Monitor"*
  (the word appears in the abstract). Every keyword Louis used returned biomedical projects:
  **0 of the returned awards match the keyword in the title.** NIH RePORTER is an NIH-only
  award index and cannot answer a cyber/zero-trust question.
- **"multisite" is not open notices.** The tool description said `multisite` = "open notices".
  The `aggregated_opportunities` `sbir_sttr` slice is **42/42 `nih_reporter` rows**, each a
  `reporter.nih.gov/project-details/…` page. Their `close_date` is the **project end date**
  (2027-05-31), which the tool emitted as `endDate`.
- **The DoD open-topic cache is empty.** `dod_sbir_topics` = **0 rows**. `sync-dod-sbir` runs every
  6 h with `status=success`, HTTP 200, ~110 ms, and writes nothing (the *dead operation reported
  as success* class). `source="dod"` therefore could never return a topic.

**Topic status and deadlines:** no source reachable by `search_sbir` held a single open SBIR/STTR
topic on any of these dates. No open topic could have been verified, and none was returned. Any
"open topic" the host presented would have been an award, mislabeled either by the host or by the
unlabeled payload.

## 4. The failures, explained

**REPRODUCED:** the multisite query selected **`set_aside_type`, a column that does not exist**
on `aggregated_opportunities` (the real column is `set_aside`). Every multisite read has errored
since `03fd544c` (#158, 2026-07-13): *"column aggregated_opportunities.set_aside_type does not
exist"*. The tool caught the error as `degraded` and returned an empty list.

**RECONSTRUCTED:** under the old code, the billing outcome for a keyword depends only on the
`source` chosen and on whether NIH has rows:
- `source=all` → uncharged iff NIH is empty;
- `source=multisite` → always uncharged;
- `source=nih` → always billed.

Re-running every logged keyword against NIH today, **all 45 keyword-matched outcomes are
consistent with exactly this model**. The discriminating case is **session C, 01:34:10–01:34:24Z**:
8 consecutive calls, all `uncharged`, including 6 whose keywords NIH answers today
(`cybersecurity` 5 rows, `continuous monitoring` 25, `data integrity` 17, …). Only
`source="multisite"` produces that, and the description advertised that source as the open
notices. Caveat: `source` is not logged, and NIH's award set may have shifted slightly since.

**REPRODUCED, not shown to be Louis's cause:** a keyword containing a comma or parenthesis breaks
the PostgREST `.or()` logic tree (`"cybersecurity, AI"` → *failed to parse logic tree*), and that
source silently returns nothing. None of the logged keywords contained one.

**UNVERIFIED:** an intermittent NIH 429/5xx. Not reproduced: sequential and 8-way parallel
bursts all returned 200 in <500 ms. Not needed to explain any logged outcome.

## 5. Fix (this PR)

`src/lib/sbir/search.ts`, `src/mcp/tools/sbir.ts`, and the descriptions in `tool-registry.ts` +
`server.ts`:

1. **Two lists.** `open_topics` (close date ≥ today; DoD cache, or a non-NIH multisite row) and
   `award_history` (NIH, and every `nih_reporter` multisite row). Every row carries `record_kind`
   and `status` (`open`/`future`/`awarded`). An award never carries `close_date`; its dates are
   `project_start_date`/`project_end_date`. `opportunities` is kept as an alias of `open_topics`
   **only**, so it no longer carries awards.
2. **Per-source status in band:** `sources[]` = `ok | empty | error | timeout | unavailable`,
   with the upstream detail (e.g. `HTTP 429`, the DB error text). `unavailable` ≠ `empty`: an
   empty DoD cache reports *"open DoD topics cannot be established"*, never "no matches". A null
   count is `error` (unknown), never 0.
3. **`coverage.statement` ships unconditionally** (not behind `_ai_hint`). Example: *"Open
   SBIR/STTR topics could NOT be established by this search — do not report that none exist.
   award_history lists funded projects only."* `_meta` adds `partial`, `open_topic_count`,
   `award_history_count` and `open_topics_established`.
4. **Bounded:** NIH gets an 8 s deadline via `AbortSignal.timeout` and **one** retry, only on
   429/5xx, only inside the same budget. DB reads get a 5 s abort signal. A slow source becomes
   `timeout` + `partial`; the sources that answered still ship.
5. **Fixed the missing column** (`set_aside_type` → `set_aside`) and **sanitized the keyword**
   for PostgREST `.or()` (`,()%*\\"` → space).
6. **Relevance signal:** `relevance` = `title | body | upstream_only | no_keyword`, word-bounded
   (`cyber` ≠ `cyberbullying`). Title matches rank first. Nothing is dropped (no self-filter).
7. **Default `source` = `all`** (was `nih`): one call answers both questions, each labeled.

**Not done (feeds are PARKED, 2026-09-13):** no SBIR.gov wiring, no DoD cache repair, no
coverage expansion. After this PR the honest answer to Louis's question is still *"open topics
could not be established"*. The PR makes the tool say that instead of implying otherwise.

## 6. Tests

- `src/lib/sbir/search-open-vs-award.unit.test.ts` (15, hermetic, injected fetch/DB):
  - NIH and multisite-NIH rows land in award history with no deadline;
  - a non-NIH open notice is an open topic, and a closed one is omitted and counted;
  - an empty DoD cache is `unavailable`, and a null count is `error`;
  - a hung NIH times out inside its budget (<1.5 s at a 150 ms budget);
  - partial: NIH times out while DoD answers;
  - 429→200 retries once; 429×2 → `error` "HTTP 429"; a 400 is not retried;
  - every request carries a signal;
  - `.or()` sanitizer; word-bounded relevance; title-first ranking.
- `src/mcp/tools/sbir-coverage.unit.test.ts` (5):
  - awards-only → `opportunities` is empty and the coverage statement says "could NOT be established";
  - the default source is `all`;
  - the alias never carries an award;
  - billing: all-failed → not billable; partial-with-rows → billable (current rule, pinned).
- `scripts/verify-sbir-search.ts`: a **live, read-only oracle** that exits 1 on any source error or
  any mislabeled row. Passes on this branch with the multisite source `ok`/`empty`; before the fix
  it was `error` on every keyword.
- `tsc` clean · `vitest src/lib/mcp src/mcp src/lib/sbir` 629 passed · catalog drift OK
  (64 tools) · silent-failure gate OK.

## 7. Credit audit (read-only — no correction applied)

`mcp_credit_ledger` matches `mcp_call_log` exactly: 21 SBIR debits × 5 cr = 105 cr, plus 3
`get_winning_playbook` × 20 cr = 60 cr. **None of the 25 failed (`uncharged`) SBIR calls was
debited:** the degraded+empty rule (DEFECT-7) worked. The host's retries after the failed run
cost 0.

**Proposals, for a separate decision (not implemented):**

- **P1.** The 105 SBIR credits bought biomedical award history presented without a label, for a
  question about open topics. 0 of those awards had a title match, and 2 billed calls
  (`artificial intelligence cybersecurity`+DOD at 09-17 12:19:10Z, `zero trust` at 09-24
  01:22:16Z) returned **no rows at all**: a genuine-empty result, billed under the current rule.
  Candidate goodwill credit: 105 cr, or 10 cr for the two empties only. Eric's call.
- **P2.** `get_winning_playbook` was called **3× with identical input** (`naics=541512,541511`)
  within 3.5 s at 01:57:23–26Z, billed 20 cr each (60 cr). This is a host fan-out duplicate.
  Consider same-input idempotency (e.g. no second charge for the same tool+args+account within N
  seconds). Out of scope for this PR.
- **P3.** After this PR, `unavailable` does not set `degraded`. A call whose only open-topic source
  is unavailable, and which finds no awards, is therefore still `billable_no_result`, exactly as
  `source=dod` billed before. Decide whether "the source that answers your question cannot
  answer" should be non-billable. That is a billing-policy change, deliberately not made here.

## 8. Other observations (not fixed)

- `sync-dod-sbir` reports success while `dod_sbir_topics` stays at 0 rows. This is the parked
  SBIR 🔴 RED item; it now surfaces in band as `unavailable`.
- `src/app/api/sbir/route.ts:241` also reads `opp.set_aside_type` (the in-app panel), which is
  always undefined. Harmless (it falls back to `'SBIR/STTR'`). Left alone per scope.

## 9. Needed to close identification

The approximate time of the screenshot (or the conversation export). That pins which session
(A/B/C) it shows and whether the host's "timeout" wording came from the host.

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

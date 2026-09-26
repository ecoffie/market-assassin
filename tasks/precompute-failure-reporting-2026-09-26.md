# precompute-briefings — report failure when every generation attempt fails (2026-09-26)

**Scope:** reporting only. The route now tells the truth about a run in which nothing was generated.
**Out of scope — and deliberately not touched:**
- the LLM model configuration (llm-router model names, env vars, providers). Repairing it would
  reactivate generation;
- the weekly and pursuit precompute routes (see follow-ups);
- #1710 (SBIR retirement) and the NIH classification PR.

No merge, deploy, production-config change or production write.

## Measured production state (read-only)

- **`briefing_precompute_runs` (daily):** every run from **2026-06-30 → 2026-09-26 (88 consecutive
  days)** recorded `templates_generated = 0`, `templates_failed = 2` and `completed_at = null`. The last
  run that generated anything was 2026-06-29 (3 templates). The first zero day's error, unchanged since:
  `All LLM providers failed for daily: openai/claude-sonnet-4-20250514: OpenAI 404 … model_not_found |
  groq/llama-3.3-70b-versatile: Groq 404 … | anthropic/claude-3-5-haiku-latest: Anthropic 404 …`.
- **`cron_job_runs` (precompute-briefings, since 2026-06-30):** `success/200` × 86, `dispatched/null` × 2.
  **Zero failures recorded.**
- **`tool_errors`:** nothing for these runs. Per-profile failures were only `console.error`ed.
- **`llm_usage_log`** logs only successful calls, so it cannot show the failed attempts.

This is the *dead operation reported as success* class: the job was registered, enabled and firing
on time, and it produced nothing for 88 days while every monitor read green.

## Why the dispatcher never saw it

`/api/cron/dispatch` stores `status='error'` in `cron_job_runs` **only** when the route returns
non-2xx (or HTML, or a thrown fetch). The route always answered `200 { success: true }` from its
normal path. Only an exception outside the per-profile `try` produced a 500.

## Semantics chosen (`src/lib/briefings/precompute-outcome.ts`)

Per invocation (the self-chain consists of several invocations):

| verdict | condition | HTTP | self-chain |
|---|---|---|---|
| `nothing_to_do` | no profile needs a template | 200 (unchanged early return) | — |
| `deferred` | work exists but none was started (time budget spent before the first attempt) | 200 | allowed |
| `ok` | every started attempt produced a stored template | 200 | allowed |
| `partial` | ≥1 succeeded and ≥1 failed | 200, `partial: true`, counts + errors | allowed (progress is being made) |
| `all_failed` | ≥1 attempt started and **none** succeeded | **502**, `success: false` | **stopped** |

- **Body:** `verdict`, `attempted`, `succeeded`, `failed`, `chained`, `errors` (first 5, each
  ≤400 chars — the provider error text), plus the existing fields.
- **`briefing_precompute_runs`:** `error_messages[0]` is
  `VERDICT <verdict>: attempted=N succeeded=N failed=N`. `completed_at` is set when the day's run
  **ended**: either every template exists, or the chain stopped because all attempts failed. Nothing
  else reads this table (grep), so the semantic change is safe.
- **`all_failed`** writes one `tool_errors` row (`briefings`, `api_error`) naming the first
  provider error.
- **Partial is 200** because the job produced part of its intended effect (templates were stored).
  A partial failure is surfaced in the body and the runs table, not by failing the cron.

## Retry / storm analysis

- **Dispatcher.** A non-2xx sets `cron_job_runs.status='error'` and releases the lock. It does
  **not** retry, and the missed-run catch-up cannot fire either, because `last_run_at` is stamped
  when the job fires. **Effect: one `error` row per scheduled run, no storm.**
- **The route's own self-chain was the storm.** When attempts fail fast (~1.5 s each plus the 1 s
  delay), the 4 s start budget trips after about 2 attempts. That makes `stoppedEarly = true`, and
  `remaining` never shrinks because nothing succeeds, so the route re-fired itself
  (`?chain=N`, cap `profiles + 5` ≈ 184) with every link repeating the failing provider calls.
  - This is consistent with the measured `templates_failed = 2`, `total_duration_ms ≈ 5.6 s`: the
    row is overwritten by each link.
  - **The chain length is inferred from code, not measured**, because chain links do not write to
    `cron_job_runs`.
  - **Fix:** an `all_failed` invocation never chains.
- **Watchdog (`dispatcher-watchdog`).** It reads `cron_job_runs` and sends an ops alert when a job
  has failed with no success since. **Once this ships, and until the model configuration is
  repaired, precompute-briefings will alert ops.** That is the point, not noise.

## Tests (`src/app/api/cron/precompute-briefings/precompute-outcome.unit.test.ts`, 7)

These drive the **real route handler**. Only Supabase, the generator, `tool_errors` and `fetch` are
faked; fake timers run the real 1 s delay and 4 s budget.

- **All fail** (the production provider-404 text): → **502**, `success:false`, `verdict:'all_failed'`,
  `attempted == failed > 0`, `succeeded 0`, error text contains `model_not_found`, **no chain
  fetch**, one `tool_errors` call, runs row `completed_at` set, and `VERDICT all_failed …` first.
- **All succeed:** → 200, `verdict:'ok'`, and it **still chains** while work remains.
- **Partial:** → 200, `partial:true`, 3/2/1 counts, 1 error, no `tool_errors`.
- **Nothing to do:** → 200, the generator is never called.
- **Verdict table, chain rule, error bounding** (pure).

**Mutation-proven:**
- Returning 200 always → the all-fail test goes red.
- Allowing a chain after `all_failed` → 2 tests go red.
- Restored → 7/7 green.

## Follow-ups (not in this PR)

1. **Model configuration repair is separate.** It would reactivate generation.
   - The generator's multisite fetch excludes the retired `sbir_sttr` slice **only once #1710 merges**.
   - NIH RePORTER `grant` rows (funded projects) would still be fed to the LLM as "R&D opportunities"
     until the separate **NIH award-history labelling PR** lands.
   - Sequence those before (or with) the repair.
2. **`precompute-weekly-briefings` and `precompute-pursuit-briefs` have the same reporting shape**
   (`success: true` regardless of per-template failures). Both currently produce templates (weekly
   through 2026-09-28, pursuit through 2026-09-26), so the bug is latent there. The same helper
   applies in a few lines each.

# Ask Mindy B2 — release candidate and go/no-go evidence (2026-11-14)

PR #2053 · branch `fix/ask-mindy-b2` · based on main `7f3a14ac9` (includes #2049).
**Status: staging acceptance run (§8) — terra/luna/gpt-4o/gpt-4o-mini PASS, Groq fallback FAIL (plan limit). Still NO-GO until Eric decides the models (§2, §8), approves the merge, and production is re-verified.**
No production deploy, merge, model switch, migration or flag change has been made.

## 1. Production fallback model and its actual failure mode (verified, not assumed)

| Fact | Evidence |
|---|---|
| Production answer chain on main = `gpt-4o` (code default) → Groq `llama-3.1-8b-instant` | `vercel env ls production`: no `CHAT_OPENAI_MODEL`, no `CHAT_PLANNER_FALLBACKS`, no `CHAT_ANSWER_FALLBACKS`; route constant `GROQ_MODEL` |
| Groq **shut down** `llama-3.1-8b-instant` (and `llama-3.3-70b-versatile`) on **2026-08-16** | console.groq.com/docs/deprecations (replacement `openai/gpt-oss-20b` / `-120b`) |
| **Incident A** 2026-11-14 20:08:57 UTC: answer step on `gpt-4o-mini` (over-budget user) → HTTP 400 *"maximum context length is 128000 tokens … your messages resulted in 128779 tokens"* → fell back to the retired Groq model | Vercel production log `[ToolError] ask_mindy/api_error: answer_fallback` |
| **Incident B** 2026-11-14 03:23:35 UTC: planner `gpt-4o` → HTTP 429 `insufficient_quota` *"You have no credits remaining"* | Vercel production log `[ToolError] ask_mindy/ai_rate_limit: planner_failure` |
| On main, a failed fallback streams `AI ${status}: ${body}` to the customer | `route.ts` (main) answer-failure branch |

Consequences: (A) shows the overflow is real and that a same-window fallback cannot fix it; (B) shows the
most recent outage was account-wide, so **any OpenAI-only fallback (gpt-4o-mini, gpt-6-luna) fails with the primary**.
Vercel log retention covered only ~1 day; the full history is in `tool_errors` (needs DB access — not on this machine).

## 2. Models: deprecation, availability, proposal

OpenAI deprecations page (fetched 2026-11-14): `gpt-4o-2024-08-06`, `gpt-4o-2024-11-20`, `gpt-4o-mini-2024-07-18`
(and gpt-4.1 / 4.1-mini) — notice Oct 14 2026, **shutdown Jan 14 2027**, replacement `gpt-6-luna`.
The page does not list the floating aliases, but `gpt-4o`/`gpt-4o-mini` resolve to those snapshots, so
**the current primary is also on a 2-month clock** — not only the fallback.

| Role | Proposal | Model ID | Tools on Chat Completions | $/1M in / out | Context | Status of evidence |
|---|---|---|---|---|---|---|
| Primary (migrate before Jan 14 2027) | GPT-6.1 Terra | `gpt-6.1-terra` | per OpenAI GPT-6 docs: needs `reasoning_effort:'none'` (implemented in `openAiChatParams`) | 1 / 5 (vs gpt-4o 2.5 / 10) | 1.05M | **live quality comparison pending (§7)** |
| Same-provider fallback (model error, 400) | GPT-6 Luna | `gpt-6-luna` | supported only with `reasoning_effort:'none'` (OpenAI model page) | 0.10 / 0.50 | 1.05M | live test pending |
| Cross-provider fallback (account/quota outage, Incident B) | GPT-OSS 120B on Groq | `openai/gpt-oss-120b` | tool use listed (Groq model page); answer step needs no tools | 0.15 / 0.60 | 131K | live test pending; Groq already on the private-data approved list |
| Interim (until the above pass) | GPT-4o mini | `gpt-4o-mini` | tested in production today | 0.15 / 0.60 | 128K | works until Jan 14 2027; does **not** cover Incident B |

Configuration only (no code change needed to select these): `CHAT_OPENAI_MODEL`, `CHAT_ANSWER_FALLBACKS`
(e.g. `openai:gpt-6-luna,groq:openai/gpt-oss-120b`), `CHAT_PLANNER_FALLBACKS`. Planner fallbacks must be on
`TOOL_COMPATIBLE_PLANNERS`; GPT-6 models are deliberately **not** added until the live run passes.
Prices: OpenAI models page and Groq model page, 2026-11-14 — re-check before committing spend.

## 3. Whole-request token budget — DONE (unit + route tests, mutation-proven)

`src/lib/chat/token-budget.ts`: estimate (3 chars/token, conservative) over system + history + record list +
tool calls + tool results (+ tool catalog for the planner) vs `min(context − output − 2,000, 100,000)`.
Shrink: oldest history → re-bound tools from full originals → model copy of the record list.
Unfittable → never sent, fixed customer message `request_too_large`. Disabling the guard fails the route test.

## 4. Original oversized security-guard question — NOT YET REPRODUCED LIVE

Exact original wording is in production chat logs (DB access needed). Offline: the tool guard removes
`get_expiring_contracts` for open-opportunity questions (unit + route tests; mutation-proven) and a 1MB+ result is
bounded to ≤60K chars with a shown-of-total report. Live reproduction is question 1–2 of §7.

## 5. #2049 integration — DONE (route tests)

Fallback-served card turn → charged once · all models fail → fixed message, no charge, turn failed ·
thrown stream → fixed message, no charge, turn failed · retry → charged once · replay → free, no model call.

## 6. Release-hardening ports — DONE (re-implemented on main, not cherry-picked)

- Code disclosure: only for strict-filter tools, from the tool's **reported** `_meta.applied_filters.naics` in a
  successful result; never for keyword tools, failed calls or codes the customer typed.
- Defense ~90-day lag: emitted by the tool with an `evidence` field — buying offices: a Defense office in the
  returned rows; vehicle mix: only an explicit Defense agency filter (no agency breakdown = no evidence).
  Known bound: an unfiltered vehicle-mix total gets no Defense caveat.

## 7. Live staging acceptance — authenticated procedure (ready; needs a person to sign in)

**Automated (preferred):** `scripts/ask-mindy-b2-browser-acceptance.mjs`
```
node scripts/ask-mindy-b2-browser-acceptance.mjs \
  --base https://market-assassin-git-fix-ask-mindy-b2-eric-coffies-projects.vercel.app \
  --expect-email <synthetic Pro test account> --budget-usd 5
```
1. Opens a visible Chrome-for-Testing window with a throwaway profile at `<preview>/app`.
2. A person signs in with the synthetic Pro account through the normal Mindy login — or `--credentials-file <600 JSON>`
   types the email + password into that same normal form, submitted once. If the login answers `mfaRequired`, the run
   stops at once (no retry, no code read or entered). The password is never printed, logged or written.
3. The script checks inside the page that the session is `--expect-email`, and refuses to run otherwise.
4. All 8 questions run from inside the page with the page's own session, under 4 configurations selected by the
   preview-only header `x-ask-mindy-staging-config` (`current`, `terra`, `fallback-luna`, `fallback-groq`;
   `src/lib/chat/staging-model-config.ts`, ignored unless tracing is on, so never on production).
5. Outputs per turn: tools, result sizes, notices (bounding, budget, fallback), answer model, latency, cost from
   trace usage, and credit events. Also reports the credit balance before and after. The throwaway profile is deleted.
   The token never leaves the browser.

**Manual fallback (no automation):** sign in on the preview alias in any browser, open Ask Mindy, and ask the 8
questions in `scripts/ask-mindy-b2-acceptance.mjs` (`QUESTIONS`). For each, record: does the answer cite records
shown above it; was an expiring-contracts list shown for an *open* question (fail); any raw provider text (fail);
time to first token; credit balance before/after on `/mcp/account`. The manual path cannot select model configurations
or report token cost.

Prerequisites from Eric: an authorized synthetic Pro test account, and its sign-in done by a person on the preview.

## 8. Live staging acceptance — RESULTS (2026-11-15, preview `b065f65f1` / `16bcc9ddf`)

Run through the authenticated browser runner with a synthetic Pro test account: normal sign-in form, one attempt,
no second factor requested. 8 questions per configuration. Answer models were selected per request by the preview-only
config header. In the forced-failure configs the answer primary failed for real (`404 model_not_found`) and the real
fallback chain answered.

| Config | Planner → answer | Auto pass | Spend | Avg total | First token | Review |
|---|---|---|---|---|---|---|
| `current` | gpt-4o → gpt-4o | 8/8 | $0.566 | 5.2 s | 2.3–6.2 s | grounded; labels pre-sol/sources-sought as "opportunities"; outdated "DUNS" advice |
| `terra` | terra → terra | 8/8 | $0.242 | 4.8 s | 2.6–6.1 s | best: separates bid-ready from earlier-stage notices; honest "no match" answers |
| `fallback-luna` | terra → luna (fallback) | 8/8 | $0.162 | 4.3 s | 2.7–4.0 s | ≈ terra |
| `fallback-mini` | gpt-4o → gpt-4o-mini (fallback) | 8/8 | $0.393 | 5.7 s | 2.2–3.6 s | **1 relevance fail on review**: presented unrelated Florida notices as security-guard work; weak on the nonsense query |
| `fallback-groq` | terra → gpt-oss-120b (fallback) | **3/8** | $0.060 | 3.0 s | — | 5 data-heavy turns failed; Groq org limit (below) |

Total spend ≈ **$1.42** of the $5 cap. Credit balance unchanged (100 → 100), with no `credits` events: Pro chat is not charged.

**Groq root cause (exact provider error):** `413 rate_limit_exceeded` (type `tokens`): *Request too large for model
openai/gpt-oss-120b … service tier on_demand on tokens per minute (TPM): Limit 8000.* Data-heavy answer requests are
20–23K tokens, and back-to-back small turns exhaust the minute's budget too. This is a plan limit, not a budget bug.
The per-target budget already uses the fallback model's context window, and no request budget can exceed a per-minute
cap. Every failed turn showed the fixed customer message with no provider text.

**Guards observed live:**
- Tool guard: every open-opportunity question got `tool_not_offered:get_expiring_contracts`, and no open question showed an expiring list.
- Bounding: tool results of 366K / 300K / 65K chars were bounded to 55K / 51K / 35K.
- Budget: no `request_too_large`.
- Code disclosure: shown only for inferred codes.
- Invented filter: a planner-invented `state=VA` was removed (`unstated_filter_removed`).

**Preview-only diagnostics added:** failed answer turns now emit `trace_usage.answer_attempts` (provider, model, status,
machine error code; never provider text). Production emits nothing.

**Recommendation (decisions are Eric's):**
- Long-term: `CHAT_OPENAI_MODEL=gpt-6.1-terra` with `CHAT_ANSWER_FALLBACKS=openai:gpt-6-luna`. This is a configuration change only.
- Interim: gpt-4o-mini works mechanically as the code-default fallback, but it is the weakest on relevance.
- Cross-provider fallback: Groq is **not viable** on the on-demand tier. Either upgrade Groq to Dev tier and re-run
  `fallback-groq` only, or accept that an account-wide OpenAI outage (Incident B) shows the fixed error message.

## 9. Controlled release plan (prepared 2026-11-15; nothing executed)

### 9.1 Model verification on the PRODUCTION OpenAI org
- I queried the Production `OPENAI_API_KEY` directly; the key was never printed and the env file was shredded. The org is `gcg-xxfrzf`, the same org the staging runs used.
- `GET /v1/models/gpt-6.1-terra`: 200, created 2026-10-13. `GET /v1/models/gpt-6-luna`: 200, created 2026-09-14.
- No dated snapshots exist for either model; only the aliases are listed. A model change by OpenAI would therefore happen under the same ID. Re-check the deprecations page before each release.
- Deprecations page (fetched 2026-11-15): neither model is deprecated. Both appear only as replacement targets.
- `gpt-4o` / `gpt-4o-mini` (snapshots `-2024-08-06`, `-2024-11-20`, `-2024-07-18`) shut down **2027-01-14**.

### 9.2 Route compatibility
- **terra as planner:** the `terra` and `fallback-*` staging configs used terra as the tool planner on every turn (32 turns). Requests go through `openAiChatParams`: `reasoning_effort:'none'` plus `max_completion_tokens`, no `temperature` or `max_tokens`. A route test asserts this.
- **If the terra planner fails and `CHAT_PLANNER_FALLBACKS` is unset:** the chain is terra only. The turn continues with no live data, shows the `tools_unavailable` notice, the answer step still runs (terra, then luna), and the turn is not billable.
- **Planner fallback recommendation:** set `CHAT_PLANNER_FALLBACKS=openai:gpt-4o`. It is already in `TOOL_COMPATIBLE_PLANNERS`, so this is a configuration change only.
  - `gpt-6-luna` is NOT in `TOOL_COMPATIBLE_PLANNERS`, and luna has not been tested as a planner through the route. Add it with a route test, then switch the planner fallback to it before 2027-01-14.
  - Same-provider caveat: no planner fallback survives an OpenAI account-wide outage (Incident B). Groq is not being upgraded.

### 9.3 Over-budget users
Over-budget users plan and answer on `LLM_OPENAI_MODEL || gpt-4o-mini`. `LLM_OPENAI_MODEL` is not set in Production, so they use `gpt-4o-mini`. This release does not change it.
- **After the release env change:** an over-budget user plans on gpt-4o-mini and answers on gpt-4o-mini, falling back to gpt-6-luna (`CHAT_ANSWER_FALLBACKS` applies to them too). A route test covers this.
- **Incident A guard (route test, mutation-proven):** a request that cannot fit gpt-4o-mini's 128K window is never sent. The customer gets the fixed `request_too_large` message.
  - With the whole-request guard loosened, gpt-4o-mini is called and the test fails.
  - A 4.6M-char tool result is bounded below the budget before sending.
- **Preview-only config `over-budget-terra`:** reproduces this path live without writing a budget record. It is ignored on production, which a test confirms. A live run needs a staging account (the grant was removed).
- **Quality:** gpt-4o-mini as answer model passed 8/8 automatic checks in `fallback-mini`, but was the weakest at relevance (§8).
- **2027-01-14 risk:** over-budget users depend on the gpt-4o-mini alias, which resolves to a snapshot that shuts down then. Before then, Eric should set `LLM_OPENAI_MODEL=gpt-6-luna` (planner and answer). That needs a luna planner route test first, and this variable is shared with other tools.

### 9.4 Cost tracking fix shipped in this PR (release blocker found during prep)
`src/lib/llm/usage-cost.ts` had no GPT-6 prices. Every terra or luna call would have been logged at **$0**, which silently disables the per-user $15/month budget cap and makes the cost dashboard show chat as free.
- Added: astra 10/50, sol 2/10, terra 1/5, luna 0.10/0.50, gpt-oss-120b 0.15/0.60 (USD per 1M tokens).
- Unit tests check every routable model is priced.
- This is internal LLM cost telemetry, not customer pricing.

### 9.5 Env changes — **Production only**
Set each value with `printf` (no trailing newline): `printf 'gpt-6.1-terra' | vercel env add CHAT_OPENAI_MODEL production`

| Name | Value | Note |
|---|---|---|
| `CHAT_OPENAI_MODEL` | `gpt-6.1-terra` | planner and answer primary |
| `CHAT_ANSWER_FALLBACKS` | `openai:gpt-6-luna` | replaces the code default (gpt-4o-mini) |
| `CHAT_PLANNER_FALLBACKS` | `openai:gpt-4o` | recommended interim (§9.2); remove or replace with luna before 2027-01-14 |

Unchanged: `LLM_OPENAI_MODEL` (shared), `CHAT_CLAUDE_*` (Claude planner stays disabled), any Groq setting, card chat.

### 9.6 Order (two steps, so code and model changes can be rolled back separately)
1. **Merge #2053, then the production deploy reaches READY.** No env change yet. Production then runs the B2 code with today's models: gpt-4o, with gpt-4o-mini as answer fallback. Staging validated this as `current` and `fallback-mini`.
2. Verify it live (§9.7 A).
3. **Add the three env vars (Production), then redeploy the current production deployment.** Use `vercel redeploy` or the dashboard Redeploy; no empty commit. Env vars only bind on a new build. Wait for READY.
4. Verify it live (§9.7 B).

### 9.7 Live re-verification
Production emits no trace by design, so verification combines a signed-in session with database rows. A person must sign in with a real Pro or staff account: production enforces the emailed second factor for paid accounts, and the synthetic example.com account cannot receive it. **No new test account is needed.**

**A. After the merge deploy (today's models)**
- `curl --compressed -L https://getmindy.ai/` returns 200. Sign in at `/app`, open Ask Mindy, ask:
  1. "What security guard opportunities are open right now?" Expect real SAM links, no expiring-contracts list, no raw error text.
  2. "Which security guard contracts are expiring in the next 12 months?" Expect the record list and the "Industry codes chosen by Mindy" disclosure.
  3. "How do I write a capability statement?"
- `llm_usage_log` (last 15 min, that user): `tool='chat_tool_round'` and `tool='chat'` rows with `model='gpt-4o'` and `cost_usd > 0`.
- `tool_errors` (`tool='ask_mindy'`, last 15 min): no `answer_failure`.

**B. After the env change and redeploy**
- Repeat the same 3 questions.
- `llm_usage_log`: `model='gpt-6.1-terra'` for both `chat_tool_round` and `chat`, with `cost_usd > 0`. This also proves §9.4 is live.
- No `answer_failure` in `tool_errors`. Time to first token similar to staging (about 2.5–6s).

### 9.8 Rollback
- **Model change only (step 3):** use Vercel Instant Rollback to the step-1 deployment, which is immediate. Then `vercel env rm` the three vars (Production) so the next build doesn't bring them back.
- **Code (step 1):** use Vercel Instant Rollback to the pre-merge production deployment. Then open a `git revert -m 1 <merge sha>` PR so `main` matches.
- No migrations, no data writes and no flag changes are involved, so a rollback has no data step.

## Go / no-go

| Gate | State |
|---|---|
| Unit suite (12,092 tests) · tsc · pre-push gate · GitHub `verify` · Vercel preview build | PASS (pre-push live steps skipped: no `.env.local`) |
| Raw provider text never shown | PASS offline |
| Oversized results bounded + whole-request budget | PASS offline |
| Wrong-tool routing (security guard) | PASS offline + live (§8) |
| #2049 billing / replay / error / disconnect | PASS offline |
| Supported long-term models chosen + live-validated | terra + luna validated on staging (§8); **Eric's choice PENDING** |
| Live staging run: cost, quality, fallback behavior | **DONE** (§8): 4 configs pass, Groq fallback fails (8K TPM plan limit) |
| Production B2 | **not claimed** |

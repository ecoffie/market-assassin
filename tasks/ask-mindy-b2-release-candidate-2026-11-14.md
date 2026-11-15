# Ask Mindy B2 — release candidate and go/no-go evidence (2026-11-14)

PR #2053 · branch `fix/ask-mindy-b2` · based on main `7f3a14ac9` (includes #2049).
**Status: NO-GO until the live staging run (§7) passes and Eric approves the model choices (§2).**
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

## 7. Live staging acceptance — BLOCKED ON CREDENTIALS

Script: `scripts/ask-mindy-b2-acceptance.mjs` (refuses production hosts, never prints the token, hard
`--budget-usd` cap, 8 questions incl. the security-guard incident shape). Needs, from Eric:
1. `ASK_MINDY_TRACE_EVENTS=true` on the **Preview** environment (scoped to branch `fix/ask-mindy-b2`).
2. A Pro test account + its auth token, handed over outside the transcript.
3. OpenAI account credits confirmed (Incident B).
   Previews may sit behind Vercel Deployment Protection; if so, a protection-bypass token for automation is also needed.
4. Approval to run each model configuration (current / gpt-6.1-terra primary / gpt-6-luna and Groq gpt-oss-120b fallbacks),
   estimated ≤ $1 per configuration at list prices.

## Go / no-go

| Gate | State |
|---|---|
| Unit suite (12,092 tests) · tsc · pre-push gate · GitHub `verify` · Vercel preview build | PASS (pre-push live steps skipped: no `.env.local`) |
| Raw provider text never shown | PASS offline |
| Oversized results bounded + whole-request budget | PASS offline |
| Wrong-tool routing (security guard) | PASS offline · live pending |
| #2049 billing / replay / error / disconnect | PASS offline |
| Supported long-term models chosen + live-validated | **PENDING** (§2, §7) |
| Live staging run: cost, quality, fallback behavior | **PENDING** (§7) |
| Production B2 | **not claimed** |

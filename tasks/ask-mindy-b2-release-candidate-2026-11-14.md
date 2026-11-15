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

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

# gpt-4o / gpt-4o-mini retirement: remaining dependencies (2026-11-15)

Status: inventory only. Nothing here changes production config or code. Base: `main` at `8e0ffb1f6` (#2053 merged).

## The deadline (cited)

OpenAI deprecations page, "Upcoming deprecations" (<https://developers.openai.com/api/docs/deprecations>, read 2026-11-15):

| Shutdown | Model | Recommended replacement | Notice |
|---|---|---|---|
| **Jan 14, 2027** | GPT-4o (`gpt-4o-2024-08-06`, `gpt-4o-2024-11-20`) | `gpt-6-luna` | Oct 14, 2026 |
| **Jan 14, 2027** | GPT-4o mini (`gpt-4o-mini-2024-07-18`) | `gpt-6-luna` | Oct 14, 2026 |

The page lists snapshots. Our code calls the aliases `gpt-4o` and `gpt-4o-mini`. We **infer** that the aliases stop working when their only remaining snapshots shut down (the earlier `gpt-4o-2024-05-13` snapshot already shut down on Oct 23, 2026). The page does not say this outright, so treat it as an inference, not a confirmed fact.

**Working deadline: every row below must be off gpt-4o / gpt-4o-mini, or confirmed to fail safely, before 2027-01-14.**

## ⚠️ Found while doing this inventory: step 2 also moves proposal chat

`CHAT_OPENAI_MODEL` is read by **two** routes, not one:

- `src/app/api/app/chat/route.ts:588` (Ask Mindy, the surface staged in B2)
- `src/app/api/app/proposal/chat/route.ts:209` (proposal chat, **not staged**)

Proposal chat builds its own request body at `proposal/chat/route.ts:214` with raw `temperature` + `max_tokens`. It does not use `openAiChatParams` (`src/lib/chat/planner-config.ts`), which sends `max_completion_tokens` and omits `temperature` for GPT-6. On any non-OK response it falls silently to Groq (`:225`–`:233`).

If terra rejects those params, B2 step 2 (`CHAT_OPENAI_MODEL=gpt-6.1-terra`) would silently move proposal chat from gpt-4o to Groq llama. Whether terra rejects them has not been tested. Raised with Agent 5 on 2026-11-15 as a hold on step 2. Recommended fix: a separate `PROPOSAL_CHAT_OPENAI_MODEL` so step 2 changes only Ask Mindy.

## Inventory

"Prod value" is the default the code falls back to. Per the B2 release plan (RC doc §9), `LLM_OPENAI_MODEL`, `CHAT_OPENAI_MODEL` and the `BRIEFING_*` model variables are **unset in Production** today, so these defaults are what actually runs.

### A. Ask Mindy chat (B2 scope)

| # | Path | Where | Default | After B2 step 2 | Before Jan 14 |
|---|---|---|---|---|---|
| A1 | Planner + answer primary (normal users) | `chat/route.ts:588`, `planner-config.ts:54` | `gpt-4o` | `gpt-6.1-terra` | ✅ resolved by step 2 |
| A2 | **Over-budget users**: planner + answer | `chat/route.ts:587`, `planner-config.ts:54` | `LLM_OPENAI_MODEL \|\| 'gpt-4o-mini'` | unchanged (`gpt-4o-mini`) | ❗ Needs `LLM_OPENAI_MODEL=gpt-6-luna`. That needs a luna planner tool-round test first. **Review required, do not change without it** (Agent 5). |
| A3 | Default answer fallback (when `CHAT_ANSWER_FALLBACKS` unset) | `planner-config.ts:96` `DEFAULT_ANSWER_FALLBACK` | `openai:gpt-4o-mini` | overridden by `CHAT_ANSWER_FALLBACKS=openai:gpt-6-luna` | Change the code default to luna so a missing env var doesn't fall back to a dead model. |
| A4 | Planner fallback | env `CHAT_PLANNER_FALLBACKS` (step 2: `openai:gpt-4o`) | none | `openai:gpt-4o` (interim) | ❗ Move to `openai:gpt-6-luna` once A5 lands. |
| A5 | Planner allowlist | `planner-config.ts:24`–`28` `TOOL_COMPATIBLE_PLANNERS` | gpt-4o, gpt-4o-mini, claude-sonnet-5 | same | Add `openai:gpt-6-luna` (and terra) after a planner tool-round route test. Keep the 4o entries until nothing routes to them. |
| A6 | Staging config `fallback-mini` | `staging-model-config.ts:34` | `gpt-4o-mini` | preview only | Delete or repoint after the switch (test-only). |
| A7 | Context window table | `token-budget.ts:30` | `^gpt-4o` → 128K | n/a | Harmless. Remove once unused. |

### B. Other product surfaces

| # | Surface | Where | Model | Before Jan 14 |
|---|---|---|---|---|
| B1 | **Proposal chat** primary | `proposal/chat/route.ts:209` | `CHAT_OPENAI_MODEL \|\| 'gpt-4o'` | See the ⚠️ section. Needs its own variable plus `openAiChatParams`, then a staging run. |
| B2 | `callLLM` OpenAI default (every `job` whose chain reaches `openai` without `openaiModel`) | `src/lib/llm/call-llm.ts:151` | `LLM_OPENAI_MODEL \|\| 'gpt-4o-mini'` | ❗ The largest dependency. `reasoning` leads with OpenAI (`call-llm.ts:69`); `extraction` (`:59`), `drafting` (`:63`) and `referee` (`:64`) use it as a fallback. There are 23 `callLLM(` call sites in `src` (e.g. `chat/followup-suggestions.ts:35`, `market/profile-from-text.ts:107`). The same `LLM_OPENAI_MODEL` variable also drives A2, so one env change moves both. That is the reason it needs review. `call-llm.ts:151` sends `max_tokens` + `temperature` raw, so a GPT-6 model there needs the same param handling as B1. |
| B3 | Bid/no-bid | `src/app/api/analyst/bid-no-bid/route.ts:307` | `openaiModel: 'gpt-4o'` (hardcoded) | Repoint (terra is the like-for-like quality tier). |
| B4 | Bid gates | `src/app/api/app/proposal/bid-gates/route.ts:114` | `openaiModel: 'gpt-4o'` (hardcoded) | Same as B3. |
| B5 | Vault document parse | `src/app/api/app/vault/documents/parse/route.ts:214` | `openaiModel: 'gpt-4o'` (hardcoded) | Same as B3. |
| B6 | Daily briefing primary | `src/lib/briefings/delivery/llm-router.ts:30` | `BRIEFING_DAILY_PRIMARY_MODEL \|\| 'gpt-4o-mini'` | Repoint. Separate client at `llm-router.ts:227` (check its params too). Groq is the fallback (`:35`). |
| B7 | Weekly briefing primary | `llm-router.ts:48` | `BRIEFING_WEEKLY_PRIMARY_MODEL \|\| 'gpt-4o-mini'` | Same as B6. |
| B8 | Pursuit brief primary | `llm-router.ts:68` | `BRIEFING_PURSUIT_FALLBACK_MODEL \|\| 'gpt-4o-mini'` | Same as B6 (pursuit briefs currently disabled). |

### C. Pricing (keep until traffic is gone)

| # | Where | Note |
|---|---|---|
| C1 | `src/lib/llm/usage-cost.ts:22`–`23` | gpt-4o and gpt-4o-mini prices. Keep them: removing them would log historical or straggler calls at $0. |

### D. Scripts (not production paths)

| Script | Line | Model |
|---|---|---|
| `scripts/extract-podcast-metadata.js` | 64 | `gpt-4o-mini` |
| `scripts/eval-cap-parse.ts` | 52 | `gpt-4o` |
| `scripts/redact-kb-names.ts` | 28 | `LLM_OPENAI_MODEL \|\| 'gpt-4o-mini'` |
| `scripts/spike-chat-v2-toolcall.mjs` | 40 | `gpt-4o` |
| `scripts/proposal-finetune/submit-finetune.mjs` | 32 | `gpt-4o-mini-2024-07-18` (fine-tune base; that snapshot is retired on Jan 14) |
| `scripts/ask-mindy-b2-acceptance.mjs` | 19 | price table only |

No `ft:gpt-4o…` fine-tuned model is referenced from `src`.

## Suggested order (each a separate reviewed PR, after B2 step 2 is verified)

1. **Proposal chat isolation** (B1). Do this before step 2 if Eric agrees, so step 2 changes only what was staged.
2. **GPT-6 param handling in `callLLM` and `llm-router`** (B2, B6–B8). Use the shared `openAiChatParams` so a model swap can't 400 into a silent fallback.
3. **Luna planner tool-round route test**, then add luna to `TOOL_COMPATIBLE_PLANNERS` (A5) and switch `CHAT_PLANNER_FALLBACKS` to luna (A4).
4. **Over-budget path** (A2) plus the `callLLM` default (B2): Eric sets `LLM_OPENAI_MODEL=gpt-6-luna` after review, with a staging run of the `over-budget-terra` config.
5. **Code defaults**: `DEFAULT_ANSWER_FALLBACK` (A3), the hardcoded `openaiModel: 'gpt-4o'` sites (B3–B5), and the briefing defaults (B6–B8). This leaves no code path that defaults to a retired model.
6. **Re-run this grep after each step**; the target is zero matches outside pricing, tests and scripts:
   `grep -rnE "gpt-4o" src --include=*.ts --include=*.tsx | grep -v test`

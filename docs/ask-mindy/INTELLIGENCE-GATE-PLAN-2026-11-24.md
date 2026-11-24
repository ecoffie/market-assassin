# Ask Mindy intelligence gate: decide before you publish

2026-11-24 · direction from Eric. Builds on [the backend spec](./ASK-MINDY-BACKEND-SPEC-2026-11-21.md) and [ownership](./IMPLEMENTATION-OWNERSHIP.md).

## The problem (verified in code)

- For market research, `src/app/api/app/chat/route.ts` forces `generate_market_report`. That tool gathers data, renders the finished HTML report and saves it. Only then does the answer model write a summary. Nothing decides anything before publication.
- `strategyPlanCheck` (`src/lib/ask-mindy/strategy-plan.ts`) is evaluation only: it records a trace notice and never blocks a save.
- The report's publication gate (`publication_state`) checks that evidence came back. It does not check whether the advice is useful.
- So the tests check whether Mindy finished the process, not whether it delivered intelligence.

## Target flow

1. **Gather evidence:** `gatherMarketEvidence()`, with sections and statuses. Nothing is rendered or saved.
2. **Analyst:** using the company profile, the shared fit scorer (`src/lib/ask-mindy/compose.ts`) and the records, pick the best pursuits, the access path, the barriers (set-aside, 8(a) sole source, AbilityOne mandatory source, incumbent) and the next move. Every claim cites a record id.
3. **Independent evaluator:** five checks.
   - Checked by software against the records:
     1. Relevant opportunities found.
     2. Realistically pursuable.
   - Judged by a separate model, never the analyst grading itself, against an explicit rubric:
     3. The reasons say why these are the best choices.
     4. There is an actionable next move.
     5. The customer can understand it without reading tables.
   - All five must pass before the answer is labelled a complete recommendation.
4. **If it fails:** name the missing evidence, make ONE bounded targeted retry within the customer's scope, or disclose the gap. Never invent opportunities to pass.
   - Zero forecasts is not an automatic fail. Check whether coverage exists and whether the search was too narrow. If it was too narrow, correct it. If coverage is missing, say so and use recompetes or advance notices, labelled as such.
5. **Publish:** `publishMarketReport(evidence + decisions)`. The executive brief comes first, with figures, NAICS, PSC, methodology and records below. The chat answer and the report come from the same decisions. The decisions are saved in the report payload so the hosted `/reports/<id>` page shows them.

## Teaching the evaluator what good looks like

- **Reference examples:** Eric's successful Claude + MCP reports. They show the kind of reasoning wanted; they are not ground truth.
- **Rubric:** derived from those examples. Every material claim is checked against source records.
- **Review:** Agent 4 checks that the evaluator separates useful answers from polished nonsense.
- **Customer feedback** is the long-run check. Returning to explore a market counts as value.

## Acceptance (first case)

Florida janitorial, through Ask Mindy:
- It names the best pursuits, their barriers and next moves.
- Every claim is tied to a record.
- The customer doesn't have to interpret tables.

A summary of metrics fails.

Gap owners:
- Data not returned → Data Core.
- Data present but not turned into a decision → Ask Mindy.
- Sound decision buried in the output → Design & Output.

## Build steps (status 2026-11-24, branch feat/ask-mindy-intelligence-gate)

1. **Done.** `gatherMarketEvidence` / `publishMarketReport` split; `generateMarketReport` is unchanged for MCP.
2. **Done.** Record checks (`src/lib/ask-mindy/evidence-checks.ts`):
   - location, including a description that names another state;
   - work (PSC share);
   - AbilityOne mandatory source (holder AND not competed);
   - set-aside versus the profile;
   - capture window;
   - for open bids: related-market, deadline and market-research notices.
3. **Done.** Analyst (`analyst.ts`, Opus 5.5): structured decisions. Software drops any pursuit that is not a passing record.
4. **Done.** Evaluator (`evaluator.ts`, Sonnet 5.5): checks 1–2 in software, 3–5 by rubric. One bounded retry, then disclose.
5. **Done.** Orchestrator (`intelligence-gate.ts`):
   - open bids from `find_opportunities` run in parallel;
   - the report leads with the decision brief;
   - it publishes only on pass.
6. **Done.** Chat route branch behind `ASK_MINDY_INTELLIGENCE_GATE` (+ allowlist):
   - covers current-find and market-research turns that name the work in the customer's own words, one state at most;
   - the work phrase is checked to be verbatim;
   - the Vault profile loads through the acting scope;
   - the `market_report` event and History trace are the same as the packaged path;
   - a gate error falls through to the existing path.

Live acceptance (Florida janitorial): complete on attempt 1, 5/5.
- None of the 4 distinct open bids is cleaning work, which agrees with Claude + MCP the same day.
- 3 ranked coming-back pursuits, each with barriers and this-week moves.
- About $0.07 and 25 seconds.

Known limits (next):
- More than one state (for example VA/MD/DC) still takes the existing path.
- Forecast gap-chasing (plan step 4: correct the search, or disclose coverage) is not built.
- Small-business size is not in the profile, so it stays "not established".
- Data Core: the report's recompete state filter leaked MS and DC rows labelled FL, and the contacts block labels Interior/FAA staff as VA. The record checks catch the first; both need fixing at the source.

Not in scope: Map control (Phase 3), a second data engine, a second scoring system, more Claude comparison runs.

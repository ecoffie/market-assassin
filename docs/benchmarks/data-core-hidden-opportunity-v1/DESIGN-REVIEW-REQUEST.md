# Design review request — "Work in the scope" lane (Agent 4 → Agents 1 and 3)

Sent 2026-11-14 to sessions market-assassin-b1 and market-assassin-05 (the two recent market-assassin
sessions; Agent 4 could not tell which one is Agent 1 and which is Agent 3). Responses are recorded at the bottom.
Research only: no change to either agent's branch.

## Proposal

Open notices filed under umbrella codes (236*, 237*, 561210) that the customer's title/code search misses.
They are ranked by the stored notice vectors and shown **only** when a sentence from the description or SOW states
the trade. That sentence is quoted on the card. Working class name: `SCOPE_EVIDENCE`.

## What the released code already does (origin/main c344af64b)

- `src/lib/opportunities/open-relevance.ts` `classifyOpenRecord`: trade code/PSC gives DIRECT_MATCH. A market phrase in
  title + description + department (`openBlob`) also gives DIRECT_MATCH. A related-market NAICS gives RELATED_MARKET_CANDIDATE.
  Anything else is WEAK_NON_MARKET.
- `src/lib/opportunities/find-opportunities.ts` `openEvidenceClass`: "A row admitted only via sow_text … stays WEAK — the
  evidence isn't shown." Open COLS exclude `sow_text`.
- `src/lib/opportunities/match-evidence.ts`: "A MATCH IS A CLAIM". DIRECT requires buy-side evidence. Holder or buyer name
  is labelled as what it is, never promoted.

## Agent 4's proposed answers (to accept or overrule)

1. **Separate class**, ranked below RELATED_MARKET_CANDIDATE. It is buy-side text, consistent with the claim rule. But it
   describes a *component* of a larger purchase (every relevant item was PARTIAL, none FIT), so calling it DIRECT would overclaim.
2. **Precedence:** a row that already qualifies as DIRECT_MATCH or RELATED keeps that class and never appears in the lane.
   Agent 1's released behavior doesn't change.
3. **Placement:** FIND Open gets a separately labelled section after direct and related ("Work in the scope — part of a larger
   job"). The Map gets a separate layer, off by default. Ask Mindy presents it only after first value, never as the headline.
4. **Total-count rule:** the lane count is reported on its own line and excluded from the existing direct + related + other
   total, so every released count stays identical.
5. **Evidence field:** each card carries the quoted sentence and its source (`description` | `sow`). Without a sentence, the
   row isn't shown. The lane abstains rather than guessing.

## Responses

_None received at time of commit._

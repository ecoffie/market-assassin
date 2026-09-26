# `search_sbir` retirement — record (2026-09-26)

**Decision (Eric, 2026-09-26):** retire the SBIR search tool. The published MCP name is
**`search_sbir`** (title "Search SBIR"; hosted edge `mcp.getmindy.ai/mcp`; 5 credits). Nothing else
was published under an SBIR name.

**Why:** the Reed Analytics investigation (PR #1708, `tasks/sbir-reed-investigation-2026-09-26.md`)
established that the tool could not return OPEN SBIR/STTR topics:
- the DoD topic cache never received a row;
- the "multisite" source errored on every call;
- the default returned funded NIH projects in `opportunities`, and the only caveat was in the
  default-off `_ai_hint`.

**Scope: withdrawal only.** No merge, no deploy, no production-data change, no credits, no customer
message. Louis's proposed 105-credit correction is a **separate** item and is not authorized here.

## What changed

| Surface | Change |
|---|---|
| `src/lib/mcp/tool-registry.ts` | `SBIR_TOOL_DEF`, `listMcpTools` entry, `isMcpTool` name, `runMcpTool` dispatch, `TOOL_CREDITS` row and the wrapper import removed |
| `src/lib/mcp/tool-schemas.ts` | `TOOL_META` title removed |
| `src/app/mcp/tools/tool-groups.ts` | removed from "Opportunity Discovery" |
| `src/mcp/server.ts` (stdio) | registration + import removed |
| `docs/mcp-tool-catalog.json` | 64 → 63 (via `audit-tool-catalog-drift.mjs --update`) |
| `docs/marketing/MCP-WHITEPAPER.md` + `.docx` | row removed, counts 64 → 63, source line corrected; `.docx` regenerated |
| `docs/MCP-CHANGELOG.md` | retirement entry, count 63 |
| `src/mcp/README.md`, `scripts/mcp-smoke.mjs` | references removed |
| `docs/DATA-SOURCES-REGISTRY.md` | SBIR row marked RETIRED; kept libraries/data listed |
| **New** `src/lib/mcp/retired-tools.ts` | the retired list + the stale-call answer |
| `src/lib/mcp/metered.ts` | a retired name is refused **before** pricing/balance/debit and logged `retired` |
| `src/app/mcp/[transport]/route.ts` | after auth, before the SDK: a single `tools/call` for a retired name gets the `tool_retired` result, logged `retired`, 0 credits |
| `src/lib/mcp/credits.ts`, `src/app/mcp/usage-charts.tsx` | `retired` call status + its label on the usage page |

**Routing / recommendations:** no other tool description, the connector instructions, or the P2
host rules recommended `search_sbir`. `potato-journey.ts` names "SBIR" only in a
do-not-use-this-jargon list, which is unrelated and unchanged.

## Stale clients

A cached client calling `search_sbir` on the hosted edge receives:

```
search_sbir was retired on 2026-09-26 and is no longer available. Mindy does not currently provide a
reliable source of OPEN SBIR/STTR topics, so this tool has been withdrawn rather than return award
history in their place. For open SBIR/STTR topics and deadlines, use SBIR.gov (sbir.gov/topics) or
the DoD SBIR/STTR portal (DSIP) directly. No credits were charged for this call.
```

- The response carries `isError:false`, the same contract as the commercial refusals: hosts treat
  `isError` as a crash and retry.
- `structuredContent.error` = `{ code: 'tool_retired', tool, retired_on, credits_charged: 0 }`.
- The call is logged in `mcp_call_log` as `status='retired'`, `credits_charged=0`.
- It never reaches `runMcpTool` or the debit.

**Edge cases:**
- **Unauthenticated calls** still get 401. The retired answer is not a bypass.
- **JSON-RPC batches** fall to the SDK, which answers "Tool not found". Still uncharged: an
  unregistered tool never reaches `runMeteredTool`.
- **The local stdio server** (dev only, no billing) answers "Tool search_sbir not found".

## Kept (not deleted, not changed)

- **Libraries:** `src/lib/sbir/search.ts` (NIH RePORTER + multisite + DoD reads),
  `src/lib/sbir/dod-sbir.ts`, `src/lib/sbir/sbir-map-pins.ts`.
- **In-app surfaces:** the SBIR panel and `/api/sbir`.
- **The unregistered wrapper** `src/mcp/tools/sbir.ts`, kept as #1708's reference implementation.
- **Stored data:** `aggregated_opportunities`, `dod_sbir_topics`, `mcp_call_log`,
  `user_search_history`, `mcp_credit_ledger`.
- **The parked specialty feeds** and the `sync-dod-sbir` cron.
- **The investigation evidence** in PR #1708.

## Evidence (at this head)

- `retired-tools.unit.test.ts` (5, **real registry**): `search_sbir` is absent from `listMcpTools`,
  `isMcpTool`, `mcpRegistrationList`, `TOOL_CREDITS`, the tool groups, `server.ts`, the catalog JSON,
  the whitepaper, the README and the smoke script. The matcher only fires on a single `tools/call`
  for a retired name, and there is no prototype-key leak.
- `route.retired-tool.unit.test.ts` (5, **real mcp-handler + SDK**, mocked auth/dispatch):
  - `tools/list` omits `search_sbir` but lists `find_opportunities`, `search_grants`,
    `get_balance`, `get_winning_playbook` (and more than 50 tools);
  - a stale call returns the retired result with the request id, logs `retired`/0, and
    `runMeteredTool` is **not called**;
  - an unrelated tool (`get_balance`) still dispatches;
  - unauthenticated → 401;
  - a batch never dispatches.
- `metered.unit.test.ts`: a retired name returns `tool_retired` without calling `getBalance`,
  `runMcpTool` or `debitCredits`, and logs `retired`/0.
- **Mutation-proven:**
  - removing the transport intercept turns the stale-call test red;
  - re-adding the name to a tool group turns the discovery test red;
  - both restored → green.
- **Stdio discovery** (server started, `tools/list`): 55 tools, `search_sbir` absent,
  `search_grants` present.
- **Gates:** `tsc` clean, catalog drift OK (63), ledger audit clean. Full suites and the pre-push
  gate results are recorded in the PR.

## Reconciling #1708

- #1708 is rebased so it **no longer touches** `tool-registry.ts` or `server.ts`. Its SBIR tool
  description and registration edits are dropped, so merging it cannot republish the tool.
- #1708 keeps the library repair, its tests and the evidence packet. Its wrapper change stays
  unregistered and gains a RETIRED header.
- Both PRs add a row at the top of `docs/REPAIR-LEDGER.md`. Whichever merges second needs a
  trivial ledger-only conflict resolution: keep both rows.
- Independently, `retired-tools.unit.test.ts` fails CI if any later merge re-registers
  `search_sbir`.

## After merge + deploy (not done here — stop before merge/deploy)

1. **Live discovery:** `tools/list` on `mcp.getmindy.ai/mcp` must not contain `search_sbir`, and
   `GET /api/mcp/catalog` must show 63 tools.
2. **Live stale call** with a test account: the `tool_retired` text; a new `mcp_call_log` row
   `status='retired'`, `credits_charged=0`; **no** new `mcp_credit_ledger` row.
3. **Live unrelated tool** (`get_balance`, `search_grants`) still works.
4. **Update the claude.ai Tool Map artifact** (the fourth catalog surface) to 63 tools. It is not
   updated before deploy because the tool is still live in production until then.
5. The 105-credit correction for Louis stays a separate, unauthorized item.

# Mindy MCP Server

Exposes Mindy's **GovCon intelligence** — proprietary teaching corpus + curated
directories + live federal-data APIs — as **29 MCP tools** any MCP-capable agent
(Claude Desktop, Cursor, a customer's own agent) can call. Credit-metered, self-serve.

**The thesis:** wrapping SAM/USASpending is the commodity layer any competitor can copy.
The moat is what *no* public API has — 8 years of course + proposal + podcast content that
answers *how to win*, plus DoDAAC-anchored buying-office contacts, an SBLO teaming roster,
and curated agency intel. The tool catalog leads with public data for utility and closes
with the un-copyable intelligence.

Full specs: [`tasks/PRD-mindy-mcp-server.md`](../../tasks/PRD-mindy-mcp-server.md) ·
Phase-2 gating/rollout: [`tasks/PRD-mindy-mcp-phase2-gating-rollout.md`](../../tasks/PRD-mindy-mcp-phase2-gating-rollout.md) ·
data provenance: [`docs/DATA-SOURCES-REGISTRY.md`](../../docs/DATA-SOURCES-REGISTRY.md).

## Two transports, one set of pure functions

Every tool is a **transport-agnostic pure function** in `tools/*.ts`. Two transports wrap
the same functions, so there's zero re-implementation:

| Transport | Entry | Use |
|-----------|-------|-----|
| **stdio** | `server.ts` | Local dev + smoke. Claude Desktop / Cursor spawn the process and speak MCP over stdin/stdout. |
| **hosted HTTP edge** | `../app/mcp/[transport]/route.ts` | Production — `getmindy.ai/mcp/mcp` (target `mcp.getmindy.ai`). API-key **or** keyless OAuth 2.1 auth + credit metering. |

The HTTP edge dispatches through the registry in
[`../lib/mcp/tool-registry.ts`](../lib/mcp/tool-registry.ts) (`listMcpTools` for
tools/list, `runMcpTool` for tools/call) — **always** via `runMeteredTool`
(`../lib/mcp/metered.ts`), the billing seam. Raw `runMcpTool` = tools run for free;
never dispatch a new entry point around the seam.

## What's here

| File | Purpose |
|------|---------|
| `tools/*.ts` | The 29 transport-agnostic tool functions (pure: no transport, no auth, no `console.log`). |
| `server.ts` | stdio entrypoint — registers all 29 tools, speaks MCP over stdin/stdout. |
| `../lib/mcp/tool-registry.ts` | The catalog + dispatcher + `TOOL_CREDITS` (source of truth for the HTTP edge). |
| `../../scripts/mcp-dev.mjs` | Launch runner — loads env, execs the server via `tsx`. |
| `../../scripts/mcp-smoke.mjs` | End-to-end acceptance test — spawns the server, handshakes, calls every tool, asserts grounded + honest results. |

## The tools (29)

Prices are in credits (debited **on success only**; repeat/cached reads are free). A first
connect grants **100 free credits**. Live catalog + prices: `GET /api/mcp/catalog`.

**Public data & search** — `search_sam_opportunities` · `get_market_vocabulary` ·
`get_keyword_coverage` · `search_grants` · `get_agency_forecasts` · `search_sbir` ·
`get_expiring_contracts` · `search_idv_contracts` · `get_solicitation_documents` ·
`search_federal_events`

**Competitive intel** — `get_contractor_profile` · `search_contractors` ·
`find_capable_contractors` · `get_contractor_award_history` · `get_incumbent_financials`
(SEC EDGAR) · `get_sblo_contact` · `lookup_sam_entity`

**Agency & award intel** — `get_agency_intel` · `get_agency_spending_detail` ·
`get_agency_budget_trends` · `get_award_detail` · `find_predecessor_award` ·
`get_regulatory_demand` (Federal Register) · `lookup_federal_osbp` ·
`search_agency_opps_by_office` · `search_federal_contacts` · `assess_market_depth`

**Proprietary & proposal** — `get_winning_playbook` (the moat) · `search_podcast_lessons` ·
`scan_proposal_compliance` · `evaluate_bid_decision` · `derive_company_keywords`

Plus the free meta-tool `get_balance` (HTTP edge only).

## The tool contract (every tool honors this)

- **Pure function** `(input) → Result`. No transport, no auth. Diagnostics go to
  `console.error` (stdout is the MCP wire).
- **`_meta { grounded, degraded, … }` ALWAYS ships.** `grounded` = ≥1 real row returned;
  `degraded` = an upstream source *errored* (distinct from a genuine empty result).
- **`grounded=false` never fabricates.** The tool (and its `_ai_hint`, when enabled) must
  say "no data found" and instruct the agent not to invent — every grounded fact traces to
  the returned data.
- **`_ai_hint { summary, how_to_use, key_caveats }` is OPTIONAL and OFF by default**
  (data-first: the raw grounded data is the product). Gated by `mcpFlags.aiHint`
  (`MCP_ENABLE_AI_HINT`, accepts only the literal `'true'`); the smoke flips it on to
  exercise the layer.

## Run it locally

```bash
# Smoke test — spawns the server, calls every tool, asserts grounded + honest.
# No Claude Desktop needed. Sets MCP_ENABLE_AI_HINT=true to exercise the hint layer.
npm run mcp:smoke

# If .env.local's SUPABASE_SERVICE_ROLE_KEY is stale ("Invalid API key"),
# pull a fresh prod env and point at it:
npx vercel env pull /tmp/ma-env.txt --environment=production --yes
npm run mcp:smoke -- --env-file /tmp/ma-env.txt

# Just launch the stdio server:
npm run mcp:dev
```

> **Env trap (this repo):** `vercel env pull` writes values with a literal `\n`; a trailing
> newline on `NEXT_PUBLIC_SUPABASE_URL` silently breaks the request path ("Invalid API
> key"). Both runners strip `\n` — if you write your own loader, do the same.

## Connect an agent

**Hosted (what customers use)** — add the endpoint as a custom connector, then sign in
through the browser (keyless OAuth 2.1 — no key to copy). First connect grants 100 credits.

```
https://getmindy.ai/mcp/mcp
```

Headless / CI can mint an API key instead (dashboard: `getmindy.ai/mcp`) and send it as a
`Authorization: Bearer <key>` or `X-Mindy-API-Key` header.

**Local stdio (dev)** — edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mindy-govcon": {
      "command": "node",
      "args": [
        "/Users/ericcoffie/Projects/market-assassin/scripts/mcp-dev.mjs",
        "--env-file",
        "/Users/ericcoffie/Projects/market-assassin/.env.local"
      ]
    }
  }
}
```

Restart Claude Desktop, then ask it, e.g.
*"Use the winning playbook tool: how do I win an 8(a) construction recompete at the VA
(NAICS 236220)?"* — it calls the tool and answers from the real corpus.

> Point `--env-file` at a fresh `/tmp/ma-env.txt` if `.env.local` is stale.

## Adding a new tool

1. Pure function in `tools/<name>.ts` (+ a client in `../lib/<source>/` if it hits an API).
2. Register in **both** `../lib/mcp/tool-registry.ts` (import · `TOOL_CREDITS` · `TOOL_DEF`
   const · `listMcpTools` array · `isMcpTool` clause · `runMcpTool` dispatch block) **and**
   `server.ts` (zod `inputSchema` + `registerTool` + the ready-log).
3. Add a `callTool` assertion block in `../../scripts/mcp-smoke.mjs` (assert `grounded` +
   traceability + an honest miss).
4. Add a row to `../../docs/DATA-SOURCES-REGISTRY.md` (provenance).
5. `npx tsc --noEmit` + `node --check scripts/mcp-smoke.mjs`, then run `npm run mcp:smoke`.

`tools/winning-playbook.ts` is the reference implementation. The customer-facing
`getmindy.ai/mcp` landing pulls the catalog live, but its `TOOL_LABELS` map
(`../app/mcp/page.tsx`) needs a friendly label for the new tool.

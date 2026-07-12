# Mindy MCP Server — Phase 0 Spike

Exposes the **GovCon Giants proprietary teaching corpus** as an MCP tool so any
MCP-capable agent (Claude Desktop, Cursor, a customer's own tool) can ask
*"how do I win this?"* and get grounded coaching — the un-copyable part of the moat.

**Why this tool first (not `search_sam_opportunities`):** SAM is a free public API;
wrapping it is the commodity layer any competitor (Tango/MakeGov) can copy. The moat is
8 years of course + proposal-template + podcast content that answers *how to win* — which
no public API contains. Phase 0 proves that on day one.

See the full spec: [`tasks/PRD-mindy-mcp-server.md`](../../tasks/PRD-mindy-mcp-server.md).

## What's here

| File | Purpose |
|------|---------|
| `tools/winning-playbook.ts` | Transport-agnostic tool logic — wraps `retrieveRagContext` (teaching chunks) + `getPodcastInsightForProfile` (real win story). Reused unchanged by the future hosted HTTP edge. |
| `server.ts` | stdio entrypoint — registers `get_winning_playbook`, speaks MCP over stdin/stdout. |
| `../../scripts/mcp-dev.mjs` | Launch runner — loads env, execs the server via `tsx`. |
| `../../scripts/mcp-smoke.mjs` | End-to-end acceptance test (spawns server, handshakes, calls the tool, asserts grounded corpus content). |

## The one tool

**`get_winning_playbook(topic, naics_codes?, limit?)`** →
- `guidance[]` — tactical passages from the teaching corpus (proposal templates, capability statements, past performance).
- `win_story` — a real podcast-guest win story matched to the NAICS (when provided).
- `_ai_hint` — pre-narrated summary + how-to-use + caveats the calling agent quotes verbatim (the moat: intelligence, not raw data).
- `_meta.grounded` — `false` when the corpus has no match → the agent must say "no coaching content", **never** invent advice.

## Run it locally

```bash
# Smoke test (proves transport + corpus, no Claude Desktop needed):
npm run mcp:smoke

# If .env.local's SUPABASE_SERVICE_ROLE_KEY is stale ("Invalid API key"),
# pull a fresh prod env and point at it:
npx vercel env pull /tmp/ma-env.txt --environment=production --yes
npm run mcp:smoke -- --env-file /tmp/ma-env.txt

# Just launch the server on stdio:
npm run mcp:dev
```

> **Env trap (this repo):** `vercel env pull` writes values with a literal `\n`; a trailing
> newline on `NEXT_PUBLIC_SUPABASE_URL` silently breaks the request path (returns "Invalid
> API key"). Both runners strip `\n` — if you write your own loader, do the same.

## Connect Claude Desktop (Mac Studio)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mindy-govcon": {
      "command": "node",
      "args": [
        "/Users/ericcoffie/Market Assasin/market-assassin/scripts/mcp-dev.mjs",
        "--env-file",
        "/Users/ericcoffie/Market Assasin/market-assassin/.env.local"
      ]
    }
  }
}
```

Restart Claude Desktop. You'll see a tools icon; ask it:
*"Use the winning playbook tool: how do I win an 8(a) construction recompete at the VA (NAICS 236220)?"*
It calls the tool and answers from the real corpus.

> Point `--env-file` at a fresh `/tmp/ma-env.txt` if `.env.local` is stale.

## What Phase 0 deliberately does NOT do

No auth, no credit ledger, no metered billing, no hosted HTTP transport, no net-new data
sources (EDGAR/GAO). Those are Phases 1–4 in the PRD. Phase 0 proves exactly one thing:
**the MCP transport works and it returns the proprietary, un-copyable intelligence** — not
a bare public-data lookup.

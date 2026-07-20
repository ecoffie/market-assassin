# Mindy MCP — Capabilities Changelog

A living reference of the Mindy MCP server's tools, credits, data sources, and the
non-obvious findings behind them. **Ingest target for Mindy Chat v2** — the goal is that
Mindy Chat can answer any "what does the MCP do / cost / where's the data from" question
accurately from this file.

Authoritative tool count: **`listMcpTools()` = 41** (never trust a grep — tools register
via two paths: explicit `*_TOOL_DEF` consts in `src/lib/mcp/tool-registry.ts` AND the
TIER1/TIER2 chat defs). The stdio server registers a 35-tool subset; the hosted HTTP edge
exposes all 41.

---

## July 2026 — Proposal pipeline, recompete, roadmap close-out, SBLO BigQuery

### New tools (catalog 34 → 41)

| Tool | Credits | What it does | Data source | PR |
|---|---|---|---|---|
| `extract_compliance_matrix` | 3 | Harvest every shall/must + Section L/M/C requirement into a structured matrix | LLM (Groq) over SAM doc text | #206 |
| `build_proposal_structure` | 1 | Compliance matrix → volume/section outline (Technical, Past Performance, Price, Forms) + critical/cross-cutting items | Pure shaping (no LLM/IO) | #208 |
| `referee_proposal_compliance` | 4 | An **independent** model scores an assembled draft vs. the matrix — met / partial / missing + evidence + score | Claude (no-training / sensitive) | #210 |
| `match_recompete_sow` | 2 | Given an expiring contract's scope, find the open solicitation that is likely its recompete, by **semantic SOW similarity** | `sam_opportunities` SOW embeddings (BQ vectors) | #211 |
| `extract_statement_of_work` | 2 | Pull the SOW/PWS/SOO out as clean text — recovers scope buried in a Section C blob + CLIN-scope fallback | Heading-boundary detection (no LLM) | #212 |
| `get_federal_event_series` | 1 | The recurring event calendar (AFCEA, NDIA, SAME, APEX + 12 annual conferences), filterable by agency/category | Static curated catalog (42 series) | #212 |
| `get_sba_goaling_share` | 2 | Statutory SB goals (23/5/5/3/3) vs. an agency's actual set-aside obligations, per category, with gap + meets flag | USASpending aggregates | #212 |
| `get_sblo_contact` **(upgraded)** | 1 → **2** | Added a live BigQuery fallback tier (see below) | curated roster/prime DB → **BigQuery** | #216 |

**Proposal pipeline (complete loop):**
`extract_compliance_matrix → build_proposal_structure → (the agent drafts) → referee_proposal_compliance`.
The actual **drafting** stays inside Mindy's authenticated Vault (private past-performance
evidence-weave) — the MCP hands over inputs, structure, and independent judgment; the
customer's own agent writes. That boundary keeps private data private.

**Recompete loop:** `get_expiring_contracts → match_recompete_sow` (pairs with
`find_predecessor_award` for "who holds it now").

### Corrected facts / findings (teach these to Mindy Chat)

- **`get_sblo_contact` is curated-first, BigQuery-fallback.** Tier 1 = 200-company
  hand-verified roster; Tier 2 = 3,502-prime DB (curated SBLO names + award context);
  Tier 3 (new) = live BigQuery recipients (~317K). **CRITICAL: BigQuery has award/recipient
  data, NOT SBLO contacts.** The BQ tier confirms a company is a real federal prime and
  returns live award context with `sblo_name: null` — it NEVER fabricates a contact. Do not
  "just switch SBLO to BigQuery"; that would delete the curated moat. Fails open on a BQ error.
- **Bug fixed in the same PR:** the 3,502-prime tier had been **silently returning zero
  rows** — the JSON is shaped `{ primes: [...] }` but the code did `Array.isArray(primeDb)`
  (always false), so only the 200-roster ever matched. Now reads `.primes`.
- **`search_federal_contacts` = ~167K government POCs (166,574 rows), ~85K with a direct
  email** — NOT the old "112K" figure (a stale internal-doc snapshot). DoDAAC-anchored so a
  DoD sub-agency returns ITS people, not the whole-DoD firehose. Role designation is sparse
  (~700 rows carry an explicit "Contracting Officer" role), so it leans on office/DoDAAC
  anchoring + title text.
- **`get_sba_goaling_share` is honest by construction:** it uses the STATUTORY
  government-wide goals (fixed law), not invented agency-negotiated goals, and labels the
  actuals as set-aside-CODE dollars — a floor on, NOT identical to, the official SBA
  Scorecard achievement (small firms also win full-and-open). It is not the Scorecard number.
- **`extract_statement_of_work` vs `get_solicitation_documents`:** the latter returns a
  classified `sow_text` when a standalone SOW doc exists; the former recovers the SOW from a
  combined/inline Section C body by heading boundaries, with a CLIN-scope fallback.

### Pricing model (current)

- **Free 100 credits on first connect** (one-time, can't be farmed).
- **Debit-on-success only**, atomic at the Postgres layer; a failed/empty call costs 0.
- Refill via **Plus / Scale credit plans** (monthly or annual); **Pro subscribers get a
  monthly credit allowance**. One-time packs are de-emphasized (the $5 Starter was retired).
- Credit tiers now span **1 / 2 / 3 / 4 / 5 / 25** (the 4-credit tier is the referee; 25 is
  the `find_capable_contractors` full BQ scan).
- Connect: keyless OAuth 2.1 at `getmindy.ai/mcp` (default) or an API key for headless/CI.
  Endpoint: `getmindy.ai/mcp/mcp`.

### Roadmap decisions (do NOT re-propose)

- **`score_win_probability` — KILLED** (2026-07-15). Deliberately cut: low signal for the
  credit cost. Not on the build list.
- **`get_agency_component_rules` — PARKED.** Genuinely new; needs a curated
  agency-supplement + command-instruction rules DB before any wrap. A minimal first cut =
  DoD (DFARS + a few commands) + VA (VAAR). Not scoped.

### Build/architecture pattern (every MCP tool)

Pure engine in a shared `src/lib/**` (existing route refactored to use it,
behavior-preserving) → thin wrapper in `src/mcp/tools/*` → registered on BOTH paths
(`tool-registry.ts`: def + dispatch + `isMcpTool` + `TOOL_CREDITS`; `server.ts`: zod
`registerTool`) → smoke block in `scripts/mcp-smoke.mjs`. All calls bill through
`runMeteredTool` (the billing seam — raw `runMcpTool` = free, never dispatch there).
`_meta { grounded, degraded, … }` always ships; `_ai_hint` is OFF by default;
`grounded=false` means "nothing found," never a fabricated answer.

### Docs kept in sync

- Capabilities artifact (`claude.ai/code/artifact/cc6154d3-…`) — 51 tools.
- `docs/marketing/MCP-WHITEPAPER.md` (source of truth) + `Mindy-MCP-Whitepaper.docx`
  (regenerate with `npm run build:whitepaper` — no pandoc needed).

**PRs:** #206, #208, #210, #211, #212, #213, #215, #216, #218 (all merged to `main`).

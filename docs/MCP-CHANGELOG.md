# Mindy MCP — Capabilities Changelog

A living reference of the Mindy MCP server's tools, credits, data sources, and the
non-obvious findings behind them. **Ingest target for Mindy Chat v2** — the goal is that
Mindy Chat can answer any "what does the MCP do / cost / where's the data from" question
accurately from this file.

Authoritative tool count: **`listMcpTools()` = 63** (never trust a grep — tools register
via two paths: explicit `*_TOOL_DEF` consts in `src/lib/mcp/tool-registry.ts` AND the
TIER1/TIER2 chat defs). The hosted HTTP edge exposes all 63.

---

## September 2026 — `search_sbir` RETIRED (catalog 64 → 63)

**Retired:** `search_sbir` (was 5 credits). It could not return OPEN SBIR/STTR topics: its only
open-topic source (the DoD cache `dod_sbir_topics`) has never received a row, its "multisite" source
selected a nonexistent column and errored on every call since #158, and its default returned funded
NIH projects in a field named `opportunities` — the "these are awards" caveat lived only in the
default-off `_ai_hint`. Investigation: `tasks/sbir-reed-investigation-2026-09-26.md` (PR #1708).

- **Absent from discovery:** registry, `TOOL_CREDITS`, tool groups, stdio server, catalogs, smoke.
- **Stale clients:** a `tools/call` for `search_sbir` returns a clear `tool_retired` result
  (`isError:false`, "No credits were charged"), logged in `mcp_call_log` as status `retired` with
  0 credits; it never reaches `runMcpTool` or the debit. `src/lib/mcp/retired-tools.ts` is the list;
  a test fails if a retired name is ever registered again.
- **Scope:** Mindy's *dedicated* SBIR/STTR search — not all SBIR discovery (Grants.gov SBIR/STTR
  announcements stay searchable in the Grants panel).
- **Retired with it (same PR):** the in-app SBIR panel + sidebar item, `/api/sbir` (now 410), the
  Opportunity Map SBIR source and `/api/market-scan`'s SBIR section — one shared notice
  (`src/lib/sbir/retired.ts`).
- **Kept (not deleted):** `src/lib/sbir/*` (NIH RePORTER + DoD normalization), all stored data
  (`aggregated_opportunities`, `dod_sbir_topics`), the unregistered `src/mcp/tools/sbir.ts` wrapper, and
  the parked specialty feeds (untouched). The Grants panel's Grants.gov search (incl. its SBIR chip) is a
  different, supported source and stays.
- **To restore an open-topic tool:** a separate product decision + a working open-topic source — see
  the investigation record §7. Remove the name from `RETIRED_TOOLS` in the same change.

---

## September 2026 — get_legislation_status (catalog 63 → 64)

**New tool:** `get_legislation_status` (5 credits, scan-class). Status + document metadata for the
NDAA bills Mindy stores (`institute_sources`, weekly Congress collector, read through the shared
legislative reader from #1699). One input, `query` ("FY2027 NDAA", "H.R. 8800", "PL 119-60",
"S. Rept. 119-127"), resolved deterministically — no title similarity. Stages come only from stored
version codes: reported is not passed, passed is not law, only a public-law record is law; House and
Senate bills are never merged; committee reports and errata stay separate records. "Latest stored
action", never history (no action history or votes are collected). Absence follows coverage:
complete → `NOT_FOUND_IN_COVERED_CORPUS` with scope; partial / unknown / another Congress →
`NOT_ESTABLISHED`. Content questions return status + `content_status: NOT_HELD` — Mindy holds no
bill text.

**Why it exists:** a fresh claude.ai host with Mindy on answered "What is the status of the FY2027
NDAA?" from web search. So the fix also adds a LEGISLATION routing line inside the first ~1,500 chars
of the served connector instructions, and hand-off clauses on `get_regulatory_demand`,
`get_agency_intel` and `get_current_acquisition_intelligence`.

---

## September 2026 — get_keyword_coverage BigQuery measurement (identity decoupled)

**Changed tool:** `get_keyword_coverage` (still 5 credits). Deterministic source is BigQuery `usaspending.awards`, latest complete FY, description match, `SUM(obligation_amount)` at transaction grain. Warehouse failure is `NOT_ESTABLISHED` (not $0). Ranked NAICS/PSC shares are a **measured distribution**, not the user's market identity — downstream ranking no longer collapses a keyword to its lead NAICS because the share crossed 40%. Senses v2 (interpretation) is not in this change.

**Consumer neutralization (same pass):** `profile-from-text` keeps company `naics: []` and surfaces `coverageCandidates` for display/confirm; `market-overview` routes forecast/recompete/set-aside via corroborated `?naics=` or keyword language (never `coverageCodes` alone); beginner `/try` relevance treats coverage sector as a signal, not a peak-sector exclusion gate. `pickLeadNaicsFromCoverage` removed. Capability Market Match still requires SAM/award overlap (`resolveLeadNaicsWithEvidence(..., null)`).

---

## September 2026 — lookup_solicitation (catalog 62 → 63)

**New tool:** `lookup_solicitation` (5 credits, scan-class, local `sam_opportunities` — no web, no sow_text). Historical / known-id solicitation lookup. Closed ≠ gone. Short-circuits Potato P2 FIND-first. `MATCHED_CANDIDATE` is not identity. Amendments collapse at query time via #1557. Does not modify `find_opportunities`.

## September 2026 — match_company_to_pathways (catalog 61 → 62)

**New tool:** `match_company_to_pathways` (8 credits). PATHWAY FIT after CURRENT INTELLIGENCE:
two-sided match of CAI buyer doors to a company’s stranger-verifiable public record (UEI awards +
SAM certs with provenance). Determinations: SUPPORTED_FIT / POSSIBLE_FIT / NOT_ESTABLISHED /
NOT_APPLICABLE. `no_proven_door` is success. Never invents Talent, vehicle portfolios, or CAI
NOT_YET_MEASURABLE doors. Never set-aside-first. CAI `_next.tool` now points here.

## September 2026 — get_current_acquisition_intelligence (catalog 60 → 61)

**New tool:** `get_current_acquisition_intelligence` (8 credits). CURRENT INTELLIGENCE journey
slot after FIND: what CHANGED about how a buyer is buying for a capability, and what to do
differently — cited OBSERVED_CHANGE + CURRENT_STATE from LIVE compose only
(`recompete_changes`, `recompete_opportunities`, `sam_opportunities`, `agency_forecasts`,
`sam_events`). Killer rule: no `do_differently` without `caused_by`. Pathway gaps stay in
`not_yet_measurable` (no CSO/OT/consortium/rapid/PAE invention).


## September 2026 — understand_customer (catalog 59 → 60)

**New tool:** `understand_customer` (5 credits). First Customer Journey UNDERSTAND transition after
specific `find_opportunities`: grounded package with **The opportunity says** · **Broader agency
research shows** · **What that suggests you emphasize**. FIND `_next` for specific shape now points
here (not bare `get_agency_intel`). Capability statement / Response / Meeting brief intentionally
not included yet. Seam A (FIND) remains complete via #1535; PR #1526 stays frozen pending reconcile.

## September 2026 — find_opportunities (catalog 58 → 59)

**New tool:** `find_opportunities` (10 credits). Customer-facing Opportunity Map FIND —
Open now + Coming back + Coming soon in one compose. Independent horizon envelopes
(empty Open ≠ market zero). `search_sam_opportunities` remains advanced/Open-only.
Watch coverage honesty: Open + Coming soon until recompete alerts ship.

---

## September 2026 — Schedule discovery without saying "alerts"

**Problem.** Connected agents only reached `schedule_market_search` when users said
"alerts." Phrases like "monitor this market," "schedule this," "create a watch," or
"email me new opportunities" did not discover the tool.

**Fix.** Shared discovery copy (`src/lib/mcp/schedule-discovery.ts`): tool title +
description + MCP `instructions` on both hosted and stdio transports. Cadence honesty
(daily/weekly/paused only — explain clock times before saving). Unsupported filter keys
and strategy strands are **rejected** (never silently dropped into a broader watch).

---

## August 2026 — Saved-search schedule parity (catalog 54 → 58)

**New tools:** `schedule_market_search` (0 cr), `list_market_schedules` (0), `update_market_schedule` (0), `delete_market_schedule` (0). Scheduling is configuration — it does not retrieve new intelligence. MCP agents can create the same `saved_searches` rows the Opportunity Map uses. `delivery_ready` requires an enabled daily `saved-search-alerts` registration plus a recent successful 2xx run with no newer failure; table/config existence alone is not delivery evidence. One daily invocation pages every due schedule until drained or a 240s/400-row ceiling; leftover backlog self-reports `partial`/`error`, never success. Recompete requests are rejected until that cron supports the corpus. Gold master: `src/lib/saved-searches/service.ts`.

---

## July 2026 — verify_m_scale (catalog 52 → 53)

**New tool:** `verify_m_scale` (0 credits, read-only, QA/meta). Independently re-verifies
Mindy's three branded numbers against their authoritative oracle and returns PASS/FAIL per
check — so a third-party tester can PROVE the numbers are grounded, not take them on faith:
- **M-Estimate™** — the `opp_value_range` RPC's low/median/high must equal the 25th/50th/75th
  percentiles re-derived from the raw award table (`recompete_opportunities`) for that NAICS.
  A NAICS with no comparables → an honest "No estimate", never a fabricated band.
- **M-Win** — a fixed profile+opp must produce the exact documented factor total (98).
- **M-Scale™** — the size tier flips exactly on fixed $ bands.

Reuses the SAME shared oracle lib (`src/lib/qa/m-scale-oracle.ts`) that `npm run verify:m-scale`
and the predeploy gate call — one source of truth, so the CLI, the gate, and the tool can never
disagree.

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

- Capabilities artifact — 61 tools.
- `docs/marketing/MCP-WHITEPAPER.md` (source of truth) + `Mindy-MCP-Whitepaper.docx`
  (regenerate with `npm run build:whitepaper` — no pandoc needed).

**PRs:** #206, #208, #210, #211, #212, #213, #215, #216, #218 (all merged to `main`).

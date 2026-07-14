# Scope — MCP corpus extraction guardrails

**Status:** SCOPE / awaiting sign-off (not built). Author: 2026-07-14.
**Goal:** stop a competitor from bulk-extracting Mindy's proprietary corpora through the
hosted MCP server, without hurting the legitimate agent experience or the public-data
"commodity utility" story.

---

## 1. Threat model

**Asset at risk:** the un-copyable moat — the teaching corpus (`get_winning_playbook`),
the extracted podcast lessons (`search_podcast_lessons`), the curated SBLO roster
(`get_sblo_contact`), and the OSBP directory (`lookup_federal_osbp`). These tools return
**proprietary content** (passages, `key_lessons`, curated contact rows), not public-API
passthroughs.

**Vector:** the tools are cheap (1–2 credits) and enumerable. A competitor signs up, gets
**100 free credits**, and systematically calls the proprietary tools across many
topics/companies to reconstruct the corpus piece by piece — then ships it as their own.

**Explicitly NOT in scope to protect:** the public-data tools (`search_sam_opportunities`,
`get_award_detail`, `search_grants`, `get_agency_spending_detail`, …). They wrap free
public APIs — there's nothing to "steal," and gating them would kill the day-one utility
that gets agents onto the platform. Guardrails apply ONLY to the proprietary set.

---

## 2. Tool classification (the list the guardrails key off)

| Class | Tools | Guardrail |
|-------|-------|-----------|
| **Proprietary (protect)** | `get_winning_playbook`, `search_podcast_lessons`, `get_sblo_contact`, `lookup_federal_osbp` | Full guardrail stack below |
| **Curated-but-public-source (light)** | `search_federal_contacts` (SAM POCs), `get_agency_intel` (pain points) | Anomaly logging only; underlying data is public |
| **Public passthrough (none)** | everything else (SAM/USASpending/EDGAR/CALC/Grants wrappers) | No change |

The classification lives in one place — a `PROPRIETARY_TOOLS` set next to `TOOL_CREDITS`
in `tool-registry.ts` — so it can't drift.

---

## 3. The guardrail stack (layered, cheapest-first)

### Layer A — Free credits don't unlock the crown jewels *(pricing lever, highest ROI)*
The 100 free signup credits should buy an **evaluation of the public-data tools**, not a
free corpus dump. Options (pick one — see Decisions):
- **A1 (recommended):** proprietary tools are **paid-only** — free-trial credits can't be
  spent on them (`requires_paid_credits` message, same shape as the existing `requires_pro`
  gate). A real buyer still gets them; a drive-by scraper with only free credits can't.
- **A2:** raise proprietary tool prices (e.g. playbook 2→5, podcast/sblo 1→3) so a bulk
  pull burns credits fast. Softer; slows extraction rather than blocking free extraction.

### Layer B — Per-account rolling-window volume caps *(the actual throttle)*
In `runMeteredTool`, before running a proprietary tool, count that account's successful
proprietary calls in a rolling window (from `mcp_call_log`, or a KV counter for speed).
Over the cap → reject with a clear, non-crashing message (mirror the tier-gate pattern at
`metered.ts:40`). Starting caps (tunable): **e.g. 40 proprietary calls/day, 150/week per
account.** A human researcher never hits this; an enumerator does. Logged as `throttled`
(that log row is also the "who's probing us" queue).

### Layer C — Result shaping (don't hand over raw bulk)
Confirm each proprietary tool returns a **bounded, synthesized** payload, not a raw dump:
`get_winning_playbook` already caps guidance passages — audit the others so
`search_podcast_lessons` returns lesson *summaries* (capped N), `get_sblo_contact` returns
one company per call (already single-lookup). No "give me everything" shape exists.

### Layer D — Enumeration-anomaly detection *(catch what caps miss)*
A daily cron over `mcp_call_log` scores each account's proprietary-tool usage on breadth
(distinct queries), volume, and velocity. High scorers → an internal alert (and optional
auto-throttle flag). This is detection, not blocking — it catches slow, under-the-cap
scrapers and novel patterns. Reuses the existing admin-alert path.

### Layer E — Canary corpus entries *(provenance / legal backstop)*
Seed each proprietary corpus with a handful of traceable **canary** entries (a fabricated
but plausible "lesson"/roster row). If a competitor's product ever surfaces a canary, it's
court-grade proof of theft. One-time data task, near-zero maintenance.

---

## 4. What it touches

| File | Change |
|------|--------|
| `src/lib/mcp/tool-registry.ts` | `PROPRIETARY_TOOLS` set (+ price bumps if A2) |
| `src/lib/mcp/metered.ts` | Layers A + B enforcement (flag-gated, same pattern as the tier gate) |
| `src/lib/mcp/extraction-guard.ts` *(new)* | rolling-window counter + cap logic (KV or `mcp_call_log` query) |
| `src/lib/mcp/packages.ts` / free-credit grant | A1: mark free credits ineligible for proprietary tools |
| `src/app/api/cron/mcp-extraction-watch/route.ts` *(new)* | Layer D daily anomaly scan + alert |
| corpus data / migration | Layer E canaries (one-time seed) |
| `src/lib/mcp/flags.ts` | `MCP_EXTRACTION_GUARD` flag (off → zero behavior change) |

No change to the public-data tools, the transport, or the billing seam's contract.

---

## 5. Rollout (safe, reversible)

1. **Ship dark:** land Layers B+D in **log-only** mode behind `MCP_EXTRACTION_GUARD=off`.
   Watch `mcp_call_log` for a week — see real proprietary-tool usage distributions, set caps
   to the 99th percentile of legitimate use so no real user is hit.
2. **Enforce:** flip the flag; caps + the free-credit rule (A1) go live.
3. **Tune:** adjust caps from the observed distribution; canaries + anomaly cron run
   continuously.

Everything is flag-gated and returns clean `error` objects (never a mid-run crash), exactly
like the existing `enforceTiers` gate.

---

## 6. Decisions needed before build

1. **Free credits & proprietary tools** — A1 (proprietary = paid-only, *recommended*) or
   A2 (just price them higher)?
2. **Starting caps** — go with 40/day · 150/week per account, or set from a week of
   log-only data first (*recommended: measure first*)?
3. **Canaries (Layer E)** — in scope now, or defer as a follow-up?
4. **Priority** — full stack, or start with the two highest-ROI layers (A + B) and add
   D/E later?

---

## 7. Effort estimate

- Layers A + B (the real protection): **~1 focused PR**, flag-gated, log-only first.
- Layer D (anomaly cron): **~1 PR** (reuses `cron_jobs` + admin-alert infra).
- Layer C audit: hours (mostly verification the shapes are already bounded).
- Layer E canaries: hours (one-time data seed).

Recommend shipping **A + B in log-only first**, measuring, then enforcing — before D/E.

# BUG — Mindy Chat blends forecasts with open opps + falls back to "check SAM.gov"

**Reported:** 2026-07-30 · **Source:** real user (Andre @ CypherIntel, via Eric)
**Severity:** S1 — erodes trust in Mindy's core value prop ("she only searches SAM?")
**Type:** prompt-adherence + missing prompt guidance (NOT a data/tool gap)
**File:** `src/app/api/app/chat/route.ts` (the chat system prompt, ~lines 114–136)

---

## What the user saw

AJ asked Mindy for Q4-FY26 cyber/cloud/compliance/network/server opportunities. Mindy returned
a strong list of DHS items — but:

1. Mixed **forecasts** (CEEOSS, NCCS 2.0, CBP cyber ops recompete, $100M+) with **open
   solicitations** (Key West security systems, TACOS sources-sought) in one undifferentiated list,
   never labeling which was which.
2. When asked *"provide links to the solicitation for all of these"* — the forecasts have **no
   solicitation link** (they're not posted yet), and Mindy had no clean way to explain that.
3. Told the user **"Keep an eye on SAM.gov for updates."**

That last line made the user ask: *"Does Mindy only have access to SAM.gov? I thought she searched
many portals."* — i.e. the bug directly attacked the multi-source value prop.

## Root cause (verified in code, 2026-07-30)

- **NOT a data limit.** The chat wires the full MCP tool registry (`listMcpTools`, route line ~39).
  Verified reachable opportunity tools: `search_sam_opportunities`, `search_agency_opps_by_office`,
  `get_agency_forecasts`, `get_expiring_contracts`, `search_idv_contracts`, `search_grants`,
  `search_sbir`, `get_solicitation_documents`, `get_solicitation_incumbent`, `lookup_sam_entity`.
  So Andre's instinct ("many portals") is correct.
- **The "no check-SAM" rule EXISTS but was violated.** Prompt line 115:
  `"Never tell the user to 'go check SAM.gov / the panel' for something a tool covers."`
  The model fell back to generic advice anyway (prompt-adherence miss) — likely because it had
  nothing better to say once it ran out of open results.
- **NO rule tells it to label forecast-vs-open.** Line 117 lists the sources but never says a
  forecast is a *planned buy with no solicitation link by design*. So the model treated a forecast
  like an open notice and got cornered on "give me the link."

## The fix (prompt-only — no code, no data, no migration)

Add to the chat system prompt (`route.ts`), in the tool-use rules block (~line 124):

1. **Label opportunity TYPE explicitly in every list.** Group/tag each result as one of:
   - **Open** — a posted solicitation; HAS a SAM link + deadline; the CTA is "bid / view solicitation."
   - **Forecast** — a *planned* buy not yet on SAM; **has NO solicitation link, and that's correct**
     — the value is being 6–18 mo early. Never present a forecast as bid-ready; never apologize for
     the missing link — explain it ("this is a forecast, the RFP hasn't dropped — position early").
   - **Recompete / expiring** — an incumbent contract expiring; CTA is "track the incumbent."

2. **Reinforce the anti-fallback rule for this exact case.** When open results run thin, do NOT say
   "keep an eye on SAM.gov." Instead: surface the FORECAST + RECOMPETE results (call
   `get_agency_forecasts` / `get_expiring_contracts`) and label them. "Check SAM yourself" is never
   an acceptable answer for something a tool covers.

3. **When asked for links on a mixed list:** give the SAM link for every OPEN item, and for each
   FORECAST say plainly "no solicitation yet — it's a forecast" (with the agency/office to watch),
   rather than failing silently or implying the data is missing.

## Acceptance test

Re-run AJ's exact prompt ("Q4 FY26 opportunities with cyber, cloud, compliance, network, server").
PASS when the response:
- [ ] Groups/labels results as Open vs Forecast vs Recompete (not one blended list).
- [ ] For the DHS $100M items (forecasts), states they're forecasts with no link YET, framed as early intel.
- [ ] Contains NO "keep an eye on SAM.gov" / "check SAM.gov" style fallback.
- [ ] On "give me the links," returns real SAM links for open items + an honest "forecast, no link" for the rest.

## Notes

- Ties to the "Mindy = Zillow" direction (memory `mindy_zillow_product_design`): the map already
  separates these as distinct colored datasets — chat should inherit that same Open/Forecast/Recompete
  distinction. This ticket is the chat-surface version of that fix.
- Ground-in-real-data invariant holds: every labeled item still comes from a real tool call; the fix
  is about PRESENTATION + honesty, not new data.

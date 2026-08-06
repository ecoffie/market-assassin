# DLA bid drawer — Price Anchor enrichment (decided 2026-07-31)

## Decision (Eric)
- **Build the PRICE anchor FIRST. Image is a bonus, add after.**
- Price > photo for a DLA bid: a defensible unit-price floor tells the bidder their
  margin — that's the actual bid decision. A part photo is only "what am I bidding on"
  context.
- **No Apify if avoidable.** Prefer a FREE, server-side-fetchable source. Apify/headless
  only if the research proves every good source needs it.

## The enrichment chain (Eric's framing — 2-3 steps)
NSN → decode (CAGE + manufacturer part# + INC item name) → resolve to a commercial item
→ then EITHER a trusted commercial/govt PRICE (primary) or a part image (bonus).

Raw NSN does NOT index on Grainger/McMaster — the **part number** (from FLIS decode) is
the bridge to commercial catalogs.

## Trust hierarchy for the price (defensibility)
1. **GSA Advantage** — government-listed, most defensible.
2. **DLA award history / USASpending** — "what the govt actually paid" = the number to beat
   (arguably the best bid anchor). NOTE: DIBBS award history was WAF-gated before — reconfirm.
3. **Grainger / McMaster / Fastenal / Zoro** — real distributors, price-authoritative for the SKU.
4. Generic web scrapes — weakest; easy to mis-match the wrong item. Avoid.

## Honest-data guardrails (non-negotiable)
- NSN→part# can be 1-to-many. Present as "commercial reference (part X @ <source>)",
  NOT "the price". Never fabricate a match.
- Some NSNs are mil-spec-only with NO commercial equivalent → show "no commercial match",
  never invent one (same honest-null discipline as grounded/degraded).
- The RFQ spec PDF stays the source of truth; the anchor is a reference.

## Status
- Research agent verifying (2026-07-31): which decode + price sources are FREE +
  server-side-fetchable vs. headless/paid. NOT building until sources confirmed real.
- Drawer already renders a `.dla-quote` price-to-quote calculator + a photo slot
  (`.dla-photo`, "Photo soon") — the anchor result + image drop into these existing slots.
- Drawer redesign shipped PR #732 (getmindy.ai/opportunity-map), verified live.

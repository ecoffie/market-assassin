# Listing V1 — FROZEN. Polish backlog (do NOT build without usage data)

**DECIDED (Eric 2026-08-04): ✅ Listing V1 Complete. Freeze it. Do not keep tweaking.**
Score today: **9.4/10** (was 7.5 → 8.8 → 9.4). The remaining items are OPTIMIZATION, not
architecture — and "optimization without real usage data is just guessing." So this is a backlog to
prioritize AFTER instrumentation tells us where people actually stop scrolling / what gets ignored /
what they dwell on. Do not batch-build these. Each waits for a signal.

The discovery flow is a **milestone**: Morning Brief → Today's Intel → Opportunity Map → Decision
Card → Expanded Decision Card → Listing. Coherent end-to-end. Next epic = **Today's Intel** (not more
listing polish). See memory `listing_vs_proposal_workspace_separation` for the frozen architecture.

## Polish ideas (Eric's 9.4/10 review) — ranked, each pending a usage signal

1. **Market Value hero, calmer.** The `≈ $501,263 / Likely $210K–$1.8M` box does too much. Simplify to
   "Market Value ≈ $501K" + "Typical range $210K–$1.8M"; move "398 comparable awards" AND the "Mindy's
   estimate from … not an IGCE" disclaimer INTO "How we calculate this." The hero should be numbers,
   not explanations.
2. **Rename "Value history" → "Market Value."** It's not a history (no timeline yet) — it's the market
   estimate. Put "Market Value" on top, Contract History below. (Ties to fast-follow #88 — a REAL
   timeline would earn back the "history" name.)
3. **Contract History as a CARD, not a table.** Same fields (Current Holder · Previous Award · Expired
   · Confidence), card presentation — easier to read than the label/value grid.
4. **Buyer Intelligence: top-3 + "Show all priorities."** Four+ bullets glaze the eye; surface the top
   3, collapse the rest behind a toggle. Same for pain points.
5. **Decision Makers: add a "Find a contact…" search.** Beats scrolling once the roster is long.
6. **Whitespace pass.** Not a layout change — just breathing room: +16–20px between section groups
   (e.g. Market Intelligence ↔ Value History). Reads more premium.
7. **Charts (LATER, the one to build eventually).** Replace the "Likely $210K–$1.8M" text with a tiny
   histogram of the comparable-award distribution. (The distribution data already exists — vrChart /
   opp_value_histogram; this is the in-hero mini version.) High delight, low urgency.

## Done inside the freeze (architecture, not polish)
- **Teaming BEFORE Related** (Eric 2026-08-04): once interested, "who can help me win this?" (Teaming)
  comes before "what else is similar?" (Related). This REVERSED the Related-before-Win order shipped in
  PR #916 the same day. A flow/ordering fix (architecture), so it was fair to do inside the freeze —
  the rest of the 9.4/10 review (word-count/scan-speed) stays backlog above.

## What NOT to do
- Do NOT embed the Proposal Workspace (separate decision, memory `listing_vs_proposal_workspace_separation`).
- Do NOT keep iterating the listing before instrumentation. Freeze → collect usage → prioritize from data.

# PRD — The Mindy Procurement Intelligence Report (annual)

**Status:** SPEC (not built) · **Author:** Eric + Claude · **Date:** 2026-08-07
**One line:** the yearly report on how public procurement actually works in practice — that only Mindy can write.

---

## The insight (Eric)

> "You're collecting the data needed to publish something nobody else can. Imagine this every January:
> **The Mindy Procurement Intelligence Report.** No one has this. Not SAM. Not GovWin. Not GovTribe.
> Not GSA. Not APEX. Because no one else is observing contractor discovery behavior at this level of
> granularity. Every event you capture today isn't just improving the product — it's building a
> proprietary view of how public procurement actually works in practice. That data can become one of
> Mindy's most defensible assets over time."

Everyone else reports the **supply side from the record** (what was posted, what was awarded — public
FPDS/SAM data anyone can pull). **Only Mindy observes the behavior**: who discovered what, who came
back, how long they weighed a decision, which markets pulled attention and which were ignored. That
behavioral layer is the report — and it cannot be reconstructed after the fact by anyone who wasn't
watching. **This is the Institute's flagship publication.**

---

## Why it's defensible (the moat, stated plainly)

| Everyone can see (public record) | Only Mindy sees (behavioral, proprietary) |
|---|---|
| Notices posted, awards made, set-asides used | Which notices contractors actually **opened, saved, shared** |
| Who won | Who **discovered** an opportunity and **chose not to pursue** it |
| Contract values | **Decision time** — days from discovery to pursuit |
| Agency spend totals | Which agencies contractors find **worth returning to** |
| — | **Supplier migration** — firms moving into a new market before they win in it |
| — | **Bid intent** — demand signal *ahead* of the award record |

The public data is content. **The private behavioral history is the moat** (the operating thesis).
The report monetizes the moat once a year without giving it away — aggregate, anonymized, directional.

---

## What's in it — and where each section is GROUNDED

Same discipline as every Mindy surface: **every figure from a real source, aggregated + anonymized,
never a fabricated stat.** The behavioral corpus is real and already large.

### ✅ Groundable from the behavioral corpus we already have

| Section | The finding it delivers | Source (real, today) |
|---|---|---|
| **Discovery behavior** | how contractors actually find work (map vs. alert vs. search); % who browse without pursuing (the normal state) | `user_engagement` (**105,795 events** and growing) — the journey the map-funnel dashboard already reads |
| **Return behavior** | how often contractors come back; the habit curve; what drives return (alerts, Today's Lens) | `user_engagement` distinct-active-days (already computed for the return-rate headline) |
| **Average decision time** | median days from first discovery of an opportunity to saving/pursuing it | `user_engagement` timestamps per user×opportunity (needs a saved_at diff — see "new instrumentation") |
| **Most competitive agencies** | where contractor attention concentrates (views/saves per opportunity) | `user_engagement` events joined to the listing's agency |
| **Opportunity engagement** | which opportunity TYPES/DNA-traits draw attention (set-aside, repeat-buyer, closes-soon) | the "why this opportunity" strand-click data (already in the dashboard) |
| **Sharing / referral behavior** | the flywheel — how opportunities spread contractor-to-contractor | `opportunity_shares` (small today at 19, grows with the PayPal-flywheel feature) |

### ✅ Groundable from public data WE'VE STRUCTURED (our value-add is the framing)

| Section | Source |
|---|---|
| **Fastest-growing markets** | `sam_opportunities` posting volume by NAICS/PSC year-over-year (the market-pulse lib already computes week-over-week movers) |
| **Small-business participation** | `set_aside_enriched` (51k rows) + `sam_opportunities.set_aside_code` |
| **Supplier migration** | BigQuery `usaspending.awards` — recipients' first `action_date` in a new NAICS/agency |
| **Bid intent (leading indicator)** | Federal Register regulatory-demand signal ("demand before SAM") + forecast volume, cross-referenced with contractor discovery spikes — the "we saw it before the award record" section |

### 🟡 Needs light NEW instrumentation (name it, don't fake it)

- **Decision time** needs a `saved_at`/first-seen timestamp diffed against pursuit start (the
  `notYetMeasurable` list on the dashboard already names this exact gap).
- **Average bidders / single-bid rate** (if the report wants the buyer-side competition angle) needs
  the FPDS competition extract — same infra as the Competition Health PRD, shared.

---

## Format & cadence

- **Annual, published every January** (Eric's frame) — a designed PDF + a hosted web version + a
  press/summary one-pager. Reuse the report-render infra (`/reports/[id]`, `renderMarketReportHtml`).
- **Aggregate + anonymized only.** No named contractor, no named individual's behavior. Directional
  findings ("median decision time was N days"; "small-biz participation rose X pts in construction").
  This protects the moat (we don't hand a competitor the raw behavior) AND respects users.
- **Three artifacts per edition:** the full report (the authority piece), a shareable web summary
  (SEO + link magnet), and a data-viz teaser (social / press). The GSC 369K-impression ecosystem is
  the distribution.

---

## Why it compounds (the strategic case)

1. **Marketing moat** — no competitor can publish it; every citation says "according to Mindy's data."
2. **Institute credibility** — it's the empirical spine under the evidence case file and the county
   program ("under-served, not under-supplied," now with a year of behavioral proof behind it).
3. **Product flywheel** — publishing the report drives signups → more behavioral data → a richer
   next report. It gets *better every year and harder to catch*.
4. **Sales asset** — a government partner or enterprise contractor who reads it understands, in one
   document, that Mindy sees the market no one else does.

**The one-line pitch:** *SAM tells you what was posted. GovWin tells you what was awarded. Mindy tells
you how the market actually behaves.*

---

## Build phases

- **Phase 0 (this year, passive):** keep instrumenting — the report's raw material is `user_engagement`,
  which already grows ~105k events. Add the `saved_at` timestamp (decision-time) now so a year of it
  accrues (the data you cannot backfill — capture it while it happens).
- **Phase 1 (analysis harness, ~1 week):** an internal `report:intel` script that runs the aggregate
  queries and emits the numbers + a draft narrative (reuse the rule-based synthesizer, expanded).
- **Phase 2 (design, annual):** the designed report + web summary + teaser, on the existing render
  infra. Human editorial pass on the narrative (facts from data, framing from us).
- **Phase 3 (publish + distribute):** hosted page, IndexNow, cross-site link mesh, press one-pager.

## Success criteria

- Every stat in the report traces to a real query over `user_engagement` / `sam_opportunities` /
  `usaspending.awards` — zero invented figures; a gap is disclosed, not filled.
- The report contains ≥3 findings **no public source could produce** (decision time, browse-without-pursue
  rate, discovery-before-award bid intent) — the proof of the moat.
- It's genuinely useful to a contractor AND a buyer AND a journalist — three audiences, one document.

## Dependencies / open decisions

- **Capture `saved_at` NOW** (decision-time) — the only thing that can't be backfilled; do it this
  quarter or lose a year of the report's most unique metric.
- Legal/privacy review of the anonymization threshold before the first publication.
- Shares the FPDS competition extract with the Competition Health PRD — build once, both use it.

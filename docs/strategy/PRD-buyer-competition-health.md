# PRD — Competition Health (the buyer-side mirror of Market Intelligence)

**Status:** SPEC (not built) · **Author:** Eric + Claude · **Date:** 2026-08-07
**One line:** the exact same intelligence platform, seen through a procurement director's eyes.

---

## The insight (Eric)

> "You've been thinking about contractor analytics. What happens when cities log in? Imagine this
> exact dashboard… but for a procurement director. One intelligence platform. Two perspectives."

The contractor dashboard (`/admin/map-funnel` → **Market Intelligence**, shipped 2026-08-07) asks:
*are contractors discovering, returning, deciding, winning?* The buyer mirror asks the government's
question: **is my market competitive and healthy?** A city that shares its solicitation data with
Mindy (the county program) gets a dashboard back that answers the one thing they're graded on —
*am I getting enough qualified bidders, and is my supplier base broadening?*

This is not a new product. It is the **same engine, a different lens** — which is exactly why it's
cheap to build and hard for anyone else to copy: we already observe both sides of the market.

---

## Who it's for

| Persona | The question they open it to answer |
|---|---|
| County/city **procurement director** | "Is competition on my solicitations healthy? Am I reaching enough suppliers?" |
| Agency **OSDBU / small-business specialist** | "Is small-business + diverse participation rising or falling?" |
| **The county program** (data-share partners) | The value we hand back for sharing their data — the reason to keep sharing. |

The county-program brief already promises "who we are and how we help." **This dashboard is the how** —
the tangible thing a director sees after they share data.

---

## The metrics (mirror of the contractor view) — and where each is GROUNDED

The load-bearing discipline (same as the contractor dashboard): **every number cites a real source
or is honestly flagged "needs new data" — never fabricated.** Below, each buyer metric is mapped to
what we can produce TODAY vs. what needs new ingestion.

### ✅ Groundable NOW (ship in v1)

| Metric | Definition | Source (real, today) |
|---|---|---|
| **Small-business participation** | % of the buyer's solicitations carrying a small-biz set-aside | `sam_opportunities.set_aside_code/description` + `recompete_opportunities.set_aside_enriched` (**51,208 rows filled**) |
| **Supplier diversity mix** | share by set-aside type (SDVOSB / WOSB / 8(a) / HUBZone / SB) | same set-aside columns, grouped |
| **Opportunity visibility** | how many contractors VIEWED / SAVED / shared this buyer's listings | `user_engagement` (**105,795 events**) + `opportunity_shares` — we uniquely see the demand side |
| **Supplier discovery / reach** | distinct contractors who opened a listing from this agency | `user_engagement` filtered by the listing's agency (the map already tags agency on each card event) |
| **Market coverage** | # of active opportunities this buyer has posted, by NAICS/PSC | `sam_opportunities` (active, by department/sub_tier) |
| **Geographic reach** | states/regions the buyer's suppliers come from | contractor HQ state on the awards join (BigQuery `recipients.state`) |
| **New / first-time vendors** | firms winning from this agency for the first time in the window | BigQuery `usaspending.awards` — first `action_date` per recipient×agency |

### 🟡 Needs NEW ingestion (v2 — flag honestly, don't fake)

| Metric | Why it's blocked today | The fix |
|---|---|---|
| **Average bidders (offers received)** | `recompete_opportunities.number_of_offers` is **NULL on all 150,429 rows** — USASpending's `spending_by_award` endpoint returns NULL for "Number of Offers" no matter what (documented in the recompete sync lib). This is THE marquee competition metric and we cannot ground it today. | Ingest `number_of_offers_received` + `extent_competed` from the **FPDS bulk extract** (USASpending "Award Data Archive" CSVs carry it) into a new column. ~1 new ingestion path, mirrors the existing awards ingest. |
| **Response rate** | needs offers-received (above) ÷ notices posted | falls out of the FPDS extract once offers land |
| **Single-bid rate** | the evidence-case-file metric ("under-served markets") — offers ≤ 1 | same FPDS extract; this is the number that makes the whole "competition→cost" thesis land for a buyer |

**The honest v1 framing:** ship the 7 groundable metrics; render the 3 blocked ones as a labeled
**"Coming — needs the FPDS competition extract"** section (never a fabricated 0 or a plausible guess).
This mirrors the contractor dashboard's `notYetMeasurable` block — the honesty IS the credibility.

---

## The screen (mirror layout)

Reuse the shipped Market Intelligence shell verbatim — dark Bloomberg console, insight-first:

```
COMPETITION HEALTH · [County/Agency name] · Friday                       [7d 30d 90d]

┌── TODAY'S PRIORITIES (the director's read) ─────────────────────────────┐
│ 🟢 Small-business participation is healthy — 41% of your active         │
│    solicitations carry a set-aside, up 4 pts this quarter.               │
│ 🟡 Supplier reach is narrowing — 3 NAICS drew 80% of all contractor     │
│    views; your other 12 markets are getting little attention.           │
│ 🔴 [v2] Paving (237310) averaged 1.4 bidders — likely under-competed.   │
└─────────────────────────────────────────────────────────────────────────┘

THIS QUARTER IN YOUR MARKET  (the buyer's "what moved")
  • 24 new solicitations posted   • 6 first-time vendors won
  • SDVOSB share +8 pts           • 2 markets lost all small-biz bidders

┌─ SUPPLIER HEALTH ──────────────┐  ┌─ DIVERSITY & REACH ───────────────┐
│ Qualified suppliers reached  312│  │ Set-aside mix (donut)             │
│ New vendors this quarter       6│  │ Geographic reach (states)         │
│ First-time winners             4│  │ Market coverage (NAICS breadth)   │
│ Opportunity visibility (views) │  │ Small-biz participation trend     │
└────────────────────────────────┘  └───────────────────────────────────┘

── COMPETITION DEPTH (v2 · needs FPDS extract) ──
   Average bidders · Response rate · Single-bid rate   [Coming]
```

The `todaysPriorities` engine is **the same rule-based synthesizer** — pointed at buyer metrics
instead of contractor metrics. Zero new AI; the language is generated from real numbers.

---

## Architecture (reuse, don't rebuild)

| Piece | Reuse from | New work |
|---|---|---|
| Page shell / dark console / priority cards | `src/app/admin/map-funnel/page.tsx` (shipped) | ~0 — copy the components |
| Priorities synthesizer | the rule-based block in `map-funnel/route.ts` | new rules over buyer metrics |
| Set-aside / diversity queries | `sam_opportunities` + `recompete_opportunities` | new `computeCompetitionHealth(agency)` lib |
| Demand-side (views/shares) | `user_engagement` + `opportunity_shares` | filter by agency |
| First-time vendors | BigQuery `usaspending.awards` | one windowed query |
| **Avg bidders / single-bid (v2)** | — | **new FPDS-extract ingestion** (the only real infra add) |

**Gating / access:** this is a **buyer-facing** surface, not admin. It lives behind an agency login
(the county-program partners), scoped to THEIR agency by `agency`/`department` key. v1 can ship as an
admin-previewable route (`/admin/competition-health?agency=`) to prove it, then get its own gated
buyer entry.

---

## Build phases

- **Phase 0 (spike, ~1 day):** `computeCompetitionHealth(agency)` lib over the 7 groundable metrics;
  admin route `?agency=` to eyeball real numbers for a real county.
- **Phase 1 (~3 days):** the mirror page — priorities + supplier-health + diversity/reach cards,
  all grounded; the v2 metrics rendered as an honest "Coming" block. Ship admin-previewable.
- **Phase 2 (infra):** FPDS competition extract → `number_of_offers_received` column → light up
  **Average bidders / Response rate / Single-bid rate**. This is the metric that closes the loop
  with the evidence case file (under-served markets) and makes the buyer say "this is my scorecard."
- **Phase 3 (product):** gated buyer login, per-agency scoping, the county-program partners get it as
  the deliverable for sharing their data.

## Success criteria

- A real county's dashboard renders with **real** set-aside/participation/reach numbers (not zeros).
- Every metric traces to a source; the 3 blocked ones say "Coming — needs FPDS extract," never a fake number.
- The priorities read like a procurement director's morning brief, each citing a real figure.
- Phase 2: single-bid rate is live and reconciles with the evidence-case-file audits (SC paving, etc.).

## The strategic point

One platform, two mirrors. The contractor sees *where's the work*; the buyer sees *is my market
healthy*. **We are the only party that can show both, because we observe both sides.** That is the
moat, and this dashboard is how a government partner feels it.

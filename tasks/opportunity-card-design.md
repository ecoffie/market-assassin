# Opportunity Card + Detail — design spec (2026-07-25)

The Mindy opportunity detail, modeled 1:1 on Zillow's researched information hierarchy
(Eric: "they've spent millions on research, don't reinvent the wheel"). Zillow's order is
the product: identity+price → the human "what's special" → where → provenance → full spec →
**history** → tax context → **affordability** → **value estimate** → risk → neighborhood →
schools → action → comps. We follow it beat for beat, mapping each section to Mindy data we
actually have.

## Structure — two surfaces (the Zillow model)

- **Compact list card** (the right-column entry on `/opportunity-map`): section #1 only — the
  scannable snapshot. **No Save/Draft buttons on the card face** (Eric). Clicking it opens the
  detail.
- **Detail view**: the full stacked sections below. Opens as a **slide-in drawer over the map**
  (keeps context — Zillow-on-mobile pattern). Actions (Save to pursuits / Draft proposal) live
  in the detail, not the card.

## The two crown jewels (why ours can beat Zillow, not just copy it)

Zillow's most valuable proprietary layers are the **Zestimate** (AI value) and **price history**.
Ours are the **AI Pursuit Brief** (grounded in the moat via semantic search — incumbent, winning
playbook, the user's vault/profile) and **past-contract history**. They sit at #2 and #6/#9 —
exactly where Zillow ranks its equivalents.

## Guardrails (do NOT violate)

1. **No win-probability score.** Section #8 ("Eligibility & fit") is Zillow's "BuyAbility"
   ("can you afford it") → "can you *win* it" — but built as **factual checks** (set-aside
   eligible? under the size standard? in your NAICS?), **NEVER a predicted win-% score**.
   Win-probability/opportunity scoring is on the permanent DO-NOT-REBUILD list (rejected 3×).
2. **No self-filtering** — the complete dataset shows; the office-vs-place-of-performance
   honesty (hollow pins, "buying office" labels) carries into the card/detail. ([[no-self-filter-complete-dataset]])
3. **No fabrication** — every fact traces to a real column/API; an honest "not disclosed" /
   "no predecessor found" beats a guess. Especially the AI Pursuit Brief: grounded only, cites
   its data.

## The section order (top → bottom)

| # | Zillow section | Mindy section | Content | Data source (verified) |
|---|---|---|---|---|
| 1 | status·price·address·beds/baths·est-payment·quick-facts | **Snapshot** | notice type · deadline countdown · title · expected value range · agency+office · location (PoP vs office cue) · quick strip: NAICS · PSC · set-aside · solicitation # · posted/updated | direct columns |
| 2 | **What's special** (chips+narrative+views/saves) | **⭐ AI Pursuit Brief** | AI highlight chips (extracted requirements) + plain-English brief ("should you pursue, the play, risks") + freshness + "N similar open" | RAG/semantic over description+sow_text+incumbent+profile; analyst/bid-no-bid pattern |
| 3 | map·street view·commute | **Where** | mini-map: place of performance + buying office | map_lat/lng, office_address |
| 4 | listing meta · **Listed by** | **Points of Contact** | CO/POC — name · title · email · phone | `points_of_contact` (fullName,title,email,phone) + federal-contacts |
| 5 | **Facts & features** (grouped) | **Requirements & facts** | Scope of Work (SOW/PWS excerpt) + grouped classification / competition / timeline / vehicle + documents | sow_text, has_sow_doc, naics/psc/set_aside, fair_opportunity, dates, attachments |
| 6 | **Price history** (dated table) | **History — past contracts** | dated: incumbent · value · expiry · vehicle (Eric's favorite) | incumbent, solicitation-incumbent, find-predecessor |
| 7 | public tax history | **Agency spend pattern** | this agency's annual spend in this NAICS + trend | target-market-research, fpds-top-n |
| 8 | **BuyAbility / affordability** | **Eligibility & fit** (FACTS, not a score) | set-aside eligible? · under size standard? · in your NAICS? | user profile + set_aside + naics; NO scoring |
| 9 | **Zestimate** (value+range+trend) | **Expected value** | estimated contract value **range** (0–500K · 500K–1M · 1M–5M · 5M+) + basis (predecessor ceiling) + recompete-value trend | award-detail, find-predecessor |
| 10 | climate risks | **Pursuit red flags** | sole-source intent · incumbent lock · short fuse · LPTA | AI over notice_type/fair_opportunity/dates/incumbent |
| 11 | neighborhood / getting around | **Agency intel** | the office · pain points · buying behavior · OSBP | agency-intel, federal-contacts |
| 12 | nearby schools | *(folded into #4/#11)* | — | — |
| 13 | open house · contact · **request a tour** | **Actions** (sticky) | Save to pursuits · Draft proposal · Add deadline to calendar · Contact CO | /api/pipeline, draft, ics |
| 14 | nearby cities (comps) | **Similar opps + teaming partners** | related open opps in this NAICS + capable contractors ("subcontractors") | oppsInNaics, find_capable_contractors (BigQuery) |

## Reusable pieces we already have (don't rebuild)

`AwardDetailDrawer.tsx` · `IncumbentIntel.tsx` (#6/#9) · `OpportunityDetailStrip.tsx` ·
`CollapsibleOpportunityDescription.tsx` (#2/#5) · APIs: `award-detail`, `incumbent`,
`solicitation-incumbent`, `federal-contacts` (#4), `target-market-research` (#7/#11),
`find_capable_contractors` (tier2, BigQuery — #14), `agency-intel` (#11).

## Build order (top-down, section by section — verify each against live data)

1. **Snapshot** (#1) — the compact card redesign + the detail header. No buttons on the card.
2. **AI Pursuit Brief** (#2) — the differentiator; grounded, cited, honest-miss.
3. **Where** (#3) — mini-map.
4. **Points of Contact** (#4).
5. **Requirements & facts** (#5) — SOW + grouped spec + documents.
6. **History — past contracts** (#6) — reuse IncumbentIntel/AwardDetailDrawer.
7. **Expected value** (#9) + **Eligibility & fit** (#8, facts only).
8. **Agency spend/intel** (#7/#11), **red flags** (#10), **similar+teaming** (#14).
9. **Actions** (#13) — Save to pursuits / Draft proposal / calendar, sticky.

## Open items / decisions
- Detail opens as a **drawer over the map** (recommended) vs full-screen vs `/opportunity/[id]` page.
- AI Pursuit Brief cost: gate behind the LLM cost discipline (`callLLM({job})`, gpt-4o-mini first);
  cache per notice_id so it's generated once, not per open.
- Expected value for OPEN opps: infer from predecessor ceiling, label "est. from the prior
  contract"; no predecessor → "value not disclosed."

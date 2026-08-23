# Demo Evidence System

**Purpose:** turn demo questions into product decisions instead of tickets.

The 2026-08-22 demo produced 24 questions. Handing 24 questions to engineering is the mistake
this system exists to prevent — most of them are not features. They are bugs, missing copy, or
things to validate before anyone builds.

---

## The four statuses

Every captured question gets exactly one.

| Status | Meaning | Who acts |
|---|---|---|
| **BUG** | Mindy should already do this and something is broken | Engineering, immediately |
| **CLARIFY** | The capability exists but users could not find or understand it | Copy / UI / demo narrative |
| **VALIDATE** | Good idea — check demand and data feasibility before building | Product research |
| **BUILD** | Strong evidence, strategically aligned, feasible | Engineering, after validation |

**The default is not BUILD.** A question asked once by one person is a signal, not a mandate.
Frequency across demos is what promotes something to BUILD.

---

## The capture taxonomy

Record every demo, support, and sales question as:

```
surface:   maps | mcp | both | business
theme:     geography | data_coverage | teaming | estimate | alerts |
           onboarding | filtering | prediction | pricing | integration
status:    bug | clarify | validate | build
question:  <verbatim — never paraphrased>
asker:     <segment: new / experienced / certified / island / manufacturer ...>
date:      <demo date>
```

**Verbatim matters.** A paraphrased question loses the thing that made it useful. "Why don't I
see all the NAICS codes? For example: I cant filter with 333612" is diagnosable. "User wants
more NAICS codes" is not.

After five demos this stops being a discussion and becomes a count:

> radius search — 17 · teaming — 14 · data provenance — 12 · remote work — 9 · API — 3

That is roadmap evidence. Until then, frequency is 1 and everything is a hypothesis.

---

## 2026-08-22 — the first entry

24 questions. Two surfaces, and they asked different kinds of things:

- **Maps (13)** — what users expect a procurement map to let them *see and decide*.
  Coverage, geography, filtering, players, prediction, trust.
- **MCP (8)** — what users expect an AI assistant to *know and do*. Every one is a variant of
  "what can I ask this thing?"

That second finding is the more important one: **it is an onboarding problem, not a tools
problem.** Building tools 18–25 would have been the wrong response.

### BUG

**Q10 · NAICS filtering** — *"Why don't I see all the NAICS codes? For example: I cant filter
with 333612"*

Measured 2026-08-23:

| Fact | Value |
|---|---|
| Opportunities under 333612 | **681** (314 in last 90 days) |
| 333612 present in `NAICS_DATABASE`? | **Yes** |
| Codes offered by the picker | **521** across 31 prefixes |
| Distinct codes with real opportunities | **1,112** |
| Top-20 volume codes missing from picker | **1** (`513210`) |

**Two separate defects, and they need separating:**

1. **The user's actual failure is NOT the code list.** 333612 is in the picker and has 681
   records behind it. Browser verification (below) then narrowed this further: the filter and
   the query are both correct — **the displayed count is the defect.** This is the P0.
2. **`NAICS_DATABASE` is hand-maintained and covers ~half the codes that have inventory** —
   521 offered against 1,112 with real opportunities. The high-volume codes are almost all
   covered (19 of the top 20), so this is a long-tail gap rather than a headline failure — but
   it is the same class as the documented `484`/`488`/`493` stub problem, and it will keep
   producing this complaint.

**Do not conflate them.** Fixing the picker list does not fix the user's bug.

### BROWSER-VERIFIED 2026-08-23 — the actual defect is the COUNT

Ran the full loop on production (`getmindy.ai/opportunity-map?q=333612`):

| Check | Result |
|---|---|
| `q=333612` reaches all three map APIs | ✅ 200 each |
| Results constrained to 333612 | ✅ **26 cards, 1 distinct NAICS, zero contamination** |
| First result | Vulkan USA Couplings — a pump/compressor forecast, correct for 333612 |
| **Result count displayed** | ❌ **"3,555 results"** |
| **Real total across all sources** | **805** (681 SAM + 118 recompete + 6 forecast) |

**The filter works. The count does not.** Every visible card is 333612, but the header
reports ~4× the true number — it is counting the unfiltered set.

**This is why the user said they "can't filter with 333612."** They applied the filter,
watched the count barely move, and concluded nothing happened. The feature was working and
the number told them it wasn't.

This is the third time in this investigation that "the code is correct" and "the user's
experience is correct" turned out to be different facts:
1. The code exists in `NAICS_DATABASE` → but the picker covers half the catalog.
2. The query builder is right → but two branches disagree on 5-digit codes.
3. The results are correctly filtered → but the count is not.

**A second real defect found on the way:** `map-data.ts` treats `length >= 6` as exact match
while `map-filters.ts` treats `length <= 4` as prefix. Five-digit codes therefore behave
differently in the two paths — and **928 records across 177 distinct codes carry 5-digit
NAICS**, so it is reachable. Separate ticket.

### CLARIFY — copy and UI, no engineering

**Q1 + Q2 · The value range.** Two people asked the same thing two ways, which means the card
does not explain ownership of the number.

The good news, verified in `src/lib/opportunities/map-data.ts`: **we prefer the agency's own
verbatim `estimated_value_range`** (97.6% populated on forecasts) and only model when the
agency published nothing. So usually it *is* the government's number.

Fix: badge the source on the card — "Agency published" vs "Mindy modeled" — and show the
comparable awards behind the modeled case.

**Q3 + Q12 · Data provenance.** Users cannot see the data advantage. Live counts:

| Source | Records |
|---|---|
| SAM opportunities | 178,436 |
| Recompete / expiring | 159,626 |
| Agency forecasts | 33,296 |
| DIBBS RFQs | 28,214 |
| Grants | 1,972 |
| Aggregated (NIH/DARPA/NSF/DOE) | 1,034 |

This deserves a **Data Sources / Coverage** surface reachable from the map.
**Unverified:** whether Navy/DHS/Air Force LRAE documents specifically are included (Q12).
Do not answer that one until someone checks.

**Q8 · Award history.** Before building an FPDS-style lookup, determine whether users simply
do not realise the 159,626 recompete records already power comps — or genuinely want a
separate lookup surface.

**Q25 · Invocation.** Users think there is a magic word. There isn't. One sentence on
`/mcp/setup` — *"Just ask normally"* plus three examples — closes this, and probably part of
the silent version among the 73 who installed on Mindy Day and never asked anything.

### VALIDATE

- **Q4 · Radius search** — strongest candidate. The map already geocodes to real ZIP-level
  coordinates (GeoNames), not state centroids, so distance data is on every pin. Query plus a
  UI control.
- **Q5 · Date-range alerts** — first establish which date: posted, deadline, award, or
  recompete. Four different features.
- **Q9 · Remote work** — no structured "remote" flag exists in federal data. Do not build a
  filter that cannot be grounded.
- **Q6 + Q16 · Teaming** — one research initiative, not two tickets. Decision #014 already
  sequences it second, gated on pool health.
- **Q13 · Early demand** — research what can be *truthfully* inferred before Sources Sought.
  See MCP-EVAL-005.

### Not product

**Q14** (NextStage CRM API), **Q17** (affiliate program) — business development. Route to a
human. **Q22** (training for beginners) — the GovCon Giants catalog answers this, not the
product.

---

## What changes in the next demo

These questions mark where the demo narrative has holes. Answer them **before** they are
asked:

- When a value range appears, say whose estimate it is.
- Show provenance without being asked where the data comes from.
- During MCP setup, say: *"You don't need to write a biography. Give Mindy the basics and
  start asking; enrich the company context over time."*
- Say *"just ask normally"* out loud during the install.

A question asked twice in one demo is a hole in the story, not a gap in the product.

---

## Related

- `docs/evals/mcp-evals-from-demo.md` — the seven eval cases built from these questions.
- Decision #014 — teaming sequencing and the single-player diagnosis behind the referral gap.
- `docs/HYPOTHESIS-mcp-to-premium-intelligence.md` — the paywall funnel, frozen until
  2026-08-30.

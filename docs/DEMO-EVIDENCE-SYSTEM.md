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

## The diagnostic rule

> **When a user says "the filter doesn't work," do not start with the filter implementation.
> Reproduce what convinced the user it didn't work.**

On 2026-08-23 the filter was correct, the query was correct, and every rendered card was
correct. The user was still right: the count said 3,555 when the truth was 805, and there is
no way for them to distinguish that from a broken filter.

**The user was accurately reporting the experience Mindy presented to them.**

### The correctness hierarchy

Four things must all hold, and only the last two are visible in a browser:

```
code correctness  <  query correctness  <  displayed correctness  <  user-perceived correctness
```

A grep proves the first. A database query proves the second. **Only the browser proves the
last two** — which is why a P0 on a Maps surface is not closed from a code read.

### The five-way filter contract

```
filter state → returned records → displayed count → URL/state → visible controls
```

All five must describe the same universe. If any one disagrees, the feature is broken from
the user's perspective even when the query is perfect.

Enforced by `scripts/verify-filter-contract.mjs`, written generic across facets — the same
defect can hit agency, state, posted date, strategy, horizon, set-aside. A one-off regression
for 333612 would have caught this instance and missed the class.

**First run, 2026-08-23 — 0 of 3 contracts held:**

| Case | Displayed | True | Off by |
|---|---:|---:|---:|
| `naics-333612` | 3,555 | 805 | **342%** |
| `naics-541512` | 36,536 | 7,583 | **382%** |
| `naics-33361` (5-digit) | 3,594 | 5,258 | **32%** |

**Systemic, not a 333612 quirk.** Anyone filtering 541512 — the most common IT services code
on the platform — sees the same lie at larger scale.

Useful side finding: the 5-digit path *filters* correctly (cards came back
`333611/12/13/18`, right for a `33361` prefix), so the `map-data.ts` / `map-filters.ts`
divergence is less severe than the code read implied. Its count is wrong too, and in the
other direction — under-counting.

---

## 2026-08-23 — Hector Jaquez Jr (JPAC Global, CAGE 7TVF1), LinkedIn

> *"I tried to search NAICS 324110 in the Mindy map and it doesn't exist. Are you pulling in
> fuel contracts?"*

`surface: maps · theme: filtering · status: BUG · frequency: 2`

**This is the SECOND report of the same root cause in two days** — the long-tail half of the
Q10 finding, which #1262 explicitly did NOT fix. Frequency 2 promotes it.

**The data is there.** 324110 (Petroleum Refineries): **226** SAM records (10 currently open),
**117** recompetes (58 mappable), **17** forecasts. Typing `324110` into search on production
returns **78 results** across the three horizons. So we DO pull fuel contracts.

**What's broken is the picker.** The entire `324` family is absent from `NAICS_DATABASE` — no
`324` key, zero `324xxx` codes. Hector looked for it in the dropdown, didn't find it, and drew
the only reasonable conclusion: you don't cover fuel.

**Eight whole families with LIVE open opportunities are missing from the picker:**

| Family | What it is |
|---|---|
| **324** | Petroleum & coal products — *Hector's* |
| 311 | Food manufacturing (189 open) |
| 331 | Primary metals (67 open) |
| 326 | Plastics & rubber (94 open) |
| 337 | Furniture (131 open) |
| 513 | Publishing (85 open) |
| 531 | Real estate (137 open) |
| 115 | Agriculture support (88 open) |

Roughly **1,000 open opportunities** that cannot be reached from the dropdown, though every
one is reachable by typing the code.

**Answer for Hector:** *"We do — 226 fuel opportunities under 324110, plus 117 expiring
contracts and 17 forecasts. The gap is our industry picker: 324 isn't in the dropdown list
yet, so it looked like we don't cover it. Type 324110 into the search box and they're all
there. Fixing the picker now."*

**Do not answer only 'type it in.'** The picker IS the discovery surface — if a contractor has
to already know their code, the dropdown has failed at its one job.

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

### BUG — ✅ CLOSED 2026-08-23

**Q10 · NAICS filtering** — *status: BUG → FIXED* — *"Why don't I see all the NAICS codes? For example: I cant filter
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

### Q10 · RESOLUTION

**Root cause:** `recompete-map` widened any single NAICS code to its 3-digit family for the
count query — `naics_code.eq.333612 OR naics_code.like.333%` — which is 3,528 rows against
118 real matches. The map header sums each horizon's `totalForFilters`, so 21 (SAM) + 6
(forecast) + 3,528 (recompete) produced the "3,555 results" the user saw.

**Fixed in #1262.** Verified on production, not from a code read:

| Case | Before | After | True |
|---|---:|---:|---:|
| `333612` | 3,555 | **118** | 139 |
| `541512` | 36,536 | **4,525** | 4,561 |
| `33361` | 3,594 | **821** | 976 |

The residual 15–16% on two cases is viewport-vs-nationwide scope, not a lie — the guard now
says `INSPECT` rather than `COUNT LIES` in that band.

**A second defect fixed on the way:** `map-filters.ts` used `<= 4` for prefix while
`map-data.ts` used `>= 6` for exact, so **5-digit codes matched nothing** — `33361` returned
0 SAM rows against 252 real open records. Both now use `< 6`.

**Left open as its own ticket:** the NAICS matching rule is still defined in six places, three
now aligned. See the INVARIANT entry in `tasks/BACKLOG-later.md` — deliberately not folded in,
because broadening a verified fix is how it becomes unverified.

**What this cost to find:** three wrong diagnoses before the right one. The code list looked
wrong (it wasn't), the filter path looked wrong (it wasn't), and only reproducing what the
user actually saw — in a browser, against production — surfaced the count. That is the
diagnostic rule at the top of this document, earned.

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
**Resolved 2026-08-23:** Navy LRAE is in, and is our largest forecast source (8,821 records).
See the UNVERIFIED-resolved section below for the exact agency breakdown and the approved
answer — including the gap (no Air Force LRAE).

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

### UNVERIFIED — resolved 2026-08-23

These were flagged rather than answered at the demo. Each now has an evidence source, so the
next presenter can answer without improvising.

**Q12 · LRAE coverage — YES, and it is our largest forecast source.**

| Agency | Records | Source type |
|---|---:|---|
| **NAVY** | **8,821** | `lrae_xlsx` — the Navy LRAE itself |
| USACE (Army) | 2,908 | enterprise DA format + district workbooks |
| **DHS** | **1,243** | api |
| HHS | 3,643 | SBCX api |
| DOI | 6,164 | api + GSA gateway |
| USDA | 5,028 | api + GSA gateway |

**Approved answer:** *"Yes — the Navy LRAE is our single largest forecast source at 8,821
records, and we resolve its 'Anticipated Place of Performance' shorthand to real installations
so it plots on the map. DHS and Army/USACE are in. Air Force is not yet."*

**Do not say "all the LRAEs."** Air Force has no LRAE ingest. Naming the gap is what makes the
rest credible — see `src/lib/forecasts/navy-installations.ts`.

**Q7 · Alert limits — the policy is decided; the code does not enforce it yet.**

**Decision (Eric, established prior to 2026-08-23):** free users get a limited number of
alerts; **paid users get unlimited saved searches.** That is the answer to give.

**But it is not built.** Verified 2026-08-23: `POST /api/app/saved-searches` inserts with **no
tier check and no cap** — a free user can create unlimited saved searches today. The two
constants that look like the answer are neither:

| Constant | What it actually governs |
|---|---|
| `ALERT_CONVERSION_MAX_ALERTS = 25` | a conversion-email flow |
| `MAX_ALERT_OPPORTUNITIES = 25` | opportunities *inside* one alert email |

**Two different statements, and the demo answer must not blur them:**

- *What we sell:* "Unlimited saved searches on paid; free is limited." — the decided policy.
- *What ships today:* no enforcement.

**Do not announce a free-tier limit as live.** Saying "free is capped at N" when it isn't
teaches a paying prospect that our limits are theatre — and worse, it invites someone to test
it. Until the gate ships, the honest line is *"unlimited on paid"* and nothing about free.

**Recorded as a BUILD item** — a decided policy with no enforcement is the gap, not the
decision. See `tasks/BACKLOG-later.md`.

**Q5 · Date-range alerts — still VALIDATE, and the ambiguity is the reason.**

"By date range" is four different features and a contractor probably means the last one:

| Which date | Means |
|---|---|
| posted | "things posted this week" |
| response deadline | "only if I have 14+ days to respond" |
| award date | "awards made in Q3" |
| **recompete / expiry** | **"contracts expiring in the next 18 months"** |

Establish which before scoping. Asked once so far — frequency across demos decides whether it
earns engineering.

**Q13 · GSA pre-solicitation forecasting — partial, and say which part.**

We hold 33,296 agency forecasts, which IS the pre-solicitation layer. What we do not have is a
GSA-schedule-specific prediction model. The asker explicitly said GovWin struggles here, so
overclaiming loses them.

**Approved answer:** *"We show what agencies have published they intend to buy — 33,000+
forecasts including the Navy LRAE — plus contracts expiring on a known date. What we don't do
is predict a GSA schedule requirement nobody has published yet. When we infer, we label it."*

**Q21 · Spanish — YES, verified. Eric ran a real client engagement in Spanish via Claude.**

Not a lab test — the Monarch Marine Works shipbuilding assessment, run end to end in Spanish
(2026-08-23). Four tool calls fired correctly from Spanish prompts: `get_keyword_coverage`,
`search_contractors`, `assess_market_depth`.

**Every figure survived:** NAICS 336612 ~$338M against 336611 ~$15,300M · PSC 1905 taking ~95%
· PSC 1940 ~$282M · 572 registered / 443 capable / 48 active performers.

**The taxonomy translated, which was the open question.** NAICS and PSC descriptions came back
in Spanish — *"Construcción de Embarcaciones," "Buques de Combate," "Embarcaciones Menores,"
"La Regla de Dos"* — rather than staying English while only the prose translated. Company
names stayed English (Birdon, SAFE Boats), which is correct: they are proper nouns.

**Approved answer:** *"Yes. Ask in Spanish and you get the analysis in Spanish — including the
NAICS and PSC descriptions. The underlying federal data is what the government publishes, so
company names and solicitation numbers stay as filed."*

**Worth noting for the island-based segment (Q16, Q21 came from the same business):** this is
the strongest single answer we have for them, and it was never demoed.

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

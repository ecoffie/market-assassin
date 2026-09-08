# PRD: Supplier Activation (Government Buyer)

**Status:** ☐ PRD only — do NOT execute yet · ☐ Approved to build
**Owner:** Eric / Claude
**Written:** 2026-08-17
**Parent:** `tasks/PRD-market-research-workspace.md` (shipped — `/gov/market-research`, PR #1170)
**Related:** `docs/PRD-gov-buyer-market-research.md` (auth model, activity rubric)
**Origin:** Navy Gold Coast 2026 — PSNS & IMF (Ashley Hodge, Deputy of Small Business Programs)

---

## 1. The distinction this PRD exists to draw

> **Market Research Workspace proves the market exists.**
> **Supplier Activation helps the buyer activate that market.**

That is the missing half. The shipped workspace answers *"is there a viable small-business
market?"* — a Rule-of-Two / determination question. It does that well. But a small-business
deputy whose set-aside drew one offer has a different problem: **the market exists and did
not show up.** That is market development, and we do not address it at all today.

### The case that produced this PRD (real, measured 2026-08-17)

PSNS & IMF set aside a ship-repair requirement for small business — the right call — and
received one offer:

| | |
|---|---|
| Contract | `N4523A26C1001` |
| Awardee | Lake Union Drydock Company |
| Value | $12,702,218.97 |
| Set-aside | **Small Business Set Aside — Total** |
| Offers received | **1** |
| Ends | 10 March 2027 |

Meanwhile the NAICS 336611 supplier pool across WA + OR measures **101 qualified / 80
meeting our capability-depth criteria / 31 certified**, of which only **4** appear in the
PSNS award record we sampled.

**The framing rule for every artifact built from this PRD:** never "your set-aside isn't
working." Always *"you created the opportunity — here is how the competitive field could be
expanded."* The acquisition decision and the market response are separate facts. We comment
on the second, never the first.

---

## 2. ⚠️ Terminology correction (do this even if nothing else ships)

**We are currently calling firms "capable" when what we have measured is NAICS registration
plus federal past performance.** In an acquisition context "capable" is a word with
regulatory weight, and using it for a NAICS-plus-history score borrows credibility we have
not earned. A shipyard professional's first question about our "80 capable firms" is *how
many hold facility clearance, NAVSEA quality certifications, and controlled-industrial-area
access?* — and the honest answer may be single digits.

**Rename across the buyer surface:**

| Today | Should be |
|---|---|
| "Capable small businesses" / "capable depth" | **Relevant supplier pool** / **market-qualified candidates** |
| tier `capable` | **market-qualified** (display label only; do not churn the DB enum) |

Keep the Rule-of-Two math exactly as it is — that computation is sound and defensible. What
changes is the **claim attached to the number**. This is a display-layer and memo-copy
change, not a scoring change.

---

## 3. The five-stage job (the full arc, mostly deferred)

### Stage 1 — Discover the market ✅ SHIPPED
101 WA/OR firms identified, 80 meeting capability-depth criteria. `runMarketResearch()`.

### Stage 2 — Qualify the market ⬜ NOT BUILT
Narrow the pool on requirement-specific qualifications: shipyard access, facility
clearances, quality certifications, capacity, relevant vessel experience.
**Mindy must render `Unknown` wherever it cannot verify a qualification — never assume it.**
Most of this data we do not hold today; saying so is the honest output.

### Stage 3 — Identify the reach gap ⬜ PARTIAL (computable now)
Separate the pool into groups that mean something to a buyer:

```
Known to PSNS / prior awardees          4
Relevant supplier pool                 80
Never observed in PSNS award sample    76
Qualification verified                  ?   ← Stage 2
Qualification unknown                   ?   ← Stage 2
```

The first three are computable from data we hold. The last two are honestly `?` until
Stage 2 exists — and showing them as `?` is itself the credible move.

### Stage 4 — Activate the market ⬜ THE GOLD COAST BUILD (see §5)
Give the buyer something actionable: named firms, identity, socioeconomic status, past
performance, geography, why Mindy matched them, prior relationship if known, qualification
gaps, outreach status. Then **Export Supplier Outreach List**.

### Stage 5 — Learn why suppliers aren't participating ⬜ DEFERRED, HIGHEST LONG-TERM VALUE
Capture outreach outcomes against a fixed reason taxonomy:

`Interested · Not interested · Cannot meet requirement · Capacity unavailable ·
Facility/clearance issue · Timing · Contract terms · Bonding/capital · Didn't know about
the opportunity · Other`

This is the only path to answering **"why did only one company bid?"** — a question no
public dataset answers. It is proprietary intelligence, and it feeds the Institute.

---

## 4. Why this maps to work the acquisition team already must document

Supplier Activation is not invented because it sounds useful. The government market-research
template expects the acquisition team to build a **potential-vendor list** carrying vendor
identity, CAGE, business size, location, contact information, and a capability assessment —
and to document **the number and types of sources contacted, the efforts used to locate
sources, and the rationale for excluding sources.** It further names engaging known sources,
market surveys, RFIs, sources sought, industry days, and obtaining source lists as
legitimate market-research techniques.

So the outreach list is not a nice-to-have adjacent to the memo. **It is a documented
artifact of the market research itself**, and the reason-for-exclusion capture in Stage 5 is
likewise something the file is supposed to carry.

---

## 5. Gold Coast scope — the cheapest useful bridge

**Five days out. Build only this:**

> **Relevant Supplier Pool → New-to-this-office → Export Outreach List**

### Columns
`Company · CAGE · Location · SB Status · Relevant Past Performance · Office Award Observed? · Contact · Why Matched`

### ⚠️ The Contact column problem — measured, not assumed
`sam_entities.points_of_contact` is populated on **all 491,308 rows**, but across a
20,000-record sample: **0 emails, 0 phones, 49% names only.** SAM redacts contact details
from the public API.

**Therefore the export must not ship a "Contact" column implying reachability we do not
have.** Options, in order of honesty:
1. **Recommended:** ship `POC Name` (where present) + `SAM.gov entity link`, and label the
   column **"Identity for outreach"** — the buyer completes contact via SAM, which they are
   already entitled to do. State the limitation in the export header.
2. Omit contact entirely for v1 and say why.
3. ❌ Do NOT ship an empty "Email" column. A list of blanks reads as a broken product.

### "Why Matched" must be a real sentence
Not a score. Something a CO can put in the file: *"NAICS 336611 primary; 184 federal awards
totaling $102.7M; HUBZone; Washington."*

### "Office Award Observed?" — say what it means
Computed against **the awards in our sample**, not the complete contract file. Label it
honestly (`Not in sampled awards`, not `Never worked with PSNS`).

---

## 6. What ALREADY exists (don't rebuild)

| Asset | Path | Reuse |
|---|---|---|
| Supplier pool + tiers + certs | `src/lib/gov-buyer/market-research.ts` | ✅ `ScoredEntity` already carries **`cageCode`**, `uei`, `certifications`, `awardCount`, `totalObligated`, `registrationStatus` |
| Prior-awardee set (reach gap) | `src/lib/gov-buyer/acquisition-context.ts` | ✅ `getProcurementHistory()` returns incumbents — diff against the pool |
| Memo model + renderers | `src/lib/gov-buyer/memo-model.ts`, `memo-html.ts` | ✅ Add the outreach list as a memo section; CSV/XLSX is a third renderer |
| Auth gate | `requireGovBuyer` | ✅ |
| Entity detail | `sam_entities` (`cage_code`, `physical_city`, `points_of_contact`, `sam_url`) | ✅ `entity_url` is 100% null — use `sam_url` |

**Net-new is small:** a diff function, a CSV/XLSX renderer, one button, and the terminology pass.

## 7. Scope

**In scope (Gold Coast bridge):**
- [ ] §2 terminology correction across page + memo
- [ ] Reach-gap diff: pool minus sampled-award incumbents
- [ ] Grouped counts on the page (known / pool / not-in-sample / verified `?` / unknown `?`)
- [ ] `Export Supplier Outreach List` — CSV, columns per §5
- [ ] Qualification warning rendered prominently wherever the pool count appears

**Out of scope (deferred):**
- Stage 2 qualification data (clearances, facility certs, vessel experience)
- Stage 5 outreach-outcome capture + reason taxonomy
- Any CRM, email sending, or contact enrichment
- Sources-sought / industry-day workflow support

## 8. Acceptance criteria

- [ ] The word "capable" no longer describes a NAICS+past-performance score anywhere on the buyer surface
- [ ] Reach-gap groups reconcile: `known + not-in-sample = pool`
- [ ] Export opens cleanly in Excel; every row has Company, CAGE, Location, SB Status
- [ ] No column implies contact reachability we do not have
- [ ] `Unknown` appears for every unverified qualification — never a blank, never an assumption
- [ ] Export header carries the qualification + sampling caveats
- [ ] Runs on the PSNS case: 336611 / WA+OR → 80-firm pool, 4 known, 76 not in sample

## 9. Risks + open questions

| # | Risk | Owner |
|---|---|---|
| 1 | **Overclaiming capability.** The single biggest credibility risk on a shipyard floor. §2 is the mitigation and should ship even if nothing else does. | Product |
| 2 | Contact data does not exist in our SAM copy (measured: 0/20,000). Any "outreach list" framing must not promise reachability. | Claude |
| 3 | Reach gap is computed against a *sample* of awards, not the full contract file — a KO will test this. Label it, don't hide it. | Claude |
| 4 | Stage 5 is the real moat but needs a buyer willing to log outcomes. No customer has agreed to that yet. | Eric |
| 5 | Scope creep into CRM. The export is a file, not a pipeline. Hold the line. | Claude |

## 10. The Gold Coast ask (why this PRD is honest about being unfinished)

The conversation with Ashley is **not** "we solved this." It is:

> "We can already do the first half of the job: establish the supplier market, show the
> evidence behind it, identify firms you may not be reaching, and document that research for
> the acquisition file.
>
> The next question we're working on is market activation — which of those suppliers truly
> meet your shipyard-specific requirements, how do we reach them, and why aren't they
> bidding? We'd like to build that with acquisition teams rather than guess at what you need."

That is a design-partner ask. If she says *"yes, that's exactly what we struggle with,"* the
next government-side workflow has been validated by the person who does the job — a better
Gold Coast outcome than a claim that does not survive contact.

## 11. Decision log

- **2026-08-17** — PRD opened from the PSNS case. Framing locked: acquisition decision and market response are separate facts; never criticize the set-aside.
- **2026-08-17** — **Terminology correction adopted:** "capable" → "relevant supplier pool" / "market-qualified candidates" until requirement-specific qualification is verified. Rule-of-Two math unchanged.
- **2026-08-17** — Measured SAM contact data: 491,308 entities all carry `points_of_contact`, but 0 emails / 0 phones across a 20,000-record sample; 49% carry a name. Export will ship POC name + SAM link, never an empty Email column.
- **2026-08-17** — `entity_url` is 100% null; use `sam_url`.
- **2026-08-17** — Stage 5 (why-no-bid taxonomy) identified as the long-term moat but deferred — it needs a design partner, which is the Gold Coast ask.
- **2026-08-17** — Scoped to one bridge for Gold Coast: pool → not-in-sample → CSV export. Everything else deferred.

---

**Status:** ☑ **PRD only — do NOT execute yet** · ☐ Approved to build

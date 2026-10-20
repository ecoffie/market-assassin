# PRD: Market Research Workspace (Navy Conference Demo)

**Status:** ☐ PRD only — do NOT execute yet · ☐ Approved to build
**Owner:** Eric / Claude
**Written:** 2026-08-17
**Event context:** Navy Gold Coast, Aug 17–20 2026, San Diego Convention Center
**Parent PRD:** `docs/PRD-gov-buyer-market-research.md` (the auth model, activity rubric, and access gate this builds on)
**Companion:** `tasks/PRD-navy-gold-coast-demo.md` (the event/floor track)
**Source:** Eric's spec, 2026-08-17 — reproduced faithfully below; every deviation is flagged and justified.

---

## 0. What already shipped (read before scoping anything)

**A v1 of this surface already exists and is committed.** Discovered 2026-08-17 while
grounding this PRD — two commits landed today:

| Commit | What |
|---|---|
| `643fe10e` | `/gov/market-research` — the Gold Coast demo surface |
| `3e999389` | form-layout fix (the email field was unusable) |

| Asset | Path | State |
|---|---|---|
| Workspace page | `src/app/gov/market-research/page.tsx` | **Built** — 16KB, client component |
| Research API | `src/app/api/gov-buyer/market-research/route.ts` | **Built** — `runMarketResearch()` |
| **Memo export (.docx)** | `src/app/api/gov-buyer/market-research/export/route.ts` | **Built** — Rule-of-Two finding, tier table, methodology + caveats footnotes |
| Research engine | `src/lib/gov-buyer/market-research.ts` | **Built** |
| Gov-buyer auth gate | `src/lib/gov-buyer/auth.ts` (`requireGovBuyer`) | **Built** |
| Competition Health | `src/lib/analytics/competition-health.ts`, `competition-depth.ts` | **Built** |
| Observatory + methodology registry | `src/lib/analytics/observatory.ts`, `observatory-methodology.ts` | **Built** — OBS-001…009 |

The shipped v1 deliberately implements **one workflow, not six steps** — its own header
comment says so: *"Deliberately NOT the six-step workspace from the PRD. That is the
post-conference build."* It already honors the Observatory discipline this spec demands:
a `Stat` component renders **"Not measured"** rather than `0` for an undetermined value.

**Therefore this PRD is an EXTENSION spec, not a greenfield build.** The question it
answers is: *which of the six steps do we add, in what order, and which are already done?*

⚠️ **A parallel session created these files minutes before this PRD was written.** Confirm
no one else is mid-build on the same surface before starting work (Process rule #3b —
worktrees).

---

## 1. Goal

Build a **demo-quality Market Research Workspace** showing how Mindy helps acquisition
teams conduct market research **before** issuing a solicitation.

This is **not** a proposal writer. This is **not** another procurement dashboard. This is
the front-end experience for **acquisition planning**.

## 2. Philosophy

Government agencies are not buying "competition."
They are buying **better market research**.

- Competition is an **outcome**.
- Supplier Discovery is an **outcome**.
- Small Business Participation is an **outcome**.
- **Market Research is the workflow.**

The demo tells the story of a Contracting Officer, Small Business Specialist, Branch
Chief, or Program Manager preparing an acquisition.

## 3. Guiding principles

1. **Reuse existing systems.** The Workspace is an **orchestration layer** — no duplicate logic.
2. **DO NOT invent fake data.**
3. **DO NOT fabricate metrics.**
4. **A missing result is preferable to a misleading result.** Show `Unknown` / `Insufficient evidence`, never `0`.

**Existing assets to orchestrate:** Map · Opportunities · Contractor database ·
Observatory · Competition Health · Supplier Discovery · Market Intelligence · Research ·
OBS standards · Methodology.

## 4. User story

A Contracting Officer has a new requirement. Before writing the solicitation they must answer:

- Who can perform this work?
- Is there a viable small-business market?
- How competitive is this market?
- What happened on previous procurements?
- What contract vehicles exist?
- What agencies buy this?
- What does the supplier landscape look like?
- How should we document our findings?

Mindy assembles those answers into one workspace.

## 5. Navigation

`Government → Market Research Workspace`

## 6. Screen layout — the six steps

`Requirement · Supplier Market · Competition · Procurement History · Market Intelligence · Report`

### Step 1 — Requirement
Simple form. Fields: **Agency · Office · NAICS · PSC · Keyword · Estimated Value · POP ·
Description.** Button: **Analyze Market**.

> **Shipped today:** Requirement title, NAICS, place-of-performance (state), set-aside, email.
> **Gap:** Agency, Office, PSC, Keyword, Estimated Value, POP, Description.

### Step 2 — Supplier Market
Reuse the existing **Contractor Database**. Show: qualified suppliers · small businesses ·
8(a) · SDVOSB · WOSB · HUBZone · geographic distribution · supplier diversity · supplier
discovery · recent entrants.

**This should NOT be a search result. It should feel like an executive briefing.**

> **Shipped today:** market depth, capable depth, Rule-of-Two finding, tier breakdown
> (Active Performer / Capable / Emerging / Registered Only), certification counts, ranked firms.
> **Gap:** geographic distribution, recent-entrants cut, briefing-grade presentation.

### Step 3 — Competition
Reuse the existing **Competition Health** engine. Show: Competition Depth (**OBS-009**) ·
Supplier Reach · Average Offers · Single Bid Risk · Historical Competition · Small
Business Participation (**OBS-001**) · Competition Trend.

**Every metric links to its OBS methodology.** If insufficient evidence → show `Unknown`,
**not** `0`.

> **Engines exist** (`competition-health.ts`, `competition-depth.ts`; OBS-009 registered
> Beta, OBS-001 Production). **Not yet wired into this page.** ⚠️ OBS-009 is **Beta** —
> label it as such on screen; a KO will ask.

### Step 4 — Procurement History
Reuse the existing **award database**. Show: previous contracts · incumbents · award
amounts · historical bidders · previous NAICS · previous PSC · contract vehicles ·
related procurements.

> **Data exists** (`recompete_opportunities`, awards, IDV tables). **Not wired.**

### Step 5 — Market Intelligence
Reuse existing intelligence. Show: Industry Days · Sources Sought · RFIs · Forecasts ·
Recompetes · office buying activity · related opportunities.

**This should feel like Bloomberg. Not search.**

> **Data exists** (`sam_events`, forecasts, recompetes, DoDAAC office signal). **Not wired.**

### Step 6 — Market Research Summary
The page automatically assembles a briefing: Requirement Summary · Supplier Landscape ·
Competition Assessment · Small Business Assessment · Procurement History · Market Signals ·
Observatory Standards Referenced · Recommendations · **Export PDF**.

**This is NOT AI generated prose. It is structured. Grounded. Evidence-backed.** Every
statement cites existing Observatory metrics where applicable.

> **Shipped today:** `.docx` determination memo with Rule-of-Two finding, tier table, firm
> list, methodology + caveats. **Gaps:** the four narrative sections above (Competition,
> Procurement History, Market Signals, Observatory Standards Referenced), and **PDF**
> alongside `.docx`.

## 7. Research integration

Every metric includes: **OBS ID · current maturity · methodology · last measured.**
Never fabricate. If unavailable, state `Unknown` or `Insufficient evidence`.

> `observatory-methodology.ts` already carries id, name, dataSources, limitations, and
> versionHistory per metric — the registry is the source; the page renders it.

## 8. Demo flow

| Minute | Beat |
|---|---|
| 1 | Enter requirement |
| 2 | Analyze Market |
| 3 | Supplier Market appears |
| 4 | Competition section appears |
| 5 | Procurement History |
| 6 | Market Intelligence |
| 7 | Generate Market Research Summary |

## 9. Existing components to reuse

Competition Health · Observatory · Research · Contractor Database · Award History ·
Forecasts · Recompetes · Supplier Discovery · Opportunity Intelligence.

**No duplicate logic. Only orchestration.**

## 10. Government story

Do **not** position this as software. Position it as a **Market Research Workspace
supporting acquisition planning**, helping agencies understand markets · discover
suppliers · assess competition · increase small business participation · support
acquisition strategy.

## 11. Future vision

Contractors have **Proposal Workspace**. Government has **Market Research Workspace**.
Together they complete the procurement lifecycle:

`Before Solicitation → Market Research Workspace → Supplier Discovery → Solicitation →
Competition Health → Award → Observatory → Research`

This becomes the **government side of the Mindy platform**.

## 12. Success criteria

A Navy Contracting Officer watches the demo and says:

> **"This is exactly the work I already have to do."**

Not: *"Interesting dashboard."*

Acquisition professionals should immediately recognize that Mindy fits the market research
process they already perform, while dramatically reducing the time to gather evidence and
document findings.

---

## 13. Build plan — what's left, and how hard each actually is

Ordered by demo value per unit of work. Steps 1/2/6 partially ship today.
**Difficulty verified 2026-08-17 by reading the actual engine signatures** — not estimated
from names. One item (P1) is materially harder than it looks; see the scope-mismatch note.

| # | Deliverable | Difficulty | Est. | Why that rating |
|---|---|---|---|---|
| **P4** | **Expand Step 1** — Agency, Office, PSC, Keyword, Est. Value, POP, Description | 🟢 **Easy** | 0.5 day | Pure form work. Fields are display/passthrough; only Agency actually needs to reach a query (it unlocks P1). |
| **P3** | **Market Intelligence (Step 5)** — industry days, sources sought, RFIs, forecasts, recompetes, office activity | 🟢 **Easy–Medium** | 0.5–1 day | `src/lib/events/query.ts` already exports `queryFederalEvents`, `queryScopedEvents`, `eventsSummary`, `queryBuyerEventDna`. `/api/app/target-market-research` is a working analog that already joins USASpending + pain points + `sam_opportunities` + `sam_events`. Mostly call-and-render. |
| **P2** | **Procurement History (Step 4)** — prior contracts, incumbents, amounts, vehicles | 🟡 **Medium** | 1 day | Data is all in `recompete_opportunities` (53 cols: incumbent, values, PIID, NAICS/PSC, dates). No new engine — but `market-research.ts` currently only touches `sam_entities`, so this is a genuinely new query path. Apply the value-corruption guard. |
| **P6** | **Executive-briefing polish on Step 2** — geographic distribution, recent entrants, briefing layout | 🟡 **Medium** | 1 day | Data ships already (tiers, certs, ranked firms). This is design work — turning a result list into a briefing — which is the ask most likely to need 2–3 iterations. |
| **P5** | **Extend the memo (Step 6)** — Competition, Procurement History, Market Signals, OBS-Referenced sections + **PDF** | 🟡 **Medium** | 1–1.5 days | The `.docx` builder exists and is well-structured; adding sections is mechanical **once P1–P3 supply the data** (hard dependency). PDF is a second renderer, not a reformat — budget for it separately. |
| **P1** | **Wire Competition (Step 3)** — OBS-009 depth, avg offers, single-bid risk, SB participation | 🔴 **Hard** | 2–3 days | **Scope mismatch — see below.** Not a wiring job. |

### ⚠️ P1 is the hard one — the scope mismatch

The Workspace is **NAICS-scoped**. The competition engines are **agency-scoped**:

- `computeCompetitionDepth(agency, sampleSize)` — takes an **agency**, live-samples ~60 awards from **USASpending's per-award detail endpoint**, 24h cached.
- `computeCompetitionHealth(supabase, agency, windowDays)` — also **agency**-keyed.

Three consequences:

1. **The form has no agency field yet.** P1 depends on P4 shipping first.
2. **`resolveToptier()` refuses unmapped agencies by design** — returns `resolved:false` and withholds rather than risk sampling the wrong buyer's awards. Only ~14 agencies are in the dictionary plus a `"X, DEPARTMENT OF"` pattern. **Navy resolves** (`DEPT OF DEFENSE` is mapped; verify the exact string the form passes).
3. **A NAICS-scoped competition number does not exist today.** Asking "how competitive is *this market*" rather than "*this agency*" is a **new engine**, not a wiring task. For the demo, present it honestly as agency-level competition — which is what a CO is graded on anyway — and don't imply it's NAICS-specific.

Also: it's a **live external sample** (~60 USASpending calls on a cold cache). On conference
wifi that is the single most likely thing to stall on stage. Warm the cache before demoing.

**Good news:** both engines already implement the honesty contract — `grounded:false`,
`avgBidders: null`, `MIN_SAMPLE = 12`, and awards without an offers field excluded from the
denominator rather than coerced to 0. That matches the `Stat` "Not measured" rule exactly,
so no new discipline is needed on the render side.

### Recommended order

**P4 → P3 → P2 → P1 → P5 → P6.**

P4 first because P1 depends on it. P3 before P2 because it's cheaper and the "Bloomberg,
not search" beat lands harder. P1 mid-sequence so its difficulty can't sink the earlier
wins. P5 last of the functional work — it consumes everything upstream. P6 is polish and
the safest cut if time runs out.

**~6–8 days of focused work for all six.** A credible 7-minute demo needs **P4 + P3 + P2
(~2.5 days)**; P1 is what makes it *impressive* rather than merely complete.

### Deferred by the parent PRD — NOT in scope here

`docs/PRD-gov-buyer-market-research.md` §2 already ruled these out as creep guards, and
this PRD does not reopen them: full federal-employee directory enrichment · real-time SAM
cross-checks per row · multi-tenant agency accounts / SSO · buyer-side saved searches,
alerts, or CRM · capability-statement authoring for buyers · the 4 non-KO roles.

## 14. Acceptance criteria

- [ ] All six sections render for a real NAICS/agency, no placeholder copy
- [ ] **Zero fabricated numbers** — every figure traces to a query or renders `Unknown`
- [ ] **No metric renders `0` for "undetermined"** (the shipped `Stat` rule holds everywhere)
- [ ] Every OBS metric shows **id + maturity + last-measured** and links to methodology
- [ ] **OBS-009 is visibly labeled Beta**
- [ ] Memo exports with all six sections; **PDF and .docx** both work
- [ ] Full flow completes in **≤7 minutes** live, unrehearsed
- [ ] Gov-buyer gate holds — a seller account gets 403 + redirect, not a blank page
- [ ] Runs clean on a **conference network** (see risk #4)

## 15. Risks + open questions

| # | Risk / question | Owner |
|---|---|---|
| **1** | **Duplicate build in flight.** Files appeared minutes before this PRD. Confirm no parallel session owns this surface. | **Eric — blocking** |
| **2** | **OBS-009 is Beta.** Presenting Beta competition data to KOs without labeling it invites exactly the challenge that kills credibility. Label it. | Product |
| 3 | **"Insufficient evidence" will appear often** for narrow NAICS. That's correct behavior but reads as emptiness — pre-pick demo NAICS with dense data, and let a sparse one appear once *on purpose* to prove the honesty. | Eric |
| 4 | **Conference wifi.** A live multi-engine page over hotel network is a real failure mode — need a recorded fallback. | Eric |
| 5 | **Gov-buyer auth on the floor.** `requireGovBuyer` gates it; a walk-up CO has no account. Decide: pre-provisioned demo account vs. a public read-only view. | **Eric — decision needed** |
| 6 | Scope creep back into the six-step build before the conference. The shipped v1 chose one workflow deliberately; adding P1–P3 mid-week risks breaking a working demo. | Claude |
| 7 | No Navy-specific cut yet — Gold Coast is a Navy room. Pre-filtering to Navy agency/office would sharpen it (2,282 Navy recompetes measured; see companion PRD). | Product |

## 16. Decision log

- **2026-08-17** — PRD authored from Eric's spec. Positioning locked: acquisition-planning workflow, **not** software, **not** a proposal writer.
- **2026-08-17** — Discovered `/gov/market-research` v1 already shipped (`643fe10e`, `3e999389`). PRD reframed **greenfield → extension**.
- **2026-08-17** — Confirmed shipped v1 already honors the no-fake-zero rule (`Stat` renders "Not measured"). Adopted as the standard for all six steps.
- **2026-08-17** — Critical path set at **P1 Competition → P2 Procurement History → P3 Market Intelligence** — the three pure-gap narrative beats.
- **2026-08-17** — OBS-009 confirmed **Beta** in `observatory-methodology.ts`; on-screen Beta labeling made an acceptance criterion.
- **2026-08-17** — Difficulty re-verified against real engine signatures. **P1 upgraded ~1 day → 2–3 days (Hard):** competition engines are agency-scoped, the Workspace is NAICS-scoped, and a NAICS-level competition metric is a new engine, not a wiring job. Build order changed to **P4 → P3 → P2 → P1 → P5 → P6** (P1 now depends on P4 supplying an agency field).

---

**Status:** ☑ **PRD only — do NOT execute yet** · ☐ Approved to build

*Blocking on open questions #1 (parallel build) and #5 (floor auth) before work begins.*

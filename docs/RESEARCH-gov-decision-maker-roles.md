# Research: Sourcing Real Government Roles & Offices for Decision Makers

> Can we get the actual ROLE (Contracting Officer vs Program Manager vs end
> user) and the contracting OFFICE for the people in the Decision Makers tab?
> Scoping doc — grounded in real data probes (2026-06-04), not speculation.

**Status:** Research / scoping. No build.
**Trigger:** Eric, reviewing the Decision Makers tab: "Title says 'Primary
Contact' — what's his role? Office column is empty, DoD is too broad. Do we
have to scrape this?"
**Related:** `docs/PRD-gov-buyer-market-research.md` §7 (the "5 BD roles" gap);
the `federal_contacts` table + `GovDecisionMakersPanel`.

---

## 1. The problem, restated

The Decision Makers tab shows ~112K SAM points-of-contact. Two gaps:
- **Role:** ~25% of titles are the generic "Primary/Secondary Contact" SAM POC
  designation; only ~700 of 112K have a real role ("Contracting Officer"); the
  rest is noise ("MR", "GM", "NONE"). Users can't tell a CO from a clerk.
- **Office:** the broadest filter is agency (DoD = ~20K contacts). For the
  federal agencies, the `office`/`sub_tier` fields are **0% populated** — the
  contracting office isn't in the POC data.

The original PRD called these the "5 BD roles" (decision maker, program
manager, engineer, end user, contracting officer) — and flagged that SAM POCs
only ever yield the contracting officer, and unreliably at that.

---

## 2. What the data probes established (2026-06-04)

### ❌ SAM Opportunities POC has NO role — it's null AT THE SOURCE
The live SAM Opportunities API `pointOfContact` object:
```json
{ "type": "primary", "fullName": "Tom Baldauff", "email": "...", "title": null }
```
`title` is **null** from SAM itself. This is *why* `federal_contacts` shows
"Primary Contact" — it's the POC `type`, not a role. **There is no role to
extract from this source.** No amount of re-parsing our own data fixes it.

### ❌ FPDS / USASpending awards data has NO contracting officer name
The BQ `awards` table (63M rows) has 51 columns. The only person-name fields
are `exec_1_name`…`exec_5_name` — the **contractor's** executives, NOT the
government contracting officer. FPDS does not publish the CO name in this feed.
**Ruled out as a role source.**

### ✅ FPDS / awards DOES carry the contracting OFFICE — 100% populated
`awards.awarding_office` + `awarding_office_code` are present and rich:
- Booz Allen: 58,350 awards, **100% have awarding_office**, **572 distinct offices**.
This is the real contracting-office data the POC dataset lacks — it's just in
a different table (awards, keyed by award/agency), not in `federal_contacts`.

---

## 3. Findings → what's actually possible

| Want | Source | Verdict |
|---|---|---|
| **Office drill-down** (DoD → NAVSEA → …) | `awards.awarding_office` | ✅ **Viable.** 100% populated, 572 offices for one prime. Not in POC data but joinable. |
| **Contracting Officer name per award** | FPDS / USASpending | ❌ Not in the feed (no CO name field). |
| **Contracting Officer name per solicitation** | SAM Opportunities POC | ⚠️ Only the POC *name* — `title` is null, so we can't confirm they're the CO vs a clerk. |
| **Program manager / engineer / end user** | None of the above | ❌ No public structured source. |

**The blunt conclusion:** real *roles* are not available from any structured
federal feed we can pull. The contracting *office*, however, IS available
(from awards) and is the higher-value, achievable win.

---

## 4. Options (ranked by value/effort)

### Option A — Office drill-down from awards data (RECOMMENDED, achievable)
Reframe the tab from "decision-maker roles" (which the data can't support) to
"contracting offices + their POCs" (which it can).
- Build an **agency → office** drill-down from `awards.awarding_office`
  (pre-aggregate per agency, like the contractor rollup, to stay cheap).
- Optionally join POC contacts to offices via solicitation number (the
  `solicitation_number` on `federal_contacts` encodes the office in its prefix,
  e.g. `FA2371…` = an Air Force command — decoding is a sub-project).
- **Value:** answers the "DoD is too broad" complaint with real data.
- **Effort:** medium. Quota-aware (rollup, not raw awards scan).

### Option B — "Has a real role" filter (cheap, honest, partial)
- Surface only the ~700 contacts with a genuine role title (Contracting Officer,
  Contract Specialist, PM). A small but high-quality "who's actually a CO" list.
- **Value:** modest (small set), but immediately useful + honest.
- **Effort:** trivial (already have `normalizeTitle`).

### Option C — Commercial enrichment for roles (real roles, $$)
- Providers (GovTribe/HigherGov-grade, or LinkedIn-style enrichment) DO have
  program managers, technical leads, titles. This is how competitors get the
  "5 roles."
- **Value:** high — the actual feature the tab name promises.
- **Effort / cost:** significant — licensing + ingestion. A buy decision, not
  a build. Out of scope until the tab proves demand.

### Option D — Scrape agency org charts / GSA directories (brittle)
- Some agencies publish staff directories. Inconsistent, per-agency scrapers,
  high maintenance, partial coverage.
- **Verdict:** not worth it vs. Option C's commercial data.

---

## 5. Recommendation

1. **Now (cheap, honest):** keep the shipped honest-titles fix (Role/POC column,
   no fake roles). Optionally add Option B ("has a real role" filter).
2. **Next (achievable, real value):** Option A — office drill-down from
   `awards.awarding_office`. This directly fixes "DoD is too broad" with data we
   own, and it's the legitimate version of the office feature.
3. **Later (buy decision):** Option C — commercial role enrichment, only if the
   tab earns demand. That's the only path to true PM/engineer/end-user roles.

**Do NOT:** keep trying to extract roles from SAM POC / FPDS data — the probes
prove the role field is null at the source. The honest move is to stop
promising roles the data doesn't have, deliver office (which it does), and
treat real roles as a future buy.

---

## 6. Decision log
| Date | Finding | Source |
|---|---|---|
| 2026-06-04 | SAM Opportunities POC `title` is null at source | live SAM API probe |
| 2026-06-04 | FPDS/awards has no CO name (only contractor execs) | BQ awards schema |
| 2026-06-04 | `awards.awarding_office` 100% populated, 572 offices/prime | BQ probe (Booz Allen) |
| 2026-06-04 | Office drill-down is the achievable win; real roles need commercial data | this doc |

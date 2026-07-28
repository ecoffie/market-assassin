# PRD — Contractor Capability Profiles (what a company is *good at*, from award history)

**Author:** Eric Coffie (w/ Claude)
**Date:** 2026-07-28
**Branch:** `feat/contractor-capability-profiles`
**Status:** Draft for sign-off

---

## 1. Problem

When a Mindy user looks for a **teaming partner or subcontractor**, they get raw codes and
counts. `ContractorsPanel` shows award totals, a contract count, an "Active performer" badge
at ≥50 awards, and a truncated `NAICS: 541512, 541519, …` string. Nothing tells them **what
the company is actually good at**.

So the user has to do the inference themselves — read a list of NAICS codes and guess whether
this firm can do electrical installation on a Navy base. That's the job Mindy should do.

The data to answer it already exists and is *excellent* (§3). The gap is that nothing turns
"they won 9 awards under PSC N059 for DoD" into **"installs electrical/electronic equipment
for DoD — 9 awards, $8.2M, small-business set-aside winner."**

### Why this matters commercially
Partner discovery is the wedge in the First Partner Challenge and the whole teaming narrative.
Today the in-product answer is either the opportunity-map subcontract drawer (NAICS+state
overlap only) or a **manual CRM** (`ContactsPanel`) the user types into themselves.

---

## 2. Reuse check (rule #14 — adopt, don't invent)

Measured by codebase audit 2026-07-28. **More exists than expected; do not rebuild these.**

| Asset | Path | Verdict |
|---|---|---|
| **Award-history capability SCORING** | `src/lib/bigquery/recipients.ts:557` `findCapableSmallBusinesses()` | **ADOPT.** Already scores PSC-exact 100 / PSC-family 60 / NAICS 40 / +20 set-aside / +min(award_count,20), and returns a human `match_reason`. This is the matching engine — we are adding the *profile*, not replacing the score. |
| Per-contractor aggregators | `recipients.ts` — `getTopNaicsForRecipient`, `getTopAgenciesForRecipient`, `getRecentAwardsForRecipient`, `getYearlyTotalsForRecipient`, `getSimilarRecipients` | **ADOPT** as the fact source. |
| Capability embedding pattern | `src/lib/alerts/capability-vector.ts` (+ `20260706_capability_vector_notification_settings.sql`) | **ADOPT THE PATTERN** (OpenAI `text-embedding-3-small`, 1536-dim jsonb, `*_source_hash` + `*_embedded_at` for resumability). **Note: today it embeds OUR USERS, not third-party contractors** — that's the gap Phase 3 fills. |
| Live partner discovery | `src/lib/opportunities/cross-sell.ts:149` `findSubcontractTargetsTiered` | **ADOPT + enrich.** Powers the opportunity-map drawer today (4-tier NAICS+state ladder). We add a "why this partner" line, not a new surface. |
| Chat/MCP tool | `src/lib/chat/tier2-tools.ts:67` `find_capable_contractors` (20 credits) | **ADOPT.** Extend its output with the profile. |
| Teaming CRM | `src/app/api/teaming/route.ts` + `ContactsPanel.tsx` | **ADOPT** as the save target ("Save as partner"). |
| Subaward prime↔sub graph | `src/app/api/teaming-intel/route.ts` + `src/lib/sam/subaward-api.ts` | **SALVAGE (Phase 4).** Real relationship data (subs-for / primes-for / network / "primes you don't yet work with"), **zero callers and NO auth**. Best unexploited raw material here. Must be auth-gated before any use. |

### Dead code — do NOT revive
- `src/app/api/teaming/suggest/route.ts` — scores `src/data/contractors.json`, a **static 2,768-row file dated Dec 2025**. Zero callers, no auth. Violates rule #1 (ground in real data). **Delete or leave; never wire.**
- `src/app/api/lindy/match/route.ts` — zero callers.

---

## 3. Measured feasibility (rule: measure BEFORE you build)

BigQuery `market-assasin.usaspending.awards`, 22.2M rows FY2023+. Total measurement cost ≈ **$0.04**.

### Field quality — excellent
| Field | Coverage (FY2023+) |
|---|---|
| `psc_code` | **99.998%** |
| `psc_description` | **99.998%** |
| `naics_code` | 99.995% |
| `description` (free text) | 99.99% |

`psc_description` / `naics_description` were **missed in the first audit pass** — they are
human-readable service labels present on essentially every row. **This is the capability
vocabulary, already structured. It is the core of this feature.**

### ⚠️ The finding that drives the design: free-text `description` is NOT usable as capability signal
Median length **35 chars**. Highest-volume values are boilerplate:
- `"FEDERAL SUPPLY SCHEDULE CONTRACT"` — 16,249 rows
- `"PAPER, TOILET: - SEE ATTACHED DOCUMENT FOR DETAIL."`
- `"SEAPORT-NXG"` (a vehicle name, not a capability)

And it is frequently **contradictory** to the coded fields: nitrile gloves filed under PSC
*"FLOOR POLISHERS AND VACUUM CLEANING EQUIPMENT"*.

**Consequence:** an LLM summarizing `description` would emit confident nonsense
("specializes in floor polishers" for a glove distributor). **DECISION: facts come from the
coded/aggregate fields. Free text is at most a weak tiebreaker, never a stated fact.**
This is rule #1 applied literally — the LLM labels and writes; the data supplies facts.

### The specialist signal is strong (the actual differentiator)

**⚠️ CORRECTED 2026-07-28 after the Phase-1 build — the basis matters, a lot.**

First measurement, per **raw UEI**, FY2023+, **no award-count floor** (126,596 contractors):

| Segment | Count | Share |
|---|---|---|
| Specialist (≥80% of $ in one PSC) | 88,045 | 69.6% |
| Focused (50–80%) | 25,354 | 20.0% |
| Diversified (<50%) | 13,197 | 10.4% |

That 69.6% is **inflated by one-off filers**: a UEI with a single award is trivially 100%
concentrated. Re-measured on the basis the build actually uses — per **rollup company**
(subsidiaries merged), FY2021+, **≥3 awards** — the real distribution is:

| Segment | Share (71,101 rollups) |
|---|---|
| Specialist (≥80%) | **44.5%** |
| Focused (50–80%) | **31.8%** |
| Diversified (<50%) | **23.7%** |

Cross-checked per-UEI on the *same* basis (FY2021+, ≥3 awards, 80,646 UEIs): 45.2 / 31.7 /
23.1 — within ~1pp of the rollup build, which confirms the scorer is right and the difference
is purely the population definition, not a bug.

**Still the right differentiator:** 44.5% of real, repeat-winning companies concentrate ≥80%
of their dollars in ONE product/service code, and 76% are at ≥50%. "Specialist vs generalist"
is computable and defensible. Just never cite 69.6% — it measures single-award shells.

### Backfill scope (drives Phase 1 sizing)
| Population | Count |
|---|---|
| `recipients_rollup_merged` total | 292,848 |
| Active FY2024+ (`last_action_date >= 2023-10-01`) | 131,223 |
| ≥3 awards | 150,138 |
| **Active AND ≥3 awards** | **95,184** |
| Distinct UEIs w/ FY2023+ awards | 126,596 |

### Real output, from aggregates alone (no LLM) — CHINOOK SYSTEMS INC, FY2025
```
N059  INSTALLATION OF EQUIPMENT- ELECTRICAL AND ELECTRONIC   9 awards  $8,232,344  DoD
R499  SUPPORT- PROFESSIONAL: OTHER                           3 awards  $7,097,090  GSA, DoD  [SB set-aside]
J059  MAINT/REPAIR/REBUILD- ELECTRICAL AND ELECTRONIC        2 awards  $4,232,966  DoD
```
→ **"Electrical & electronic equipment installation and maintenance for DoD · 14 awards ·
$19.5M FY2025 · small-business set-aside winner"** — every token traceable to a column.

### Cost discipline (non-negotiable)
`tasks/bigquery-cost-spike-2026-06.md` documents a **$2,075 spike**. `queryCached` defaults
`cacheOnly: true`; callers must opt into `liveBq: true`; `maximumBytesBilled` capped at 5GB.
**Therefore: profiles are built by a BATCHED aggregate job, never per-request live queries.**
(During this PRD's own measurement the 3GB guard correctly refused a 4.86GB query — the guard works.)

---

## 4. Scope

### In scope
1. `contractor_capability_profiles` — one row per rollup UEI, batch-built.
2. Derived capability labels + specialist/generalist score, grounded in `psc_description`.
3. Per-contractor capability **embeddings** for semantic partner matching.
4. Partner-finder **UI** + enriched MCP tool output.

### Explicitly deferred (label "coming")
- Complementary-gap matching ("who covers what I *can't* do") — needs Phase 3 embeddings first.
- Subaward relationship graph surfacing (Phase 4 salvage of `teaming-intel`).
- Non-federal / SLED capability data.

### Non-goals
- **No LLM-generated capability claims from free-text `description`.** See §3.
- No scraping company websites for self-described capabilities.
- Not replacing `findCapableSmallBusinesses` scoring.
- No per-request BigQuery reads on any user-facing path.

---

## 5. Target model

```
contractor_capability_profiles          (Supabase, batch-written from BQ)
  rollup_uei            text primary key
  rollup_name           text
  -- FACTS (all from coded BQ fields; never inferred)
  top_pscs              jsonb   -- [{code, description, awards, obligated, share}] top 5
  top_naics             jsonb   -- [{code, description, awards, obligated}] top 5
  top_agencies          jsonb   -- [{agency, awards, obligated, share}] top 5
  set_asides            text[]  -- distinct real set-aside values won
  award_count           int
  total_obligated       numeric
  first_award_date      date
  last_award_date       date
  fy_totals             jsonb   -- {2023: n, 2024: n, 2025: n} → trend
  -- DERIVED (computed, deterministic, explainable)
  specialty_score       numeric -- top PSC $ share, 0..1
  specialty_tier        text    -- 'specialist' | 'focused' | 'diversified'
  agency_concentration  numeric -- top agency $ share
  capability_label      text    -- e.g. "Electrical & electronic equipment installation"
  capability_summary    text    -- one line, template-composed from the facts above
  -- EMBEDDING (Phase 3)
  capability_embedding      jsonb   -- number[1536], text-embedding-3-small
  capability_embed_source_hash text -- sha1(meaning blob) → skip unchanged
  capability_embedded_at    timestamptz
  built_at              timestamptz
```

`capability_label` / `capability_summary` are **template-composed from real aggregates**, not
free-form LLM output. An LLM may later *polish phrasing* (Phase 2b, optional) but may never
introduce a fact absent from the columns.

---

## 6. Phases (each independently shippable + provable)

### Phase 1 — Facts table + batch builder (the foundation)
- BQ aggregate query → `contractor_capability_profiles` (facts columns only).
- **Scope: the 95,184 active-AND-≥3-award rollups first** (not all 292,848). Dormant
  single-award shells produce noise, and this is ~1/3 the volume. Expandable by config.
- Local `tsx` runner (rule #7: >1000 rows → local runner, not HTTP cron in a loop),
  resumable via `built_at`.
- Hand-run Supabase migration (rule #6: no in-app DDL).

### Phase 2 — Derived labels + specialist scoring
- `specialty_score` / `specialty_tier` / `agency_concentration` (deterministic).
- `capability_label` from top `psc_description`, cleaned (PSC descriptions are SHOUTY —
  "INSTALLATION OF EQUIPMENT- ELECTRICAL…" needs title-casing + de-jargoning via a
  curated map, not an LLM).
- `capability_summary` template. **Ship visible value here**: surface on
  `ContractorsPanel`, the contractor SEO pages, and as a "why this partner" line on the
  existing subcontract drawer.

### Phase 3 — Capability embeddings (semantic matching)
- Reuse `capability-vector.ts` pattern keyed on `rollup_uei`.
- Meaning blob = PSC/NAICS descriptions + agencies + set-asides (NOT free-text description).
- Resumable drainer w/ `capability_embed_source_hash`; OpenAI `text-embedding-3-small`.
- **Cost gate:** measure spend on a 1,000-row sample and report before the full run
  (95K × ~120 tokens ≈ well under budget, but prove it, don't assume).

### Phase 4 — Partner-finder surface
- New panel (or extend `ContractorsPanel`): search by capability, filter by
  specialty_tier / set-aside / state / agency; "Save as partner" → existing
  `/api/teaming` CRM.
- Extend `find_capable_contractors` MCP output with the profile (mirror rule: if it feeds
  Mindy, expose it as an MCP tool).
- **Auth-gate and salvage `teaming-intel`** for prime↔sub relationships.

---

## 7. Acceptance criteria

**Phase 1**
- [ ] Migration run; all columns verified present before use.
- [ ] ≥95,000 rows written; spot-check 10 contractors against a live BQ query — top PSC,
      award count, and obligated **match exactly**.
- [ ] Total build BQ cost measured and reported; single build stays under a stated ceiling.
- [ ] Zero per-request BQ reads introduced on any user path.

**Phase 2**
- [ ] Specialist distribution reproduces §3's CORRECTED figures — **~44.5% / 31.8% / 23.7%
      ±2pp** on the build basis (rollup, FY2021+, ≥3 awards). Do NOT test against the
      original 69.6% — that measured single-award shells, not real companies.
- [ ] 20 hand-reviewed labels: every claim traceable to a column; **zero** invented facts.
- [ ] Visible on `ContractorsPanel` + verified rendered (not just API 200).

**Phase 3**
- [ ] Sample-of-1000 embedding cost reported BEFORE the full run.
- [ ] Re-run with unchanged data re-embeds **0** rows (hash guard works).
- [ ] Semantic search returns a sane top-10 for 5 hand-checked capability queries.

**Phase 4**
- [ ] Panel renders real profiles; "Save as partner" round-trips to `user_teaming_partners`.
- [ ] `teaming-intel` **auth-gated** (it currently has none) or left disabled.
- [ ] MCP tool returns the profile; `_meta` reports shown/available.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| **LLM invents capabilities** | Facts are template-composed from columns. Free-text `description` excluded by design (§3). |
| **BigQuery cost spike** | Batch build only; `maximumBytesBilled`; dry-run estimate before each build; no per-request reads. Precedent: $2,075 spike. |
| PSC descriptions read as jargon | Curated cleanup map + title-casing; hand-review 20 before shipping. |
| Stale profiles | `built_at` + monthly rebuild aligned to the existing monthly rollup builds. |
| Specialty mislabels a legit generalist | Three tiers, not a binary; show the actual $ share so the user sees the evidence. |
| Scope creep to 292K rollups | Config-driven population; start at 95,184 active-and-proven. |

---

## 9. Defer-or-execute

**Execute now:** Phases 1–2 (facts + labels). They stand alone, are cheap to verify, ship
visible value on surfaces that exist today, and de-risk the framing before any embedding spend.

**Execute next, same build:** Phase 3 (embeddings) — this is what makes it *robust* rather
than a code rollup; it unlocks semantic and complementary-gap matching. Gated on the Phase-2
labels reading well and the sampled cost check.

**Then:** Phase 4 (partner-finder UI + `teaming-intel` salvage).

# Mindy Data Core Census — Phase 0B

**Status: AUDIT ONLY — no fixes applied, no production data changed.**
**Date: 2026-09-12 · Scope: unregistered served artifacts from Phase 0A**
**Taxonomy: the Phase 0A frozen taxonomy, applied unchanged.**

> A Green inferred from weak evidence is more dangerous than a Grey that
> honestly says "not proven."

---

## Executive Summary

| Metric | Count |
|---|---|
| Candidates triaged (Pass 1) | 23 |
| Material (customer/CO/alert sees a number or name) | 12 |
| Not material — admin/script-only | 4 |
| Not material — inert reference geometry/codes | 6 |
| Zero-consumer (dead) | 1 |
| — 🟢 GREEN | 2 |
| — 🟡 YELLOW | 4 |
| — 🔴 RED | 2 |
| — ⚪ GREY | 4 |
| Deep traces performed | 2 (`contractors.json`, `agency-sat-friendliness.json`) |
| New failure classes | 1 (class 15 — see below) |
| **Fixes applied** | **0** |

### Answer: does the Phase 0A pattern persist?

**Yes, and it broadens.** Phase 0A found metadata contradicting artifacts inside
a registry. Phase 0B finds the same class **outside** any registry, plus a new
one: **a hardcoded coverage claim in code** (`registry.ts` asserts
`coveragePercent: 95` for Contractors while the served artifact's contact fields
are 1.2–2.6% populated).

Phase 0B also discovered a **third registry surface** nobody has reconciled:
`src/lib/data-sources/registry.ts` — a hand-maintained TypeScript array with its
own `recordCount` values, independent of both `data_sources` (Supabase) and
`DATA-SOURCES-REGISTRY.md`. Three registries, none authoritative over the others.

---

## ⚠️ Measurement correction carried from Phase 0A

**Phase 0A's consumer counts were substring matches and are not reliable for
classification.** Re-measured here by *import resolution* with comments stripped:

| Artifact | Phase 0A (substring) | Comment-stripped substring | **Import-resolved (used here)** |
|---|---|---|---|
| `contractors.json` | 253 | 190 | **9** |
| `agency-pain-points.json` | 17 | 14 | 13 |
| `contracts-data.json` | 6 | 4 | 1 |

`contractors` matched the *word* "contractors" across a GovCon codebase — it is
in nearly every file. **The "253 consumers" figure in Phase 0A is wrong and is
corrected to 9 here.** Phase 0A's document is frozen and not edited; this is the
correction of record.

This is amendment **A1 generalized**: a bare identifier match establishes neither
consumption *nor* count. Only a resolved import does.

---

## Triage Table (Pass 1 — all 23 candidates)

Consumers = import-resolved, comment-stripped. `cust` excludes `/api/admin/` and `scripts/`.

| Dataset | Importers (cust/admin) | Customer-visible use | Candidate producer | Registry presence | Status | Evidence |
|---|---|---|---|---|---|---|
| `contractors.json` | 9 (6/3) | `/contractors` index (SEO), teaming suggest, DSBS benchmark | **NONE** | none (3 registries, 0 rows) | 🔴 RED | Deep trace §1 |
| `agency-sat-friendliness.json` | 3 (2/1) | **SAT badges in alert emails** | **NONE** | flagged "opinion-based" in doc only | 🔴 RED | Deep trace §2 |
| `agency-aliases.json` | 8 (8/0) | agency name resolution across app | unknown | none | ⚪ GREY | 454 aliases/25 CGAC; last commit 2026-08-01; no writer found; missing: producer + source authority |
| `naics-codes.json` | 8 (5/3) | NAICS labels app-wide | `scripts/build-naics-cache.js` ✅ | none | 🟢 GREEN | Writer proven: `build-naics-cache.js:34` `OUTPUT_PATH=src/data/naics-codes.json`; 1,741 codes; official OMB taxonomy (annual, not perishable) |
| `psc-codes.json` | 5 (4/1) | PSC labels, crosswalk | `scripts/build-psc-cache.js` ✅ | none | 🟢 GREEN | Writer proven: `build-psc-cache.js:31`; 2,397 codes; official GSA taxonomy |
| `prime-contractors-database.json` | 5 (4/1) | SBLO tier-2 fallback, TMR, market overview | `scripts/import-sblo-refresh.js` (importer, not producer) | partial via `tier2_sblo` | 🔴 RED (Phase 0A) | Carried from Phase 0A; `sbloVerified` 0/3,502 |
| `agency-pain-points.json` | 13 (8/5) | pain points, target enrichment | `merge-agency-intelligence.js` ✅ | registered | 🔴 RED (Phase 0A) | Carried from Phase 0A (stamp 2026-08-01 vs data 2026-04-19) |
| `psc-naics-crosswalk.json` | 2 (1/1) | alert keyword/PSC expansion | unknown | none | ⚪ GREY | 153 naicsToPsc / 595 pscToNaics; last commit 2026-03-12; missing: producer + derivation method |
| `federal-events-sources.json` | 3 (3/0) | event source list | unknown (curated) | none | 🟡 YELLOW | 30 sources/10 categories/12 conferences; config-like, honestly scoped; manual by design |
| `tribal-businesses-database.json` | 1 (1/0) | tribal 8(a)/HUBZone lookup | unknown | doc mentions, no `data_sources` row | ⚪ GREY | 800 tribes; **frozen since 2025-12-27** (1 commit); missing: producer + source vintage |
| `tier2-contractors-database.json` | 2 (1/1) | prime-contractor utils, SEO candidates | unknown | **name collides with `tier2_sblo` key** | ⚪ GREY | 207 records; frozen 2025-12-27; relationship to `tier2_sblo`/roster UNKNOWN |
| `agency-spending-complete.json` | 2 (1/1) | agency spend reference | unknown | none | 🟡 YELLOW | 250 agencies/4 vehicle types; last 2026-04-05; superseded in practice by live USASpending |
| `agency-forecasts-database.json` | 1 (1/0) | forecast reference | unknown | none | 🟡 YELLOW | 20 forecasts only; frozen 2025-12-27; dwarfed by live `agency_forecasts` (33,687) |
| `usace-office-specific-pain-points.json` | 1 (1/0) | USACE district enrichment | unknown | none | 🟡 YELLOW | 3 district mappings/4 mission areas; narrow by design; frozen 2025-12-27 |
| `component-agency-rules.json` | 1 (1/0) | agency component rules | unknown (config) | none | ⚪ GREY→config | 8 department rules; behaves as config, not dataset |
| `agency-toptier-codes.json` | 1 (1/0) | toptier code mapping | unknown | none | inert reference | official CGAC codes |
| `fsc-codes.json` | 1 (1/0) | FSC labels | unknown | none | inert reference | 78 groups/662 codes; official taxonomy; 2026-07-26 |
| `us-zip-coords.json` / `us-city-coords.json` / `world-city-coords.json` / `country-centroids.json` / `iso3-to-iso2.json` | 1 each | map rendering | n/a | none | inert reference | geographic constants; do not decay |
| `december-hit-list.json` | 2 (1/1) | — | `scripts/parse-december-hit-list.js` | doc: "stale snapshot" | not material | Dec-2025 snapshot, `generatedAt: 2025-12-24`; no customer surface found |
| `december-spend-forecast.json` | 1 (1/0) | — | unknown | doc: "stale snapshot" | not material | 58 opportunities, frozen 2025-12-27; no customer surface found |
| `contracts-data.json` | 1 (0/1) | — | `build-recompete-data` (admin) | doc'd as superseded | not material | admin-only (cust=0); confirms Phase 0A |
| `dod-command-info.json` / `sblo-roster-2026-06.json` / `agency-budget-data.json` | 1–5 | — | — | registered | Phase 0A | already classified |
| `agency-procurement-sources.json` | **0** | none | unknown | none | ⚪ GREY (dead) | 21 agencies; **zero importers** — candidate dead code, not deleted in this phase |

---

## Deep Traces

### §1 — `contractors.json` 🔴 RED

**Inclusion proof:** imported by `src/app/contractors/page.tsx` (public SEO index,
`revalidate=86_400`), `src/app/api/teaming/suggest/route.ts`, and
`src/app/api/dsbs-scorer/benchmark/route.ts`. Customers see company **names** and
spend **numbers** derived from it. Material.

**Lineage (edges that could not be established stay UNKNOWN):**

```
SBA Prime Directory FY24 (2,695 rows) + DHS Prime Contractors Page (40)
  + DOT Subcontracting Directory FY2025 (33)
        ↓
   [PRODUCER: UNKNOWN — no writer exists in the repo]
        ↓
src/data/contractors.json   (2,768 records, 1.34 MB)
        ↓
/contractors index · teaming suggest · DSBS benchmark
```

**Producer: NONE.** Two candidates were tested and both write elsewhere —
`generate-naics-top100.js:160` writes `src/data/naics-top100.ts`;
`generate-seo-contractor-candidates.js:7` writes `/tmp/…`. No writer of
`contractors.json` exists.

**Freshness:** introduced in `b3590dc4` (2025-12-27, "Add Federal Market Assassin
…"); **1 commit total, never modified in 8.5 months.**

**Coverage (measured):** `naics` 2,768/2,768 (100%) · `agencies` 100% ·
**`sblo_name` 72/2,768 (2.6%)** · **`email` 40/2,768 (1.4%)** ·
**`phone` 33/2,768 (1.2%)**.

**Contradiction A (class 15 — NEW):** `src/lib/data-sources/registry.ts:204`
hardcodes `coveragePercent: 95` for the Contractors dataset. Measured contact
coverage is 1.2–2.6%. The 95 is a literal in code, not derived from the artifact.

**Contradiction B (class 13):** `page.tsx` metadata title claims
**"290,000+ Federal Contractors"**; the page body renders `totalCount` = **~2,710**
(2,768 deduped by slug). **~107× divergence between the page's own title and its
own body.**
*Important nuance, established not assumed:* 290K is a **real** corpus —
`marketing-stats.ts:31` documents `recipients_rollup_merged` = 292,848 — and
`/contractors/[slug]` detail pages read BigQuery live with `contractors.json` only
as **fallback** (`[slug]/page.tsx:5`). So the claim is true of the database and
false of the index page that carries it. This is class 13 (consumer reads a
fallback artifact absent from the metadata), **not** fabrication.

**Duplicate stores (unresolved):** `contractors.json` (2,768, source "SBA Prime
Directory FY24") · `prime-contractors-database.json` (3,502) ·
`tier2-contractors-database.json` (207) · `sblo-roster-2026-06.json` (200) ·
BigQuery `recipients_rollup_merged` (292,848). **Five stores of overlapping
contractor/SBLO data; the relationships are UNKNOWN.** Notably `contractors.json`
carries `sblo_name`/`email`/`title: "SBLO"` — the same contact family as
`tier2_sblo`, at far worse coverage, from the FY24 vintage the Jun-2026 roster
was built to replace.

**Unresolved questions:** which store is canonical for teaming; whether the FY24
vintage should still serve; whether the index should read BigQuery like `[slug]`.

**Status: 🔴 RED** — no producer, 8.5 months frozen, a hardcoded 95% coverage
claim contradicted by measurement, and a title/body divergence on a public page.

### §2 — `agency-sat-friendliness.json` 🔴 RED

**Inclusion proof:** imported by `src/app/api/cron/send-notifications/route.ts:42`
and `src/lib/briefings/delivery/sam-green-email-template.ts:12`. It renders
**badges and percentages in customer alert emails** ("✅ Easy Entry",
`satPercent: 68`). An alert displays a number derived from it. **Material.**

**Lineage:**

```
"USASpending FY2025 contract data analysis"  (_source field)
        ↓
   [PRODUCER: UNKNOWN — no writer exists]
        ↓
src/data/agency-sat-friendliness.json   (19 agencies, 3 KB)
        ↓
send-notifications cron → customer alert email badge
```

**Producer: NONE FOUND.** Grep for writers returns nothing.

**Coverage:** **19 agencies**. Every other agency gets no badge — the universe of
federal agencies is ~250–307 by this repo's own pain-points data, so coverage is
roughly 6–8% of agencies, with no in-product statement of that bound.

**Freshness:** `_updated: "2026-04-16"`; last commit 2026-05-19. The values are
hardcoded integers; there is no mechanism to recompute them.

**Contradiction:** `DATA-SOURCES-REGISTRY.md` already flags this file as
**"Opinion-based — re-derive statistically from USASpending or remove."** It was
flagged, and it is still shipping numbers into customer emails. The file
self-describes as "Based on historical USASpending patterns" — an analysis claim
with no reproducible derivation.

**Status: 🔴 RED** — an unreproducible, self-flagged-as-opinion dataset emitting
specific percentages into customer-facing alerts, with no producer and no stated
coverage bound.

---

## Registry Completeness Update

**Phase 0B found a third registry.** Mindy has three independent data-source
registries, none authoritative:

| Registry | Location | Form | Contents |
|---|---|---|---|
| Supabase `data_sources` | DB table | 12 rows | drives `check-data-freshness` |
| `DATA-SOURCES-REGISTRY.md` | doc | prose tables | human reference |
| **`src/lib/data-sources/registry.ts`** | **code** | **hardcoded TS array** | **per-source `recordCount`, `coveragePercent`, `importScript`** |

`registry.ts` carries its own numbers (e.g. `navy … recordCount: 8821`,
`Contractors … coveragePercent: 95`) that are **literals maintained by hand**, not
derived. Phase 0A measured `agency_forecasts` at 33,687 live; `registry.ts` lists
per-source counts summing to a different figure and `DATA-SOURCES-REGISTRY.md`
says 9,973. **Three surfaces, three numbers, no reconciliation.**

**Unregistered served datasets: 23 triaged, 0 promoted.** All remain
**UNREGISTERED / UNRECONCILED**. No registry rows were added.

---

## Observed Failure Classes

Phase 0A classes carried forward. **One new class, demonstrated by a real dataset:**

| # | Class | Phase 0B instance |
|---|---|---|
| 2 | Manual/one-off presented as automated | `agency-sat-friendliness` (analysis claim, no producer) |
| 5 | Duplicate stores, unresolved relationship | **five** contractor/SBLO stores (§1) |
| 6 | Sparse field used as if complete | `contractors.json` email 1.4% behind a 95% coverage claim |
| 10 | Served dataset absent from registry | 23 candidates; `agency-sat-friendliness` in the alert path |
| 11 | Producer exists but is not repeatable | `contractors.json` — producer does not exist at all |
| 12 | Canonical artifact cannot be established | which of 5 contractor stores is canonical (§1) |
| 13 | Consumer reads fallback artifact absent from metadata | `/contractors` title (290K, BQ) vs body (~2,710, JSON fallback) |
| **15** | **Hardcoded coverage/quality claim in code, not derived from the artifact** | **`registry.ts:204` `coveragePercent: 95` vs measured 1.2–2.6%** |

Class 15 is new because Phase 0A's class 3 covers *build dates* in registry
metadata; this is a **quality percentage asserted as a literal in application
code**, which no freshness check can ever catch.

---

## Phase 0B Conclusion

### Is the metadata/provenance pattern broader than Phase 0A?

**Yes.** Phase 0A found bad metadata *inside* a registry. Phase 0B finds:
1. the same class **outside** any registry (23 unregistered served artifacts),
2. a **third registry** with hand-maintained numbers nobody reconciles,
3. a **new class** — a coverage percentage hardcoded in application code, which
   is structurally invisible to every control built so far.

Again, the underlying data was real in every case. The failure is in claims about
data, not the data.

### Highest blast radius

1. **`contractors.json`** — public SEO index + teaming + DSBS, no producer, 8.5
   months frozen, 5 overlapping stores, 95% claim vs 1.2–2.6% reality.
2. **`agency-sat-friendliness.json`** — unreproducible percentages in **customer
   alert emails**; already flagged "opinion-based" and still shipping.
3. **`registry.ts`** — a whole registry surface with no reconciliation to the
   other two.

### What needs Phase 0C

- **The contractor/SBLO store family** (5 stores) — one trace, not five.
- **`registry.ts` reconciliation** against `data_sources` and the doc.
- **The 4 GREY datasets** (`agency-aliases`, `psc-naics-crosswalk`,
  `tribal-businesses-database`, `tier2-contractors-database`) — each missing a
  producer and a source vintage.
- **Supabase-backed datasets** not yet censused (Phase 0A/0B covered JSON + 6
  registered; the DB has many more tables serving customers).

### Is the method still holding?

**Yes — and it caught its own worst error this round.** Amendment A1 (strip
comments) was insufficient: it reduced `contractors` from 253 to 190, still
wildly wrong, because the failure was **substring matching**, not comments. Only
import resolution produced the true 9.

**Proposed amendment A3 (for Phase 0C):** *Consumer counts must come from
resolved imports, never from identifier or filename matching. A bare-word match
proves nothing — neither consumption nor count.*

### What I proved
- 23/23 candidates triaged with import-resolved consumer counts.
- `contractors.json` has **no producer** (both candidates write elsewhere — exact lines cited).
- `naics-codes.json` / `psc-codes.json` have **real producers** (exact `OUTPUT_PATH` lines).
- Measured coverage on both deep-trace targets; both contradict a published claim.
- A third registry exists and is unreconciled.

### What remains unknown
- Producers for `agency-aliases`, `psc-naics-crosswalk`, `tribal-businesses-database`, `tier2-contractors-database`.
- The canonical contractor store, and the relationship among all five.
- Whether `agency-procurement-sources.json` (0 importers) is dead or pending.
- Whether the december-* snapshots reach any customer surface (none found; not proven absent).

### What surprised me
1. **Phase 0A's headline number was wrong.** "253 consumers" was a substring artifact; the truth is 9. The census's own flagship figure did not survive re-measurement — exactly the failure mode the census exists to catch, found in the census itself.
2. **A public page contradicts itself** — title says 290,000+, body renders ~2,710. Both numbers are individually defensible; together they cannot both describe the page.
3. **An "opinion-based" file already flagged for removal is still emitting percentages into customer alert emails.** Flagging is not a control.
4. **A third registry existed the whole time** and neither Phase 0A nor the freshness cron knows about it.

---

## Compliance

**No fixes applied. No production data changed. No freshness state changed. No
registry rows added.** Nothing was refreshed, stamped, merged, deleted, or
parameterized. The only write is this file.

Phase 0A (`docs/data-core-census-built-curated.md`) was **not edited**; its
consumer-count correction is recorded here instead.

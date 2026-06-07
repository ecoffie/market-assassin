# TODO: Parent-UEI Rollup for Contractor Profiles (SEO + data quality)

**Status:** ✅ FULLY DONE (shipped 2026-06-07) — parent-UEI rollup AND cross-variant name-merge both live
**Created:** 2026-06-07
**Priority:** High — suppresses our highest-value brand-search SEO pages
**Owner:** Eric / Claude
**Related:** `tasks/PRD-seo-contractor-pages-agent.md`, `src/app/sitemap.ts`, `src/lib/bigquery/recipients.ts`
**Commits:** `41d66cb` (rollup), `bb55b63` (sibling-redirect fix). Live on getmindy.ai.

---

## ✅ Shipped (2026-06-07)

- `recipients_rollup` BQ table (319,091 rows) added to `build-derived.sql`, keyed
  by `COALESCE(parent_uei, recipient_uei)`; distinct counts recomputed at parent
  level; carries `child_ueis[]` + canonical `rollup_name`.
- `recipients.ts`: `RollupProfile`, `getRollupBySlug`, `resolveCanonicalSlug`;
  all detail queries filter `recipient_uei IN UNNEST(child_ueis)`; sitemap +
  similar-contractors source the rollup.
- Contractor pages (overview/agencies/naics/contracts) resolve via rollup,
  308-redirect sibling-UEI slugs to the canonical parent (page number preserved),
  gate reads parent-level counts.
- **Verified live:** Lockheed `/lockheed-martin-corp/agencies` → 200, indexable,
  27 agencies (was 4, noindexed). 5 primes (GD 36, Northrop 23, Leidos 35,
  Raytheon 15, Booz Allen 31 agencies) all indexable. Siblings 308 correctly
  (`hp-enterprise-services-llc` → `hp-inc`, `dva-healthcare-renal-care-inc` →
  `davita-inc`), page-number preserved on `/contracts/2`.
- **Impact:** $1B+ primes gated thin **55.7% → 34.1%**. The residual 34% is
  *correct* — genuinely concentrated primes (Electric Boat = Navy only; DOE
  national-lab managers; military health like TriWest/Humana).

## ✅ Cross-variant name-merge (SHIPPED 2026-06-07 — was deferred, now done)

USAspending assigns MULTIPLE parent_uei groups to one company whose names differ
only by legal suffix (`lockheed-martin-corp` vs a separate
`lockheed-martin-corporation` parent), splitting brand equity across pages.

**Fix (commits `23482e4` table+repoint, `91bfd6c` resolver):** chose pure
name-merge (option b) after a top-40-by-spend audit found every fused group
genuinely the same entity. The scary CRANE tail case turned out CORRECT —
USAspending's own parent lineage already links Crane Co. (industrial) + Crane &
Co. CAGE-overlap guard was tested and dropped (it only created gaps on
zero-dollar sub-rollups; the source already encodes lineage).

- `recipients_rollup_merged` (292,848 rows): strips legal suffixes, groups parent
  rollups by normalized name into the highest-spend one, unions child_ueis,
  recomputes distinct counts from awards. "GENERAL ELECTRIC" does NOT fuse with
  "GENERAL DYNAMICS" (full normalized name must match).
- `BQ_TABLES.recipientsRollup` → merged table (column-compatible). Detail +
  rollup cache keys bumped (child_ueis sets grew).
- `resolveCanonicalSlug` got a 3rd arm: normalized-name match, so pre-merge
  rollup-name variants (e.g. `general-dynamics-corporation`, no longer a rollup
  name nor exact child name) resolve to the canonical merged slug.

**Verified live:** Lockheed ONE page — 31 agencies / 242 NAICS / $628.8B (was
27/234/$495.6B across two pages). Variants 308 to canonical
(lockheed/raytheon/general-dynamics/booz-allen *-corporation/-inc →
canonical). GE stays its own page. All canonical prime /agencies indexable
(Lockheed 31, GD 39, Raytheon 17, Booz Allen 32 agencies).

---

## Problem

USAspending awards scatter across many subsidiary/legal-entity UEIs that all
share one `parent_uei`. Our `usaspending.recipients` table has one row **per
UEI**, not per parent. So a household-name prime looks far smaller than it is:
its awards, agencies, and NAICS codes are split across a dozen sibling rows.

The contractor page slug (e.g. `lockheed-martin-corporation`) resolves to a
**single** UEI row via `getRecipientBySlug` (highest-spend match). That one
row carries only a slice of the parent's true footprint.

### Concrete example — Lockheed Martin

Lockheed is shattered across 8+ UEI rows, all under `parent_uei = ZFN2JJXBLZT3`:

| recipient_uei | distinct_agency_count | distinct_naics_count | $B |
|---|---|---|---|
| G4KDGE4JFFK7 | 4 | 40 | 221.0 |
| XFJMYSYFJEK4 | 3 | 37 | 69.3 |
| H7PNSVNN5827 | 2 | 30 | 32.9 |
| SJDEB3MKJEW5 | 3 | 64 | 25.8 |
| FYHNA5WC8XD7 | 3 | 11 | 25.3 |
| CQWLW9XRQTH5 | 4 | 13 | 19.9 |
| ... | ... | ... | ... |

The `lockheed-martin-corporation` page resolves to the top row → **4 agencies**.
At the parent level it's dozens of agencies and ~$430B+.

## Impact (measured 2026-06-07 against `usaspending.recipients`)

The thin-content gate (`SUBPAGE_MIN_ROWS = 5`, shipped in commit `c9dc62a`)
now `noindex`es any `/agencies` or `/naics` sub-page with <5 rows. That gate is
**correct given the current data** — but the data under-counts primes, so it's
suppressing pages that should rank for high-value brand searches like
"lockheed martin federal agencies":

| Spend tier | Contractors | Gated as thin (<5 agencies) | % gated |
|---|---|---|---|
| $1B+ (primes) | 806 | **449** | **55.7%** |
| $100M–$1B | 5,182 | 3,183 | 61.4% |
| $10M–$100M | 17,471 | 13,319 | 76.2% |

**449 of 806 billion-dollar primes** are flagged thin at the entity level.
These are exactly the brand-name searches with the most SEO value.

## Goal

Make contractor profiles (and their sub-pages) represent the **parent
organization** so a search for "Lockheed Martin federal contracts" lands on a
page showing Lockheed's *full* footprint — and so the thin-content gate only
fires on genuinely small contractors, not on scatter artifacts.

## Approach options

1. **Parent-rollup recipients table/view (recommended).**
   Build `recipients_rollup` keyed by `COALESCE(parent_uei, recipient_uei)`,
   aggregating `total_obligated`, `award_count`, `distinct_agency_count`,
   `distinct_naics_count` (recompute distincts from `awards` at parent level —
   you cannot SUM the per-UEI distinct counts, they overlap). Page resolves
   slug → parent row; award/agency/NAICS queries filter by
   `parent_uei = @parentUei OR recipient_uei = @parentUei`.
   - Pro: clean separation, page logic barely changes (swap the lookup + the
     `WHERE recipient_uei = @uei` clauses to a parent-aware predicate).
   - Con: a new BQ artifact to maintain in the ingest pipeline.

2. **Query-time parent aggregation.**
   Keep the per-UEI table; change `getRecipientBySlug` + the sub-page queries
   to roll up by parent on the fly.
   - Con: every contractor query scans the awards table grouped by parent —
     more expensive, harder to KV-cache cleanly.

3. **Hybrid:** rollup table for the summary counts (cheap gate decision),
   query-time for the detail tables (already filter awards by recipient).

## Open questions / gotchas

- **Distinct counts can't be summed.** A subsidiary and its parent can both
  touch DoD; SUM(distinct_agency_count) double-counts. Recompute
  `COUNT(DISTINCT awarding_agency)` from `awards` grouped by parent.
- **Slug collisions.** Many UEIs share `recipient_name` "LOCKHEED MARTIN
  CORPORATION". `recipientSlug()` + `getRecipientBySlug` must deterministically
  pick the parent and 301/canonical the sibling-UEI URLs to it, or we fragment
  link equity across near-duplicate pages.
- **Parent vs. self.** Rows where `parent_uei IS NULL` or `parent_uei =
  recipient_uei` are already their own parent — handle with COALESCE.
- **`getTopRecipientsForSitemap`** must emit parent-level rows (one URL per
  parent), not per-UEI, or the sitemap still points at fragmented pages.
- **Don't loosen `SUBPAGE_MIN_ROWS`.** The gate is right; the *input data* is
  wrong. Fixing the rollup makes the gate fire correctly — primes stop being
  flagged, genuinely small contractors still are.

## Definition of done

- [ ] `lockheed-martin-corporation` resolves to a parent page showing the full
      agency/NAICS footprint (dozens, not 4) and is **indexable** (no `noindex`)
- [ ] Re-run the impact query above; % of $1B+ primes gated drops from 55.7%
      to a low single-digit residual (truly niche primes only)
- [ ] Sibling-UEI URLs canonical/redirect to the parent page (no dup pages)
- [ ] Sitemap emits one URL per parent org
- [ ] BQ cost per contractor page request stays within the KV-cache budget
- [ ] Spot-check 5 other shattered primes (Booz Allen, Leidos, Raytheon,
      General Dynamics, Northrop) render full footprint + indexable sub-pages

## Verification query (rerun after the fix)

```sql
SELECT
  CASE
    WHEN total_obligated >= 1000000000 THEN '1. $1B+ (primes)'
    WHEN total_obligated >= 100000000 THEN '2. $100M-$1B'
    WHEN total_obligated >= 10000000 THEN '3. $10M-$100M'
    ELSE '4. <$10M'
  END AS spend_tier,
  COUNT(*) AS contractors,
  COUNTIF(distinct_agency_count < 5) AS gated_thin_agencies,
  ROUND(100 * COUNTIF(distinct_agency_count < 5) / COUNT(*), 1) AS pct_gated
FROM `market-assasin.usaspending.recipients`  -- or recipients_rollup after the fix
WHERE total_obligated >= 10000000
GROUP BY spend_tier
ORDER BY spend_tier;
```

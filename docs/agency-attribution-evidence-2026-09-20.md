# Legacy GAO agency attribution — evidence, and the decision it needs (A2)

**Date:** 2026-09-20 · Measured against production, read-only.
**This PR repairs nothing.** It adds the evidence needed to choose a repair.

## The defect

`agency_intelligence` `gao_high_risk`: **445 rows, 271 distinct titles**.

- **133 titles (49%)** are filed under **2–4 different agencies** → **307 of 445 rows**
- **148 rows (33%)** carry an agency name that is **not an agency**:
  `General Government` (141) · `Department of the` (2) · `Department of Health` (2)
  · `Department of Veterans` (1) · `for Agency` (1) · `Governing Agency` (1)

Unambiguous examples:

| Title | Filed under |
|---|---|
| "**Department of Health and Human Services**: Management Challenges…" | HHS · **Homeland Security** · **EPA** · "Department of Health" |
| "**General Services Administration**: Building Security Upgrades…" | GSA · **Commerce** · **Homeland Security** · **SEC** |

Potato-0C repaired **one** report and its 50 cached opportunities. The **class**
is still live — the same lesson the fabricated-budget P0 taught.

## The evidence, measured

| Evidence | Rows | Documents | Meaning |
|---|---:|---:|---|
| `artifact_agency` | **148** | 148 | stored value is not an agency — deterministic |
| `unsupported_by_title` | **64** | 43 | title names a *different* agency |
| `no_title_evidence` | **211 (47%)** | 143 | title carries no agency prefix — **cannot be adjudicated** |
| `corroborated_by_title` | **22 (4.9%)** | 22 | title agrees with the stored agency |

**Only 22 of 445 rows have their agency corroborated.** And 211 have no
deterministic answer at all — which is precisely why a blind repair would be
wrong.

## Why this PR does not repair

`agency_intelligence` is `UNIQUE(agency_name, intelligence_type, title)`.
Correcting `agency_name` **rewrites the row's primary identity** and can collide
with an existing row for the same document. There are at least three defensible
dispositions:

| Option | Effect | Cost |
|---|---|---|
| **A. Rewrite + merge** | correct agency stored; duplicates merged | destructive; collisions must be resolved; loses the observed-as record |
| **B. Add a resolved column** | stored value untouched, truth alongside | two agency fields; every reader must be migrated |
| **C. Quarantine unsupported rows** | artifacts and contradictions removed from the read path | 212 rows disappear from agency intel; recoverable |

Choosing among them is a **product decision**, not something a migration should
settle silently. So this PR adds `agency_intelligence_attribution` — every row
keeps its stored agency, and the view states whether the title supports it.

**Ambiguity is preserved explicitly.** `unsupported_by_title` means *the title
does not corroborate this agency*, **not** *this agency is wrong* — a GAO report
may legitimately cover several agencies, and 47% of rows carry no agency-shaped
prefix, so for them the honest answer is `no_title_evidence`, never a guess.

Identity is keyed on the **source-native document id** parsed from `source_url`
(`GAOREPORTS-T-GGD-98-141`), never on title text and never on a row count.

## Context that lowers the urgency

This corpus is `HISTORICAL_ONLY`: publication dates run **1993-10-06 → 2000-09-27**,
it was ingested once (2026-04-19) and never refreshed, and its upstream (GovInfo
`GAOREPORTS`) froze in 2008 with an invalid API key. It is decades-stale
reference material, not a live feed.

## Post-merge

1. `npm run migrate` → `npm run migrate -- --go`
2. `select attribution_evidence, count(*) from agency_intelligence_attribution group by 1;`
   → expect 148 / 64 / 211 / 22
3. Then choose A, B or C above.

**Rollback:** `DROP VIEW agency_intelligence_attribution;` — no data touched.

# Data Core P0 Decisions — APPROVED & Final Product Roles

**Approved 2026-09-12 · Memo: PR #1451 · Narrow repair: this PR**
**Scope: only the contradictions directly unlocked by these two decisions.**

---

## The frozen product rule

> **Only the canonical population store may make a corpus-size claim.**
>
> **Measurements** may be numeric only when their basis is reproducible.
> **Editorial judgments** may be labels, not fake precision.
> **Enrichment stores** may enrich the canonical population, but must not
> redefine its size.

---

## Decision 1 — Agency SAT Friendliness: **EDITORIAL SIGNAL** (Option B)

SAT friendliness is an **editorial / heuristic** signal, not a measured score.

### Rules now enforced in code
| Rule | How |
|---|---|
| No customer-facing percentage | `getSatBadgeForAgency` returns `{ badge, level, coverage }` — **`satPercent` is no longer returned at all**, so it cannot reach a template |
| No implication of statistical derivation | The accessor and the file shape carry an explicit editorial header; `satPercent`/`microPercent` are marked `@deprecated` **editorial threshold inputs** |
| Coverage bounded honestly | `coverage: 'covered' \| 'uncovered'` is explicit; the frozen set covers **19** agencies of ~250–307 |
| **Absence is not negative evidence** | An uncovered agency returns `coverage: 'uncovered'`, `badge: null`, `level: 'unknown'` — **never `'low'`, never `0`** — and the render site emits `''` |
| No invented methodology | The 19-agency set is unchanged; no re-derivation performed |

### 🐛 A real bug was found and fixed by the verification tests
The fuzzy matcher used `matchingWords.length >= 1` **without stopwords**, so **any
agency name containing "DEPARTMENT" inherited the first DEPARTMENT entry's badge**.
An uncovered Department would have rendered Veterans Affairs' **"✅ Easy Entry"**.

That is the approved rule failing in its worst direction: absence of an editorial
opinion rendering as a **positive claim about a different agency**. Generic org
words (`DEPARTMENT`, `AGENCY`, `ADMINISTRATION`, `OFFICE`, …) are now stopworded
and a match requires a **distinctive** shared word. Regression-tested; the 19 real
agencies still resolve.

### Long-term target (NOT implemented)
Replace the frozen set with the reproducible derivation that already exists at
`reports/generate-all/route.ts:871` (`satPercent = satCount / totalCount` from
live award data), **after its methodology is defined and validated**.

---

## Decision 2 — Contractor Corpus: **HYBRID WITH EXPLICIT ROLES** (Option C)

Roles are now declared in code — `src/lib/data-core/contractor-corpus.ts`.

| Store | Role | May claim corpus size? |
|---|---|---|
| **BigQuery `recipients_rollup_merged`** | **canonical population** | ✅ **yes — the only one** |
| `contractors.json` | enrichment overlay (contact fields) | ❌ no |
| `sblo-roster-2026-06.json` | SBLO / teaming contact layer | ❌ no |
| `prime-contractors-database.json` | broader SBLO fallback ("3,500+ primes" = **this store**, not the universe) | ❌ no |
| `tier2-contractors-database.json` | **unresolved — deliberately unclassified** | ❌ no |

`mayClaimCorpusSize()` **defaults to deny** for unknown stores.

### What changed on `/contractors`
The title already claimed "290,000+" (true of BigQuery). The **body** now matches
that scope instead of contradicting it:

- **Before:** `Browse 2,710 federal contractors…` + a `2,710` tile labelled *"contractors profiled"* — the static overlay presented as the universe.
- **After:** the searchable universe is stated from `CANONICAL_POPULATION_LABEL` (imported from `marketing-stats`, never typed), and the static list is labelled **"curated profiles in this index"** beside **"contractors searchable"**.

The file header now records the overlay role, so the next reader is not misled.

### Preserved deliberately
- **No BigQuery query, fallback, or quota architecture changed** (`git diff` on `src/lib/bigquery/`, `[slug]/`, `api/contractors/` is **empty**).
- Index stays `revalidate = 86_400` statically generated — **no live scan added, no quota risk**.
- `contractors.json` **not deleted**, still the overlay source.
- No store merged, no contact backfilled, no role guessed for `tier2-contractors-database.json`.

---

## Verification

### SAT
| Requirement | Evidence |
|---|---|
| Customer output is labels only | `renderBadge(satInfo.badge, …)` — receives a string; no percentage path exists |
| No customer-visible percentage remains | `satPercent` appears only in doc comments and the deprecated interface; **not returned by the accessor** |
| Absence not rendered as negative | `satInfo.badge ? renderBadge(…) : ''` + `coverage: 'uncovered'`, `level: 'unknown'` |
| Remaining percentage cannot be mistaken for product truth | `@deprecated` + "never render, never treat as measured"; unreachable from the accessor |

### Contractors
| Requirement | Evidence |
|---|---|
| BigQuery remains canonical for the broad universe | `[slug]` and `search-bq` untouched; role declared in code |
| "290,000+" traces to the BigQuery population | label imported from `marketing-stats.CONTRACTOR_COUNT` (rounded **down** from 296,445 measured) |
| Static corpus represented as a subset/overlay | "curated profiles in this index" vs "contractors searchable" |
| Index does not imply ~2,710 is the universe | old "contractors profiled" label removed; test asserts its absence |
| Slug/search fallbacks unchanged | zero diff in those paths |
| No BigQuery quota regression | no query added; index still static |

**Tests:** 18 new invariants in `src/lib/data-core/p0-decisions.unit.test.ts`.
**Suite:** 4,605 passed / 0 failed. `tsc --noEmit` clean.

---

## Controls unlocked (NOT built here)

These decisions now make two Phase 2 controls safe to build — **deliberately not
in this PR**:
1. **Producer/lineage control** for datasets whose canonical role is defined.
2. **Coverage control** distinguishing canonical-population / enrichment / editorial-label coverage.

---

## Still open
- `tier2-contractors-database.json` (207 rows) — untraced, unclassified.
- The SAT live-derivation (Option A) — approved as the target, methodology undefined.
- `registry.ts` `coveragePercent: 95` — the C2 gate keeps printing it until a product decision; **untouched here**.

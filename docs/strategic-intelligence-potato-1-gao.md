# Potato 1 — one real GAO report becomes Institute evidence, then (maybe) intelligence

**Date:** 2026-09-13 · **Status:** proven end-to-end against production data.

**Ownership model implemented:**
```
GOVERNMENT SOURCE
  -> MINDY INSTITUTE RESEARCH CORPUS        institute_sources   (owns provenance)
  -> CANONICAL AGENCY / DOCUMENT / PROVENANCE
  -> STRATEGIC INTELLIGENCE DERIVATION      derive.ts           (consumes evidence)
  -> pain point / priority / funding / policy / buying signal
```
The Institute owns the evidence. Strategic Intelligence turns evidence into foresight.
**A document is valuable Institute evidence even when it yields no intelligence.**

---

## 1. What already existed (checked before building)

| Thing | Verdict | Why |
|---|---|---|
| `research-publications.ts` — `RES-###` | **reuse, don't extend** | Mindy's OWN publications (white papers), not ingested government documents |
| `observatory-methodology.ts` — `OBS-###` | **reuse, don't extend** | Mindy's OWN metrics + methodology |
| `/institute/evidence` | pattern reused | A real `Source {cite,url,finding,scope,status}` model — but a **hardcoded TS array** mirroring a markdown file. Cannot accept a document automatically |
| `mindy_rag_documents` | **not this** | Keyed on `source_path` = local teaching files on disk; provenance is a filesystem path, not a public URL |
| `agency_intelligence` | **cannot hold documents** | `UNIQUE(agency_name, type, title)` is AGENCY-keyed, so one report appears under N agencies — the contamination Potato 0 repaired |
| `recompete_changes` | **pattern cloned** | append-only, TEXT old/new, UNIQUE event key, diff-before-write |
| `awards-ingest/clocks.ts` | **pattern cloned** | run-clock vs source-clock separation |
| `agency-resolver.ts` (Potato 0) | **reused as-is** | the only agency identity path |
| `agency_pain_points_db` | **reused + 5 columns** | already had `source CHECK(...'gao'...)`, `source_url`, `UNIQUE(agency, pain_point)` |
| `cron_jobs`, `data_sources` | **reused, INSERT only** | no DDL needed |

**Answer to "is there already a canonical home for a government research document?" — No.**
The Institute reads **no database at all** today; every surface is static TypeScript.
That gap is what `institute_sources` fills.

## 2. Smallest schema delta

One migration, `20260913_institute_sources.sql`:
- **`institute_sources`** (new) — the corpus. `UNIQUE(source_type, document_number)` makes
  idempotency mechanical. `source_url NOT NULL` **by design**: 0 of 3,045 legacy pain
  points carry a URL, so an uncitable Institute record must be structurally impossible.
  `source_type` already enumerates the 12 document classes the Institute will track
  (GAO · IG · CRS · enacted law · introduced bill · appropriation · NDAA · Federal
  Register · budget justification · strategic plan · forecast · executive directive).
- **`intelligence_changes`** (new) — append-only, references `institute_sources(id)`.
  ONE stable id links the two systems instead of duplicating provenance.
- **`agency_pain_points_db`** — `+status +confidence +institute_source_ids +first_seen
  +last_evidence_at`. Nothing else changed.

## 3. ⚠️ The source had to change: GovInfo is dead, GAO RSS is live

Measured live 2026-09-13:

| Source | Newest document |
|---|---|
| GovInfo `GAOREPORTS` (what the existing fetcher targets) | **2008-09-18** — an 18-year-old frozen archive |
| **`gao.gov/rss/reports.xml`** | **2026-09-10** — three days old |

A living signal cannot be built on GovInfo. The RSS feed was **already declared** in
`src/lib/briefings/web-intel/rss.ts` as `gao_reports` and never wired to anything — so
this reuses existing plumbing rather than adding a source.

**Also found:** the stored `GOVINFO_API_KEY` returns `API_KEY_INVALID` in every env file
that carries it. Recorded, not fixed here.

## 4. The real run (25 live GAO reports, 2026-09-08 → 2026-09-10)

```
GAO RSS: 25 documents | SOURCE WATERMARK 2026-09-10

PASS 1   INSTITUTE  inserted=25/25  resolved=15  unresolved=10
         DERIVATION {"pain_point_created":13,
                     "evidence_only_unresolved":10,
                     "evidence_only_not_defensible":2}
         changes logged: 13   errors: 0

PASS 2   INSTITUTE  inserted=0/25   (idempotent)
         DERIVATION {"pain_point_unchanged":13, ...}
         changes logged: 0    errors: 0
```

**12 of 25 documents produced NO derived claim and that is the success case** — they are
retained, sourced and searchable in the corpus.

Verified in the database: 25 documents · **25 with a source URL (100%)** · 15 resolved ·
10 unresolved · 13 changes · **13 of 13 changes linked to their Institute evidence id** ·
13 derived claims.

### Worked example — a defensible derivation
`GAO-26-108127` "Chemical Security: DHS Should Provide Options" → abstract names
*Department of Homeland Security* → `exact_name`, high confidence → title states a problem
→ pain point created, change recorded, citing the Institute evidence id.

### Worked example — a correct refusal
`GAO-26-108229` "Nuclear Security Enterprise: Strategic Partnership Projects Can Support
Mission" → abstract names only *NNSA*, not one of the 49 canonical toptier agencies →
**unresolved** → evidence kept, **no claim invented**.

`GAO-26-109086` "Priority Open Recommendations: Department of State" → agency resolves
cleanly, but the title states **no problem** → evidence kept, no pain point.

## 5. Three clocks (four with intelligence), never collapsed

Registered as `data_sources[institute_gao]`, clocks encoded in `notes` between
`[gao-ingest-clocks:v1]` sentinels — the awards-ingest pattern, no schema change.

```
lastPoll               2026-09-13T09:22:57Z   (Mindy checked)
lastSourceAdvance      2026-09-10             (newest GAO publication observed)
lastIntelligenceChange 2026-09-13T09:21:23Z   (evidence changed an interpretation)
```

`classifyGaoFreshness` distinguishes `healthy` · `upstream_quiet` · `ingest_broken` ·
`unmeasured`. **A fresh poll over a quiet upstream is `upstream_quiet`, not "fresh"** —
a successful job is never reported as data advancement.

## 6. Hard proof (inject → red → revert)

| Invariant | Injection | Result |
|---|---|---|
| No substring fan-out | replaced whole-phrase match with `includes(name.slice(0,3))` + allowed multi-hit | **4 RED** → revert → green |
| History before state | swallowed the `intelligence_changes` failure | **1 RED** → revert → green |

50 tests pass. Both suites fail loudly when the defect is reintroduced.

## 7. What remains intentionally static

The **historical JSON corpus is still the customer-facing source.** Nothing switched.
Not done, deliberately: no migration of the 3,032 historical pain points or 2,658
priorities; no historical GAO backfill; no IG/CRS/legislation/budget/Federal Register
collectors; no Event Radar change; no Strategic Intelligence UI; `/research` untouched.

This proves the successor **beside** the corpus, not instead of it.

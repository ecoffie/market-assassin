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


---

# Potato 1B — the collector is now SCHEDULED

**Date:** 2026-09-13. Potato 1 proved Mindy *can* learn from a new government report.
1B proves Mindy *will keep watching* without a human remembering to run it.

## Deploy before scheduling (house rule #5, followed in order)

1. Route merged (`2df9c251`) — **no `cron_jobs` row in that PR, deliberately.**
2. Production deployment verified green.
3. Route invoked manually on prod and its **semantic** result checked.
4. **Only then** the `cron_jobs` row was inserted.

## Production smoke test — a semantically valid quiet result

```
GET /api/cron/institute-gao-sync?mode=preview  -> 200
  {"pollOk":true,"documentsSeen":25,"sourceWatermark":"2026-09-10"}

GET /api/cron/institute-gao-sync (execute)     -> 200
  status: no_new_evidence      partial: false
  documentsSeen 25 / processed 25
  evidenceInserted 0   alreadyHeld 25   resolved 15   unresolved 10
  painPointsCreated 0  evidenceOnly 12  blockedNoHistory 0  failed 0
  freshness: healthy (pollAgeDays 0, sourceAgeDays 3)
```

**A 200 alone was not treated as success** — the semantic result is what was checked.
Nothing new arrived, nothing was invented, and that is the expected steady state.

## The four clocks stayed distinct across two production runs

| clock | run 1 | run 2 | behaviour |
|---|---|---|---|
| `lastPoll` | 13:16:40Z | **13:16:55Z** | **advances every run** |
| `lastSourceAdvance` | 2026-09-10 | 2026-09-10 | unchanged — feed was quiet |
| `lastInstituteIngest` | 09:21:23Z | 09:21:23Z | unchanged — nothing ingested |
| `lastIntelligenceChange` | 09:21:23Z | 09:21:23Z | unchanged — nothing derived |

Cron success never overwrote the other three. "The job ran" is not "the data advanced."

## Idempotency, measured in production after repeat execution

| table | rows | duplicates |
|---|---:|---:|
| `institute_sources` | 25 | **0** |
| `intelligence_changes` | 13 | **0** |
| `agency_pain_points_db` | 13 | **0** |

## Failure is observable — each mode reports as ITSELF

| Injected | Result |
|---|---|
| No/invalid auth | `401` — never a silent no-op |
| Source fetch 503 | **throws** → `502 pollOk:false status:ingest_broken`, watermark **not** advanced. Never "0 new reports" |
| Malformed feed (HTML instead of RSS) | 0 parseable docs → `502 feedMalformed` — **not** `upstream_quiet` |
| Watermark from a malformed feed | `null` — cannot advance |
| Budget exhausted | `partial:true`, clocks **not** stamped |
| Any failure/blocked | `status:degraded`, `clocksStamped:false` |

## The schedule

```
job_name    institute-gao-sync
route       /api/cron/institute-gao-sync?mode=execute&budgetMs=240000
cron_expr   20 12 * * *        (daily 12:20 UTC)
enabled     true
timeout_ms  290000
```

Daily matches the sibling external-source collectors (`extract-sam-events` 07:00,
`sync-forecasts` 13:00) and GAO's business-day publication rhythm. **Polling cadence
and publication cadence are different concepts**: a quiet day reads
`no_new_evidence` / `upstream_quiet`, which is healthy.

## Recorded, deliberately NOT chased

- **GovInfo `GAOREPORTS` is frozen at 2008-09-18.** Unsuitable as the living GAO
  signal. The old fetcher still targets it and was left in place.
- **`GOVINFO_API_KEY` returns `API_KEY_INVALID`** in every env file carrying it.

Neither was repaired: no key rotation, no GovInfo redesign, no GAO history backfill,
no removal of the old fetcher, no replacement of the RSS source, no Federal Register.

## Build blocker cleared en route (separate PR)

Production had been undeployable since data-core Phase 3: `integrity-report.ts:74`
spawned repo CLI scripts through a dynamic `scripts/` path that Turbopack cannot
resolve. Fixed at the **boundary** (`35438c1b`) — C2/C3 extracted into importable
`.mjs` modules that Platform Health imports and the CLIs adapt, with byte-identical
output proven in one process. No bundler-evasion, no control dropped, Phase 3 not
reverted.

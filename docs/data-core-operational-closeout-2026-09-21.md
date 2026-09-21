# Data Core — operational closeout

**Date:** 2026-09-21 · **READ ONLY.** Measured against `origin/main` and live
production. Every figure re-measured today.

**Scope note:** batch-2 PRs (#1590 A · #1591 B · #1593 C) are **open, not merged**.
The matrix shows state **on main today**, and names what each PR would change.
Nothing here claims a production effect from unmerged work.

---

## D4 — the matrix

| Domain | Source family | Rows | Canonical producer | Control plane | Currentness | Provenance | Identity | Customer read safety | Phase II | Open PR | Integrity blocker | Product expansion |
|---|---|---:|---|---|---|---|---|---|---|---|---|---|
| **Forecast** | 12 agency sources | **35,912** | 21 scrapers, `0 13 * * *` | **12 instances** | **CURRENT** (advance 09-20) | source URLs | ONE resolver | safe | **CONTROLLED_PARTIAL** | — | — | Army proper · Air Force (awaiting FCO) |
| Forecast | GSA Gateway slice | 6,724 | manual upload | instance | **CONTROLLED_PARTIAL** (`content_stale`) | upload provenance | resolver | safe | **PARKED** | — | — | manual Gateway slices |
| Forecast | EPA / NRC / SSA | 264 | manual | instances | **BLOCKED** (`unreachable`) | — | resolver | safe | **BLOCKED_CONTROLLED** | — | upstream unreachable | — |
| **Decision Makers** | SAM notice POCs | **212,415** | `sync-decision-makers` | instance, `current` | **CURRENT** — backfill pass COMPLETE | `notice_id::slot` | email → **23,201** identities | safe | **CLOSED** | — | — | — |
| Decision Makers | SAM entity POCs | **82,017** | manual import | instance, `unmeasured` | **UNMEASURED** | `uei::slot` | **no email (0)** | safe | **BLOCKED_CONTROLLED** | — | needs a different key | vendor person identity |
| **Institute / Strategic** | GAO RSS | **49** | `institute-gao-sync` | instance, `current` | **CURRENT** — **25/25 live feed items held** | 49/49 URL + doc id | `resolveAgency()` | safe | **CLOSED** | — | — | — |
| Institute / Strategic | Congress (NDAA) | **29** | `institute-legislation-sync` | instance, `current` | **CURRENT** (watermark 07-30) | 29/29 URL | 28/29 DoD | **reaches no surface** | **CONTROLLED_PARTIAL** | **#1593** | no `CONGRESS_API_KEY`; outcome unobservable | broader legislation |
| Institute / Strategic | **Historical GovInfo GAO** | **445** | frozen (one-shot 2026-04-19) | — | **HISTORICAL_ONLY** (pub 1993–2000) | URL + date | **212 mis-attributed** | **#1590 quarantines 212** | **PHASE_II_REQUIRED → CONTROLLED_PARTIAL** | **#1590** | attribution correction still open | — |
| Institute / Strategic | USASpending contract_pattern | 111 | frozen | — | **HISTORICAL_ONLY** | descriptions nulled (P0) | agency-keyed | safe | **CONTROLLED_PARTIAL** | — | — | — |
| Institute / Strategic | Static claim corpus | **5,543** | manual | `data_sources` only | **UNMEASURED** — all `UNDATED` | **0 URLs · FULL 0** | 16.4% canonical | **safe since #1579** | **CONTROLLED_PARTIAL** | — | — | priority source recovery |
| **sam_opportunities** | SAM.gov API | **215,066** | 3 sync jobs | **instance, `current`** | **CURRENT** (0d) | notice id | notice id | safe | **CLOSED** | — | — | — |
| **DIBBS** | DLA flat files | **57,816** | `sync-dibbs`, `0 8 * * *` | **instance, `current`** | **CURRENT** (1d) | RFQ number | RFQ number | safe | **CONTROLLED_PARTIAL** | — | 13% job error rate | — |
| **Grants** | Grants.gov | **2,149** | `sync-grants`, `0 9 * * *` | **instance, `current`** | **CURRENT** (0d) | opportunity id | native id | safe | **CLOSED** | — | — | — |
| **Research/Lab** | NIH RePORTER | **1,416** | `snapshot-multisite-nih` | instance | **BEHIND_UPSTREAM** (6d) — **advancing** (100 rows/7d, 451/30d) | source URL | external id | safe | **CONTROLLED_PARTIAL** | **#1593** | — | — |
| Research/Lab | DARPA BAA | **6** | parked by **#1591** | instance | **HISTORICAL_ONLY** (168d) | source URL | external id | safe | **PARKED** | **#1591** | repair-or-retire decision | — |
| Research/Lab | Grants.gov slice | 63 | none | instance | **HISTORICAL_ONLY** (161d) | source URL | external id | safe | **HISTORICAL_ONLY** | — | dormant, no producer | — |
| Research/Lab | NSF SBIR | **0** | parked by **#1591** | instance, `unmeasured` | **UNMEASURED — never advanced** | n/a | n/a | safe | **BLOCKED_CONTROLLED** | **#1591** | repair-or-retire decision | — |
| **SBIR** | NIH slice only | **42** | inherits NIH | via NIH instance | **BEHIND_UPSTREAM** (6d) | external id | external id | safe | **CONTROLLED_PARTIAL** | — | — | **~10 more agencies** |

**Control plane: 23 instances** (was 16 before batch 1) — 11 `current`,
6 `content_stale`, 3 `unreachable`, 3 `unmeasured`; 10 flagged for a human.

---

## D2 — is the Data Core operationally set?

Not "is every government source connected" — but: known topology, canonical
producer ownership, currentness/provenance/identity semantics, customer-safe
reads, control-plane registration, truthful blocked states, no silent fabricated
claims, no false-green producers still running.

| Domain | Verdict | Exact blocker |
|---|---|---|
| **Forecast** | **OPERATIONALLY SET** | 7 sources need a human, all truthfully registered |
| **Decision Makers** | **OPERATIONALLY SET** | vendor identity blocked and truthfully marked |
| **sam_opportunities** | **OPERATIONALLY SET** | — |
| **DIBBS** | **OPERATIONALLY SET** | 13% job error rate; advancing, monitored |
| **Grants** | **OPERATIONALLY SET** | — |
| **Institute / Strategic — GAO live** | **OPERATIONALLY SET** | — |
| **Institute / Strategic — historical GAO** | **NOT YET** → set **if #1590 merges** | 212 mis-attributed rows reachable from agency reads |
| **Institute / Strategic — legislation** | **NOT YET** | no `CONGRESS_API_KEY` in production; corpus reaches no surface |
| **Research / Lab** | **NOT YET** → set **if #1591 merges** | two producers still reporting success over nothing |
| **SBIR** | **OPERATIONALLY SET as represented** | coverage is expansion, not integrity |

### If #1590, #1591 and #1593 merge

- **No known silent fabricated claim remains.** The CJ-outlay P0 is closed and
  verified; unsourced priorities are typed and dollar-sanitized (#1579); the 212
  mis-attributed GAO rows become unreachable from agency reads (#1590).
- **No known false-green producer remains running.** DARPA and NSF are parked
  (#1591); `research_producer_status()` makes the condition observable.
- **Long-job outcomes become observable** on the four wired routes (#1593),
  without changing dispatcher semantics.

**Then every domain is OPERATIONALLY SET except legislation**, whose blocker is a
missing credential and an unwired surface — both known, truthfully represented,
and not misleading any customer.

---

## D3 — product expansion, NOT integrity debt

These may remain unfinished without blocking operational closeout, because each
is **known, truthfully represented, controlled, and not misleading customers**:

| Item | Why it is expansion |
|---|---|
| **SBIR coverage** (1 of ~11 agencies) | the 42 rows are accurate; the gap is registered, not hidden |
| **Army proper / Air Force forecasts** | Air Force awaits FCO upstream; both absent, neither faked |
| **Manual Gateway slices** | `content_stale` + `required` — honest |
| **Priority source recovery** (2,500 claims) | typed `LEGACY_MANUAL`, dollar-sanitized, never presented as agency-stated |
| **Vendor person identity** (82,017) | `unmeasured`; no email exists, so no key is possible yet |
| **Broader legislation beyond NDAA** | scope is stated, not implied |

## Integrity debt that remains (distinct from the above)

1. **The 212 GAO rows are still mis-attributed in the record.** #1590 makes them
   unreachable; correcting them is a separate destructive decision.
2. **`CONGRESS_API_KEY` is absent in production** — legislation runs on a
   fallback key.
3. **~8 long jobs still unconfirmed** (`sync-recompete-contracts` 719 runs,
   `backfill-recipient-certs` 709, `enrich-recompete-detail` 709, …). #1593 wires
   four; the same one-line change extends to the rest.
4. **DIBBS 13% job error rate** — advancing, so monitored rather than repaired.
5. **An admin password is stored inline** in the `snapshot-multisite-nih`
   `cron_jobs.route` value.

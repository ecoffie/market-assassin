# Data Core — final reconciliation

**Date:** 2026-09-20 · **READ ONLY.** Measured against `origin/main` @`7059287b`
and live production. Every number below was re-measured today; none is inherited
from an earlier audit.

**Scope note:** this reconciles the state *as it stands on main* and names what
the three open PRs would change. **No PR is merged**, so nothing here claims a
production effect from unmerged work.

---

## 1. The matrix

| Domain | Source family | Physical rows | Canonical source | Producer | Schedule | Currentness | Provenance | Identity | Control plane | Customer exposure | Phase II | Open PR | Remaining blocker |
|---|---|---:|---|---|---|---|---|---|---|---|---|---|---|
| **Forecast** | 12 agency sources | **35,912** | agency portals | 21 scrapers | `0 13 * * *` | **CURRENT** (advance 09-20) | source URLs held | ONE resolver (`agency-identity.ts`) | **12 instances** · 5 current, 2 stale, 3 unreachable, 2 unmeasured | Maps · MCP · alerts | **CONTROLLED_PARTIAL** | — | 7 sources need a human |
| **Decision Makers** | SAM notice POCs | **212,415** | `sam_opportunities.points_of_contact` | `sync-decision-makers` | `0 */2 * * *` | **CURRENT** — backfill pass **COMPLETE** 22:00Z | `notice_id::slot`, source-native | email key (23,201) | 1 instance, `current` | roster surfaces, MCP | **CLOSED** (identity substrate pending) | **#1582** | denominator decision |
| **Decision Makers** | SAM entity POCs | **82,017** | SAM entity registrations | manual import | — | **UNMEASURED** | `uei::slot` | **no email at all (0)** | 1 instance, `unmeasured` | teaming | **BLOCKED_CONTROLLED** | — | needs a different key |
| **Institute / Strategic** | GAO | **49** | `gao.gov/rss/reports.xml` | `institute-gao-sync` | `20 12 * * *` | **CURRENT** — 25/25 feed items held | 49/49 URL + doc id | `resolveAgency()` | 1 instance, `current` | pain points, MCP | **CLOSED** | — | — |
| **Institute / Strategic** | Congress (NDAA) | **29** | `api.congress.gov` | `institute-legislation-sync` | `40 13 * * 0` | **CURRENT** (watermark 07-30) | 29/29 URL | 28/29 → DoD | 1 instance, `current` | **none — unreachable by users** | **CONTROLLED_PARTIAL** | — | no `CONGRESS_API_KEY`; cron never resolved |
| **Institute / Strategic** | GovInfo GAO archive | **445** | GovInfo GAOREPORTS | one-shot 2026-04-19 | none | **HISTORICAL_ONLY** (pub 1993–2000) | URL + date held | **133 titles fan out 2–4 agencies; 148 rows non-canonical** | **none** | agency intel | **PHASE_II_REQUIRED** | — | **A2 not started** |
| **Institute / Strategic** | USASpending contract_pattern | **111** | USASpending toptier | one-shot | none | **HISTORICAL_ONLY** | descriptions **nulled** (P0) | agency-keyed | none | suppressed | **CONTROLLED_PARTIAL** | — | rows retained, claim removed |
| **Institute / Strategic** | Static claim corpus | **5,543** (2,500 priorities + 3,043 pain points) | hand-curated | manual / out-of-repo | none | **UNMEASURED** — all `UNDATED` | **0 URLs · 0 source tags · FULL provenance 0** | 16.4% canonical | `data_sources` row only, **no instance** | proposals · public APIs · reports | **PHASE_II_REQUIRED** | **#1579** | source recovery undecided |
| **DIBBS** | DLA DIBBS | **57,816** | dibbs.bsm.dla.mil | `sync-dibbs` | `0 8 * * *` | **CURRENT** (1d) | flat-file native ids | RFQ number | **none → 1 (#1583)** | opportunity surfaces | **CONTROLLED_PARTIAL** | **#1583** | 13% job error rate |
| **Grants** | Grants.gov | **2,149** | grants.gov API | `sync-grants` | `0 9 * * *` | **CURRENT** (0d) | opportunity id | native id | **none → 1 (#1583)** | Grants panel, MCP | **CLOSED** (pending registration) | **#1583** | — |
| **Research/Lab** | NIH RePORTER | **1,416** | api.reporter.nih.gov | `snapshot-multisite-nih` | `0 4 * * *` | **BEHIND_UPSTREAM** (6d) | source URL | external id | **none → 1 (#1583)** | Research panel | **REQUIRES_REPAIR** | **#1583** | job never resolves outcome |
| **Research/Lab** | Grants.gov slice | **63** | grants.gov | `snapshot-multisite-*` | daily | **BEHIND_UPSTREAM (161d)** | source URL | external id | **none → 1 (#1583)** | Research panel | **REQUIRES_REPAIR** | **#1583** | dormant, cause unknown |
| **Research/Lab** | DARPA BAA | **6** | darpa.mil | `snapshot-multisite-darpa` | `0 5 * * *` | **BEHIND_UPSTREAM (168d)** | source URL | external id | **none → 1 (#1583)** | Research panel | **REQUIRES_REPAIR** | **#1583** | **reports 200 daily while dead** |
| **Research/Lab** | NSF SBIR | **0** | nsf.gov | `snapshot-multisite-nsf` | `0 6 * * *` | **UNMEASURED — never advanced** | n/a | n/a | **none → 1 (#1583)** | none | **BLOCKED_CONTROLLED** | **#1583** | **reports 200 daily, never wrote a row** |
| **SBIR** | NIH slice only | **42** | inherits NIH | inherits | `0 4 * * *` | **BEHIND_UPSTREAM** (6d) | external id | external id | via NIH instance | SBIR panel, MCP | **REQUIRES_REPAIR** | **#1583** | **1 of ~11 agencies** — product decision |

**Currentness is deliberately not reduced to green/red.** `CURRENT` ·
`BEHIND_UPSTREAM` · `UNMEASURED` · `BLOCKED` · `HISTORICAL_ONLY` are distinct
claims, and three of them are not failures.

---

## 2. Control-plane coverage

| Dataset | Instances | current | content_stale | unreachable | unmeasured | needs human | held |
|---|---:|---:|---:|---:|---:|---:|---:|
| `forecast_intelligence` | 12 | 5 | 2 | 3 | 2 | 7 | 27,355 |
| `decision_makers` | 2 | 1 | 0 | 0 | 1 | 0 | 294,432 |
| `strategic_intelligence` | 2 | 2 | 0 | 0 | 0 | 0 | 78 |
| `specialty_feeds` | **0 → 6 (#1583)** | | | | | | |
| **Total on main** | **16** | 8 | 2 | 3 | 3 | 7 | 321,865 |

**Uncontrolled and material:** the 5,543 static strategic claims, the 445 GovInfo
GAO rows, the 111 contract_pattern rows, `sam_opportunities` (RES-003's only
input), and all four specialty feeds until #1583 lands.

---

## 3. Three findings that recur across every domain

### 3.1 Job success is not data advancement
- `snapshot-multisite-darpa` — **30/30 `success` + HTTP 200, dead 168 days**
- `snapshot-multisite-nsf` — **30/30 `success` + HTTP 200, never wrote a row**

Sixty consecutive green checkmarks over two corpses. Caught only by a **data**
clock; no job-level monitor could see it.

### 3.2 A job that never reports an outcome proves nothing either way
Five jobs record `status='dispatched'`, `http_status=NULL` and never resolve:
`institute-legislation-sync` · `precompute-opp-intel` · `sync-decision-makers` ·
`snapshot-multisite-nih` · occasionally `sync-dibbs`.

Every one of those was proven by its **effect** instead — the cursor, the data
clock, the row count. ⚠️ Worth a dispatcher-level decision: an unresolved job is
currently indistinguishable from a healthy one.

### 3.3 A denominator that counts what the pipeline deliberately rejects
Decision Makers reads **79.8%** forever because `decision_makers_upstream_slots()`
counts role-mailbox slots the drain intentionally refuses. **45,924 of the 53,698
"missing" slots are one address** (`dibbsbsm@dla.mil`). Person-level coverage is
**~99.5%**. Left unchanged on purpose — see #1582.

---

## 4. Open PRs

| PR | Domain | Production write needed | Risk |
|---|---|---|---|
| **#1579** | Institute / Strategic | **No** — code only | Low. Public API shapes change (`fundingAmount` → null, `claimProvenance` added). |
| **#1582** | Decision Makers | **Yes** — migration (2 views, 2 functions) | Low. Additive, no data mutation, `DROP` to roll back. |
| **#1583** | Specialty feeds | **Yes** — migration (2 functions, 6 instance rows) | Low. Additive, repairs nothing. |

---

## 5. Not started, with evidence for the ordering

- **A2 — agency attribution repair.** 133 GovInfo GAO titles fan out across 2–4
  agencies (307 of 445 rows); 148 rows carry non-canonical identities including
  `General Government` (141) and parse artifacts (`Department of the`). Untouched
  deliberately: the P0 taught that an instance-scoped repair does not close a class.
- **A3 — remaining source control.** `sam_opportunities` still has no
  `data_source_instance`, so **RES-003 — the Institute's only public publication —
  rests on an input whose staleness the control plane cannot detect.** Smallest
  correct next step and it is genuinely small.
- **Legislation hardening.** No `CONGRESS_API_KEY` in production; the weekly cron
  has never resolved an outcome; 1 of 29 titles still carries duplicated
  decoration; all 29 rows reach **zero** user surfaces.

**Recommended order: A3 → A2 → source recovery.** A3 is the smallest and closes a
live publication risk. A2 is bounded and well-measured. Source recovery for the
2,500 priorities is a product decision, not an engineering task — #1579 makes
them safe to consume, which removes the urgency.

---

## 6. Residual gaps

1. **FULL provenance for priorities is 0 of 2,500.** #1579 makes that visible and
   safe; it recovers nothing.
2. **Vendor identity is unsolved** — 82,017 rows, no email, needs a different key.
3. **SBIR is 1 of ~11 agencies.** Product decision.
4. **DARPA / NSF** — repair or retire. Running them unchanged is the worst option:
   they manufacture evidence of health.
5. **23% of decision-maker identities are `unknown`.** Genuine ambiguity; narrowing
   needs an agency directory, not a looser regex.
6. **Dispatcher `dispatched`-forever** — see 3.2.

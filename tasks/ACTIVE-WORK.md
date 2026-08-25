# ACTIVE WORK — read this BEFORE writing code

> ## ⛔ BUG-FIX MODE (Eric, 2026-08-25)
> **No new Rule-of-Two or SBA-data capabilities unless they are required to close an
> existing bug.** The SBA certification-freshness track is FROZEN — see
> `tasks/FROZEN-sba-certification-track.md`. Do not resume it, do not start NAICS-wide
> SBA exports, certification bulk pipelines, or new Rule-of-Two enhancements.
>
> **Prioritise by user-visible workflow, not data elegance.** The product test is:
> *can a user ask Mindy a real GovCon question and get the right company, right market,
> right incumbent, right suppliers, and the right next action?*

Multiple Claude threads work this repo concurrently and **cannot talk to each other.**
GitHub and this file are their only shared memory.

## Task 0 for every coding session

```
1. git fetch origin
2. record the current origin/main SHA
3. read this file
4. inspect PRs merged since your branch base:  git log --oneline <base>..origin/main
5. search open PRs for your topic:             gh pr list --search "<topic>"
6. CLAIM your work below — when you START, not when you finish
7. only then create or edit code
```

> **If another thread owns overlapping scope, STOP and report. Do not implement across the
> boundary.** File what you found and hand it to the owning track.

## Why this exists — two real incidents, one session

**DEFECT-7.** A thread investigated `lookup_sam_entity` returning `degraded:true`, filed it,
and carried it as "open" for hours. It had already been fixed and merged in **#1319/#1320**.

**DEFECT-10 / SAM preservation.** A thread built a five-archetype audit and an `E`-flag fix
while **#1322–#1326** landed doing the same work. Its branch accumulated **711 deletions** of
files another thread had added. Opening that PR would have **deleted merged work from main.**
It was rebuilt from `origin/main` instead. Main then moved *again* mid-rebuild (**#1328**).

Cost: two duplicated investigations and a near-miss regression.

## Track ownership — one thread per track

| Track | Scope |
|---|---|
| **SAM preservation / field semantics** | ingestion, extract parsing, `sam_entities` schema, archive, provenance |
| **MCP decision-chain** | `market-research.ts`, `market-depth`, Rule-of-Two semantics, tool payloads |
| **Website / SEO / cache** | public pages, sitemap, `queryCached` render paths |
| **Product / Mindy UX** | app surfaces, onboarding, pipeline |

A thread that discovers something in another track **files it and stops.**

## Claims

| Item | Owner | Branch | Base | Status | Do not duplicate |
|---|---|---|---|---|---|
| DEFECT-10 size-status completeness | thread-mcp-decision-chain | `fix/defect-10-size-status` | `ededa644` | in review | #1323 already persists `E`; #1328 already does cert dates |
| _(none — SBA cert track FROZEN 2026-08-25)_ | — | — | — | — | — |

### MCP trial pricing — FROZEN 2026-08-25

`tasks/FROZEN-pricing-evidence.md`. Aggregate did NOT support a change (wall correlates
with engagement: 60% vs 15% return). ⚠️ ONE finding to act on when the freeze lifts:
`capability_market_match` costs 100 credits = the entire signup grant; one user spent the
whole trial on their first call and never returned. n=1 — record, don't redesign.

### New-user onboarding — FROZEN 2026-08-25

`tasks/FROZEN-new-user-onboarding.md`. **Do not redesign until traffic accumulates.**
Before any new-user path change: `npx tsx scripts/verify-new-user-migration.mts` (29 prod
checks). Broken contract → fix immediately. Surprising behavior → measure first.

### Decision Chain Hardening — PHASE 1 COMPLETE 2026-08-25

**Triage with `src/mcp/decision-chain/FAILURE-TAXONOMY.md`, not this ledger.** Five classes:
evidence missing · exists-but-unreachable · reached-but-misinterpreted · correct-but-ignored ·
genuinely-insufficient→abstain. The class determines the fix; the symptom does not.

**PHASE 2 IS USAGE, NOT CONSTRUCTION.** Stop changing the chain. Run 10-20 real companies
through it and classify what breaks. Real usage decides what is next — not a backlog.

Eight defects found by running the chain end-to-end, not by reading the ledger. All
merged and verified on production.

| # | defect | proof |
|---|---|---|
| CHAIN-1 | live EMPTY SAM result asserted non-existence | #1350 |
| CHAIN-2A | two tools contradicted on award-history EXISTENCE | #1351 |
| NS-1 | local fallback discarded facts the mirror held | #1352 |
| NS-3 | operational customer unknowable from the fields read | #1354 |
| NS-2 | company's own vehicles unreachable (ranked ~568 of 6,864) | #1355 |
| CHAIN-3 | decision layer re-derived the market from keywords | #1356 |
| — | behavioral gate frozen + generalization test | #1358 |

**THE GATE — run this before touching the decision chain:**

```
npx tsx scripts/verify-decision-chain.mts
```

It runs the REAL chain against LIVE data and asserts on the DECISION. Every defect above
was invisible to component tests; this gate caught two more in a single run ("FPO" as a
customer, an un-ranged award query). `--company "Name"` explores any company.

**Frozen fixtures:** North Star must keep surfacing Space Launch Delta 30 / its SABER task
order. Fluidyne must keep reasoning from its 33 real awards and must NOT drift into
ammunition NAICS or present Boeing/Raytheon as peers.

### Open — reachability gaps (filed, not fixed)

| gap | consequence | note |
|---|---|---|
| **GAP-A** GSA vehicle prefixes | `47QMCA` fails the DoDAAC shape check, so attribution + anchoring never run. Central Kenworth: 161 awards, all "Unattributed", 0 pursuits | the directory ALREADY resolves 47QMCA → GSA/FAS AUTOMOTIVE CENTER; the pattern blocked it, not the data |
| **GAP-B** UEI the award mirror doesn't use | 3 Booz Allen UEIs in `sam_entities`, all 398 award rows credit a 4th → 0 awards found | the refusal says "no award history was established" when the truth is "we hold 398 and could not link them" — different claims |
| **CHAIN-2B** award-history plumbing | `get_contractor_award_history` still returns `award_count: 0` for Fluidyne | contradiction closed (#1351); the tool still cannot SHOW the 33 awards |
| `usaspending_awards` 880 rows | corpus-shaped table, sync never scheduled | `tasks/DEFECT-usaspending-awards-880-rows.md` |
| `recipient-certs.ts` | calls `getEntityByUEI` directly, NOT audited in the P0 sweep | caching path, not a user-facing answer |

Both GAPs are **reachability, not correctness** — no company in the blind test received a
fabricated or misattributed recommendation, and the refusal path behaved as designed.

### Open, prioritised by user-visible impact (bug-fix mode)

| Defect | Sev | The user-visible symptom |
|---|---|---|
| ~~**DEFECT-9B** retrieval quality~~ | ~~P1~~ | **CLOSED 2026-08-25 — PR #1347.** Performer-seeded retrieval: eligible performers reaching the scorer 208 → 6,496 of 6,496 (100%); 9-10 of the top 10 returned suppliers now have real award history. Acceptance: `node scripts/verify-9b-retrieval.mjs` |
| ~~**DEFECT-8** capability vs interest~~ | ~~P1~~ | **CLOSED 2026-08-25 — PR #1348, prod-verified.** Trace disproved the filed reading (click codes are mostly ACCURATE; 0 of 39 users had a wrong-industry alert profile) and found a real defect underneath: two writers, incompatible shapes, `admin/debug-profile` reporting 63 FALSE invalid-NAICS. Read seam in `src/lib/profile/naics-signal.ts`. Writer cleanup filed: `tasks/FILED-naics-writer-schema-cleanup.md` |
| Testing debt | P1 | Source-text tests pass while the answer is wrong. A green suite is not evidence the decision chain is right. |
| `recipient-certs.ts` UEI path | P2 | Calls `getEntityByUEI` directly and was NOT audited during the P0 sweep. A caching path, not a user-facing answer — but it has never been checked against the local-first rule. |

### Closed this session — do not re-investigate

| Item | Resolution |
|---|---|
| P0-1 market classification | Development stopped; safety gate shipped; holdout sealed |
| P0-2 empty enrichment | CLOSED — production verified |
| P0-3 size vs socioeconomic | CLOSED — production verified |
| DEFECT-9A sampled-as-population | CLOSED — production verified |
| DEFECT-7 `lookup_sam_entity` | FIXED — #1319/#1320. SAM-key rotation is ops work |
| SAM provenance coverage | CLOSED — 887,310 stamped; 22,813 correctly NULL |
| **P0 UEI existence** | **CLOSED 2026-08-25 — PR #1344 merged + prod-verified.** Local mirror is authoritative for existence; live SAM only enriches. `unavailable` (503) is now distinct from `not_found` (404) and `malformed` (400) — an outage can no longer render as "invalid UEI" or "register at sam.gov first". Re-run before any demo: `node scripts/verify-uei-webinar.mjs` |
| 8(a) current-eligibility | CLOSED — PR #1341 merged + prod-verified. 1,444 false-current removed, 0/30 Rule-of-Two flips. Re-runnable: `node scripts/verify-8a-certcurrency.mjs` |
| SBA certification freshness layer | **FROZEN** — `tasks/FROZEN-sba-certification-track.md`. Migration applied but UNREAD by product code. Do not resume without a new decision. |

### Open, unclaimed

| Item | Priority | Note |
|---|---|---|
| DEFECT-9B retrieval quality | P1 | Unordered arrival governs the supplier list |
| DEFECT-8 capability vs interest | CLOSED #1348 | read seam ships; writer cleanup filed separately |
| SBA exception-aware size determination | next capability | Converts DEFECT-10 `undetermined` into real answers |
| SAM field materialization | in progress elsewhere | `purposeOfRegistration`, JV structure — check merged PRs first |

## Stale-branch gate

Before opening a PR:

```bash
git fetch origin main -q
git diff --diff-filter=D --name-only origin/main..HEAD    # MUST be empty
git diff --stat origin/main..HEAD | tail -1               # deletions should be ~0
```

**Any file deleted that you did not intentionally delete = STALE BRANCH.** Rebuild from
`origin/main` rather than reconciling — a blind rebase risks resurrecting removed code.

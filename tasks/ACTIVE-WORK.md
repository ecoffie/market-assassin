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

### Open, prioritised by user-visible impact (bug-fix mode)

| Defect | Sev | The user-visible symptom |
|---|---|---|
| **DEFECT-9B** retrieval quality | P1 | Supplier list is **not truly top-N by merit** — unordered arrival governs which suppliers a user sees. A user asking "who can do this work" gets an arbitrary slice presented as the best. |
| **DEFECT-8** capability vs interest | P1 | `extracted_naics_codes` is written from CLICKS, conflating "I looked at this" with "I can do this" — corrupts matching and alerts. |
| Testing debt | P1 | Source-text tests pass while the answer is wrong. A green suite is not evidence the decision chain is right. |

### Closed this session — do not re-investigate

| Item | Resolution |
|---|---|
| P0-1 market classification | Development stopped; safety gate shipped; holdout sealed |
| P0-2 empty enrichment | CLOSED — production verified |
| P0-3 size vs socioeconomic | CLOSED — production verified |
| DEFECT-9A sampled-as-population | CLOSED — production verified |
| DEFECT-7 `lookup_sam_entity` | FIXED — #1319/#1320. SAM-key rotation is ops work |
| SAM provenance coverage | CLOSED — 887,310 stamped; 22,813 correctly NULL |
| 8(a) current-eligibility | CLOSED — PR #1341 merged + prod-verified. 1,444 false-current removed, 0/30 Rule-of-Two flips. Re-runnable: `node scripts/verify-8a-certcurrency.mjs` |
| SBA certification freshness layer | **FROZEN** — `tasks/FROZEN-sba-certification-track.md`. Migration applied but UNREAD by product code. Do not resume without a new decision. |

### Open, unclaimed

| Item | Priority | Note |
|---|---|---|
| DEFECT-9B retrieval quality | P1 | Unordered arrival governs the supplier list |
| DEFECT-8 capability vs interest | filed | `extracted_naics_codes` written from clicks |
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

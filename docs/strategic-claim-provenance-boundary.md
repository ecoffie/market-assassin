# The strategic-claim provenance boundary (A1)

**Date:** 2026-09-20 · **Baseline:** `origin/main` @`297e3136` · measured, not inherited.

## The gap

`sourced-pain-points.ts` already models provenance correctly — `SOURCE_FACT` /
`MINDY_INTERPRETATION` / `LEGACY_MANUAL` — and since #1577 strips unsourced dollar
amounts from legacy claims. **None of that helps a module that never calls it.**

### Measured priority universe (re-measured at 297e3136, not reused)

| | Priorities | Pain points |
|---|---|---|
| Total | **2,500** | 3,043 |
| With a source URL | **0** | **0** |
| With a `(Source: …)` tag | **0** | 278 |
| With a document id | 8 | 85 |
| Carrying a dollar figure (raw file) | **1,678** | 384 |
| **FULL provenance** | **0** | **0** |
| PARTIAL | 8 | 363 |
| **NONE** | **2,492 (99.7%)** | 2,680 |

Every DB priority source is empty — `agency_priorities_db` 0, `budget_priority` 0,
`contract_pattern` descriptions 0 after the P0. So **all 2,500 priorities have exactly
one origin: the static corpus.** There is no living priority pipeline.

Agency identity overlap: only **410 of 2,500 (16.4%)** sit under a canonical toptier
agency name; 2,090 are under component/alias names. Provenance debt and identity debt
overlap heavily — relevant to sequencing A2.

## What was actually leaking

| Surface | Before |
|---|---|
| **Proposal drafting** (`agency-context.ts`) | Fed the model `**Stated strategic priorities:**` + `**Current pain points the agency is solving for:**` over the whole legacy corpus. **8 of 10 DoD priorities carried a raw dollar figure.** "Stated" asserts the agency said it; 0 of 2,500 carry a URL. |
| **`/api/budget-intel`** (PUBLIC, 200, no auth) | Parsed the prose dollar into a **structured `fundingAmount`** — uncited prose upgraded to a machine-readable financial fact, with three measured bugs: 51 priorities spell the unit out (`$135 billion` → regex matched `$135` → **135 dollars**, a billion-fold understatement); 58 carry multiple amounts and only the first was read; `$1.2T` has no `T` branch and returned `1.2`. |
| **`/api/agency-sources`** (PUBLIC, 200) | Emitted raw prose claims with **no provenance field at all**, and `Top agency challenge: …` as an assertion. |
| **`data-aggregator.ts`** | Unsanitized claims into customer market-research reports. |
| **`/api/lindy/match`** | Returned matched claim text unsanitized. |

`MyTargetListPanel` was a **false positive** in the earlier audit — its
`agency-pain-points.json` reference is a comment; it fetches the provenance-aware
`/api/pain-points`. Corrected here.

## What changed

**`src/lib/strategic-intel/strategic-claims.ts`** — one typed contract:
`claim · claimType · agency · canonicalAgency · sourceAuthority · sourceUrl ·
sourceDate · sourceId · provenance · sourceType · temporalStatus · citable ·
displayLabel`.

- `ClaimType` = `AGENCY_STATED | MINDY_INTERPRETATION | LEGACY_MANUAL | UNKNOWN`,
  separate from `provenance` (how well evidenced) — a surface needs both to pick a heading.
- `citable` requires authority **and** document **and** URL. A `SOURCE_FACT` without a
  URL is not promoted. A legacy `(Source: GAO)` tag names an authority and **never**
  earns citability.
- `temporalStatus` comes from SOURCE dates only. No publication date → `UNDATED`.
  **Mindy ingest time is never substituted** — the whole legacy corpus is `UNDATED`,
  which is the honest answer.
- `citableClaimsOnly()` for high-stakes surfaces, where a disclaimer has nowhere to live.

**Display semantics** (`DISPLAY_LABEL` / `DISPLAY_DISCLOSURE`) — wording is part of the
claim. `Agency-stated priority` ≠ `Mindy interpretation` ≠ `Legacy context (unsourced)`.

**Consumers migrated:** proposal drafting, `/api/budget-intel`, `/api/agency-sources`,
`data-aggregator`, `/api/lindy/match`.

**`fundingAmount` is now always `null` on the public path.** A number nobody can source
should not be emitted as a number at all. The prose is still returned, sanitized.

**The one numeric claim kept** is the budget trend — and it now carries its citation
(OMB FY2026 Discretionary Budget Request + CBJs, with URL and `as of` date). It was the
only genuinely sourced figure in that prompt.

**New gate** `scripts/audit-strategic-claim-bypass.mjs`, wired as pre-push step 6b.
It flags an **unsanitized** raw-corpus read in a customer-facing module — not the import
itself, because admin counters, integrity reports and build scripts read raw rows
legitimately, and a module piping rows through `@/lib/strategic-intel/*` is already safe.
Baselined at **0**. Proven: inject a raw import → exit 1 → revert → exit 0.

## What explicitly did NOT change

- **No priority deleted, no JSON rewritten, no opportunity mutated.** Raw evidence intact.
- GAO untouched. Legislation untouched. Agency-identity fan-out untouched (A2).
- `agency_intelligence`, `institute_sources`, `agency_pain_points_db` untouched.
- The corpus still ships all 2,500 priorities — they are now typed and sanitized on read,
  not removed from the record.
- `pain-points-linker.ts` needed no change: #1577 already sanitizes both fields there.

## Known limitations

- `getAgencyLegacyClaimsSync` returns legacy claims only (no DB round-trip). Proposal
  drafting is sync, so it sees no living GAO rows. Everything it returns is
  `LEGACY_MANUAL`, so it cannot be mistaken for fact — but making `buildAgencyContext`
  async would let drafting cite GAO evidence. Deferred; it ripples into `v2.ts`.
- `FULL` provenance for priorities remains **0**. This PR makes that visible and safe to
  consume; it does not recover sources. Source recovery is a separate decision.
- #1577's sanitizer can leave slightly awkward grammar ("Allocated for hypersonic
  weapons…"). Meaning is preserved and the unsourced number is gone; polishing the regex
  was out of scope here.
- `/api/agency-hierarchy` and `pain-points-linker` sanitize but do not yet carry
  `claimType`. Safe, not yet fully typed.

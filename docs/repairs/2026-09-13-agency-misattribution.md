# Potato 0 — Agency mis-attribution repair (2026-09-13)

**Scope:** 15 PROVEN attribution defects in the shipped pain-point corpus
(`src/data/agency-pain-points.json`). **13 de-duplications + 2 moves.**
No mass migration, no fuzzy inference, no error-rate estimate.

---

## Root cause (proven, not inferred)

Established by **executing** the real `extractAgenciesFromTitle` from
`src/lib/agency-intelligence/fetchers/govinfo.ts` against the actual stored titles.
Two unanchored-substring collisions in `AGENCY_MAPPINGS`:

| Alias key | Maps to | Matched inside | Result |
|---|---|---|---|
| `"ICE"` | Department of Homeland Security | "Serv**ICE**s" / "Serv**ICE**" | HHS + SSA findings filed under **DHS** |
| `"EPA"` | Environmental Protection Agency | "D**epa**rtment" | Interior + HHS findings filed under **EPA** |

Two compounding defects:
1. **Fan-out with no primary.** `extractAgenciesFromTitle` returns *every* match and
   the caller writes **one row per match**, so a single GAO report is stored under
   multiple agencies. Measured: **134 titles fanned across 309 rows**, worst case 4.
2. **A `/Department of (\w+)/` fallback** persisted junk keys verbatim —
   `"Department of the"`, `"Department of Health"`.

⚠️ **The VA rows are a DIFFERENT, still-unexplained cause.** No VA alias key matches
those three titles, so today's code cannot produce them; it would file them as
`General Government`. They were written in a distinct batch
(`created_at 20:38:31.169926` vs the correct rows at `20:45:09`). The repair is still
valid — the titles name their own subject agency — but the *write-side* mechanism for
VA remains unproven and is **left open**.

---

## Repair ledger — before → after

All 15 proven because the GAO title **names its own subject agency**.

### A. De-duplications (13) — correct copy already existed

| # | Finding (GAO title) | Removed from | Correct agency (kept) |
|---|---|---|---|
| 1 | Hazardous Waste: Observations on EPA's Cleanup Program | Veterans Affairs | Environmental Protection Agency |
| 2 | Air Traffic Control: Observations on FAA's … Modernization | Veterans Affairs | Transportation |
| 3 | Department of the Interior: Observations on Performance Plan | Veterans Affairs | Interior |
| 4 | Department of Health and Human Services: Strategic Planning | Homeland Security | Health and Human Services |
| 5 | Social Security Administration: SSA Needs to Act Now | Homeland Security | Social Security Administration |
| 6 | SSA Customer Service: Broad Service Delivery | Homeland Security | Social Security Administration |
| 7 | Department of the Interior: Observations on Performance Plan | Environmental Protection Agency | Interior |
| 8 | Department of Health and Human Services: Strategic Planning | Environmental Protection Agency | Health and Human Services |
| 9 | Department of the Interior: Year 2000 Computing Crisis | Environmental Protection Agency | Interior |
| 10 | Social Security Administration: SSA Needs to Act Now | Securities and Exchange Commission | Social Security Administration |
| 11 | Department of the Interior: Observations on Performance Plan | `Department of the` (junk) | Interior |
| 12 | Department of the Interior: Year 2000 Computing Crisis | `Department of the` (junk) | Interior |
| 13 | Department of Health and Human Services: Strategic Planning | `Department of Health` (junk) | Health and Human Services |

### B. Moves (2) — no correct copy existed; a delete would have LOST data

| # | Finding | From | To |
|---|---|---|---|
| 14 | Department of Health and Human Services: Management Challenges | `Department of Health` (junk) | Health and Human Services |
| 15 | Social Security Administration: Information Technology Challenges | Department of Commerce | Social Security Administration |

**This distinction was caught by a pre-write verification pass.** Treating all 15 as
deletes would have silently destroyed two findings.

---

## Verification (all passed)

| Check | Result |
|---|---|
| Corpus total | 3,045 → **3,032** (−13; the 2 moves are net-zero) |
| Each of the 15 exists **exactly once**, under its proven subject | ✓ 9/9 distinct findings |
| None of the 15 disappeared | ✓ |
| Entries removed / added | **15 / 2** — exactly the intended blast radius |
| **Priorities untouched** | 2,658 → **2,658** ✓ |
| Agency keys untouched | 307 → 307 ✓ |
| Junk buckets now empty | `Department of the` 2→0, `Department of Health` 2→0 |
| **Customer-facing reader** (`getPainPointsForAgency`) | ✓ 7/7 — VA/DHS/EPA no longer return other agencies' findings |
| Regression tests | 48 passing (20 corpus + 28 resolver) |
| Resolver ratchet proven | inject substring sweep → **4 red** → revert → **28 green** |

---

## Recurrence prevention

`src/lib/strategic-intel/agency-resolver.ts` — the canonical resolver for all NEW
Strategic Intelligence writes. Extends the refuse-rather-than-guess contract from
`competition-depth.ts` `resolveToptier`, adding a resolution **method** and
**confidence** (which no existing resolver carried).

- Identifiers (CGAC code) beat names
- Matching is **anchored and explicit** — never `haystack.includes(alias)`
- Generic words (`DEPARTMENT`, `AGENCY`, `OFFICE`, `GENERAL GOVERNMENT`…) never
  establish identity
- **Unresolved stays unresolved** — no junk bucket, no nearest-match
- A sub-agency never silently inherits an unrelated cabinet agency

---

## Deliberately NOT touched (follow-up Potato)

Discovered but **not individually verified**, so left alone:

1. **The fan-out defect is broad** — 134 titles across 309 rows in
   `agency_intelligence`. Only the 15 above were title-proven.
2. **`General Government` is the largest GAO bucket** — 141 of 446 rows (32%), the
   "nothing matched" fallback.
3. **The `Department of Commerce` bucket holds SSA, IRS, VBA, GSA and NCUA findings.**
   Only the SSA one was repaired; the rest are unverified.
4. **The DB (`agency_intelligence`) was not repaired** — this pass corrected the
   *shipped* corpus only. Two DB rows (VA←"FAA's Modernization Program",
   DHS←"HHS: Management Challenges") never reached the shipped JSON.
5. **The VA write-side mechanism is unexplained** (see Root cause).
6. **The read path has its own substring bug**: `agency_name.ilike.%VA%`
   (`agency-intelligence/index.ts:204`) matches "Ad**va**isory Council on Historic
   Preser**va**tion", "Na**va**jo", "Pri**va**cy and Civil Liberties Oversight Board",
   "Overseas Pri**va**te Investment Corporation" — verified live. **Not fixed here.**

Each requires source-backed verification per record before any repair.

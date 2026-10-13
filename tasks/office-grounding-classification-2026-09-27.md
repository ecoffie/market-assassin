# Office grounding classification — `user_target_list` (repair board D-O)

**Date:** 2026-09-27 · **Mode:** READ-ONLY research. No production write, no writer code change.
**Branch:** `research/office-grounding-classification`

> Rules applied (approved): agency ≠ sub-agency ≠ buying office. Never manufacture office identity.
> A department or sub-agency name is not an office. A 4-digit code is an agency/sub-tier code, not an office.

## TL;DR

- **1,120 rows, 79 users** (full read, paginated `.range()`; `count: 'exact'` = 1,120).
- **Grounded today (G1): 70 rows / 19 users.** Only rows carrying a valid DoDAAC that resolves in
  `dodaac_directory` AND whose stored name agrees with that record.
- **Groundable from the row's own evidence (G2): 9 rows / 5 users.** All USACE districts + one NSWC,
  recovered by name via the directory. 4 of the 9 rest on a *truncated* name and need a human glance.
- **Not groundable without the user choosing (U1): 780 rows / 77 users.** 531 sub-agency-as-office,
  246 umbrella commands (ACC, NAVFAC, NAVSEA, AFMC…), 3 named offices with several codes.
- **Department-level, not groundable (U2): 204 rows / 69 users.**
- **Inconsistent / unknown (X): 57 rows / 17 users.** 7 carry a real DoDAAC whose record contradicts the
  stored name; 12 carry a DoDAAC-shaped code nobody knows; 38 carry an office-shaped name with no record.
- **58 of 79 users (73%) have zero grounded offices** on their target list.
- The automatic repair surface is therefore tiny (≤ 9 rows). Everything else is a **user-choice** or
  **relabel-honestly** problem, not a data-derivation problem.

## 1. Class counts

### Class × `added_from`

| class | auto_setup | profile_agency | target_list_search | triage_modal | research_drawer | total | users |
|---|---|---|---|---|---|---|---|
| **G1** | 8 | 37 | 0 | 24 | 1 | 70 | 19 |
| **G2** | 3 | 0 | 0 | 6 | 0 | 9 | 5 |
| **U1** | 289 | 394 | 45 | 49 | 3 | 780 | 77 |
| **U2** | 97 | 27 | 66 | 10 | 4 | 204 | 69 |
| **X** | 11 | 30 | 1 | 14 | 1 | 57 | 17 |
| total | 408 | 488 | 112 | 103 | 9 | 1120 | 79 |

"users" = distinct users (hashed) with ≥1 row in the class. A user can appear in several classes.

### Sub-classes

| class · sub-class | rows | users |
|---|---|---|
| G1 · dodaac_resolves_name_agrees | 65 | 18 |
| G1 · dodaac_resolves_stored_name_subset | 5 | 4 |
| G2 · unique_directory_name_match | 5 | 2 |
| G2 · unique_truncated_prefix_match | 4 | 4 |
| U1 · named_office_multiple_codes | 3 | 3 |
| U1 · sub_agency_as_office | 531 | 74 |
| U1 · umbrella_command | 246 | 47 |
| U2 · department_as_office | 204 | 69 |
| X · dodaac_resolves_name_conflicts | 4 | 4 |
| X · dodaac_resolves_name_partial | 3 | 3 |
| X · dodaac_shape_unverified | 12 | 9 |
| X · no_office_record | 38 | 14 |

**Reconciles to the baseline.** The 89 valid-DoDAAC rows split exactly: 70 G1 + 7 X (code resolves,
name contradicts) + 12 X (code not in directory, 0 SAM solicitations with that prefix) = 89.
U2 here is 204 vs the heuristic baseline's 188 because this pass also counts the **military
departments** (Army/Navy/Air Force — USASpending calls them sub-tiers, but they are not offices) and
single-level independent agencies (NASA, SBA, SEC, NTSB…) whose `office_name` is the agency itself.
The baseline's "792 sub-agency-as-office" was measured as `office_name == agency_name`; that test is
**unreliable** (see §2 — three writers put the *office label* into `agency_name`), so it is replaced
here by comparison against sub-tier and department vocabularies.

## 2. What each writer has in hand

All five live writers get their rows from the same upstream: `POST /api/usaspending/find-agencies`
(directly, or via the Market Research table that renders it). What that upstream emits is the root
cause:

- `contractingOffice` = USASpending **Awarding Office** name, **falling back to the sub-agency name
  when USASpending gives no office** (`find-agencies/route.ts` ~L869-875). The fallback is silent —
  `hasSpecificOffice` is computed but no writer reads it.
- `officeId` = `awardingSubAgencyCode || awardingAgencyCode` (~L889-903) — a **4-digit sub-tier code**,
  never a DoDAAC. The field name promises an office code; the value is a sub-tier code.
- The DoD FPDS-merge branch (~L1037, `fetchFPDSByNaics` in `src/lib/utils/fpds-api.ts`, which since
  FPDS retirement maps **SAM opportunities** into award shape) is the only path that can carry a real
  6-char DoDAAC — and it also emits SAM org ids / legacy 4-char codes (`CA09`, `BK05`, `CW05`) and
  labels like "Unknown Office".

| writer (`added_from`) | file | office identity in hand | where it falls back |
|---|---|---|---|
| `auto_setup` (408) | `src/app/api/app/auto-setup/route.ts` L199-229 | `a.contractingOffice` + `validOfficeCode(a.officeId)` (DoDAAC guard: only a 6-char code persists) | `office_name = contractingOffice \|\| a.name` → sub-agency/department when USASpending had no office. **`agency_name = a.name` = the office label**, not the agency. |
| `profile_agency` (488) | `src/lib/app/seed-target-list.ts` L120-190 | same scan, filtered by fuzzy agency-name match | same fallback; `office_code = a.officeId` **unguarded** (writes 4-digit sub-tier codes and legacy junk); `agency_name = a.name` = office label. |
| `triage_modal` (103) | `StartTrackingModal.tsx` L120-130 → `api/app/triage/route.ts` L185-205 | `current.contractingOffice \|\| current.name`, `office_code: current.officeId` | same fallback; `agency_name: agency_name \|\| office_name` (server) — can copy the office into the agency column. No DoDAAC guard, no directory lookup. |
| `research_drawer` (9) | `MarketResearchPanel.tsx` L4355-4377 → `api/app/target-list` POST L466-524 | `row.contractingOffice \|\| row.name`, `office_code: row.officeId` | **only writer with a directory lookup**: a valid DoDAAC is replaced by the `dodaac_directory_display` name. Otherwise same fallback. |
| `target_list_search` (112) | `MyTargetListPanel.tsx` L236-253 → `api/app/target-list` POST | **none** — a searched agency name is saved as `office_name` by design ("Agency-level target … refine later") | always agency/sub-agency level; no code. 66 of its 112 rows are departments. |
| `capability_text_seed` (0 rows) | `src/lib/mindy/coach-provision.ts` L110-150 | USASpending buyer + optional office | **correct behaviour already**: skips a buyer whose office is missing or equals the agency ("Relabelling the department as its own office would be a fabricated claim"). This is the pattern the other writers should adopt. |

Two consequences for any repair:
1. **`agency_name` cannot be trusted as the agency** on `auto_setup` / `profile_agency` / some
   `triage_modal` rows — it holds the office label. Classification must compare `office_name` against
   sub-tier/department vocabularies, not against `agency_name`.
2. **`office_code` is overloaded**: 6-char DoDAAC (89), 4-digit sub-tier (371), legacy/SAM 4-5 char
   codes (~81), empty (579). Only the first is office identity.

## 3. Evidence sources (read-only) and what each can prove

| source | what it proves | used here |
|---|---|---|
| `dodaac_directory` (4,826 rows, FPDS `awarding_office`; + `sam_office_name` 1,247) via `dodaac_directory_display` | code → canonical office name + sub_agency. **Civilian offices included** (USDA 593, DOJ 509, VA 311, GSA 280…), not DoD-only. Sample-based: it holds offices seen in awards, not every office that exists. | primary: G1 resolution, G2 name→code |
| `sam_opportunities.solicitation_number` prefix (224,428 rows) + `agency_hierarchy` | a DoDAAC is live if solicitations carry it as prefix | checked for all 62 distinct 6-char codes: the 7 not in the directory have **0** prefix hits |
| `federal_contacts` | contact rows keyed by solicitation / `office` (office column mostly NULL) | not an identity source — would only re-derive the same prefix |
| `isValidDodaac` / `normalizeAgencyKey` (`src/lib/gov-contacts/agency-key.ts`) | shape test only; agency-level key | shape gate |
| `OFFICE_ABBREVIATIONS` (`office-aliases.ts`) + `normalizeOfficeName` (`office-name.ts`) | ENDIST↔Engineer District, NAVSUP, MICC, AFLCMC, NSWC… | abbreviation-canonical name comparison |
| USASpending / BigQuery awards | awarding office per award | **not queried** (no BQ scans); the directory is already the FPDS-derived projection of it |

## 4. Method (reproducible, read-only)

1. Pull all 1,120 rows of `user_target_list` and all 4,826 rows of `dodaac_directory` with `.range()`
   pages of 1,000; confirm `count: 'exact'` = 1,120. Emails hashed (sha256, 8 hex) in memory; none
   written anywhere.
2. For every distinct 6-char code, count `sam_opportunities` rows with that `solicitation_number`
   prefix.
3. Canonicalise names on both sides: `&amp;`→`&`, uppercase, strip punctuation and a leading office
   code (`FA8614 `, `0413 `), expand `OFFICE_ABBREVIATIONS` first expansion plus a small token map
   (`FT`→FORT, `CTR`→CENTER, `FLT`→FLEET, `HQ`→HEADQUARTERS, `RCO`, `USTRANSCOM`, `NAVFACSYSCOM`…),
   drop stop-words. Compare as token sets.
4. Decision ladder per row (first match wins):
   - **G1** valid DoDAAC in directory AND stored name equals or is a subset of the record name.
   - **X** valid DoDAAC in directory but names only partially overlap (`dodaac_resolves_name_partial`)
     or are disjoint (`…_name_conflicts`); valid shape but absent from directory and SAM
     (`dodaac_shape_unverified`).
   - **U2** `office_name` is a department / independent agency (directory `agency` vocabulary + the
     three military departments + single-level independents).
   - **U1** `office_name` is a known umbrella command (hand list: ACC, USACE, NAVFAC, NAVSEA, NAVAIR,
     NAVWAR, NAVSUP, Army Materiel Command, Air Combat/Air Mobility Command, AFMC, AFLCMC, TRADOC, AMCOM, SOCOM, CYBERCOM…) or a sub-tier
     (directory `sub_agency` vocabulary, plus any name that arrived with a sub-tier code).
   - **G2** name (literal or abbreviation-canonical) matches **exactly one** directory record, the
     record sits under the row's own branch, AND **no other directory record contains all of the
     name's tokens** (sibling guard). Truncated names ("…District, Los") may complete to a record only
     if the completion is unique; flagged for review.
   - **U1** name matches ≥2 records (sibling guard tripped, or truncation ambiguous).
   - **X** office-shaped name with no directory/SAM record (`no_office_record`).
5. "Largest office" / most awards / HQ is **never** used to break a tie. A tie is U1.

## 5. Classes in detail

### G1 — grounded already (70 rows, 19 users)
65 agree outright (e.g. `W9126G` ENDIST FT WORTH ↔ "Engineer District Fort Worth"). 5 have a correct
code but a **coarser stored label** — e.g. `N00189` (NAVSUP FLT LOG CTR NORFOLK) stored as "Naval Supply
Systems Command", `N00024` (NAVSEA HQ) stored as "Naval Sea Systems Command". The code is the identity;
the label should be the directory display name (the `research_drawer` path already does this).

### G2 — groundable from the row's own evidence (9 rows, 5 users)
| rule | rows | detail |
|---|---|---|
| R-NAME-UNIQUE: abbreviation-canonical name matches exactly one directory record, same branch, no superset sibling | 5 | "USA Engineer District, Seattle" ×2 → `W912DW`; Omaha → `W9128F`; Norfolk → `W91236`; Honolulu → `W9128A` |
| R-TRUNC-UNIQUE: FPDS-truncated name completes to exactly one record | 4 | "USA Engineer District, Los" ×3 → `W912PL` (ENDIST LOS ANGELES); "Naval Surface Warfare Center, Da" → `N00178` (NSWC DAHLGREN) — **review** |

The sibling guard already demoted one false G2: "USA Engineer District, Fort Worth" matches both
`W9126G` ENDIST FT WORTH and `W518EA` ENDIST FORT WORTH CW → U1. Most of these rows carry legacy 4-char
codes (`CA45`, `CA63`, `CA65`, `CA83`, `CA09`) that are **not** DoDAACs and must be discarded, not kept.

### U1 — agency/sub-agency level, needs a user choice (780 rows, 77 users)
- **sub_agency_as_office (531):** FAS, CBP, DCMA, CMS, USCG, FAA, PBS, FEMA, DHA, NIH, IRS, NPS…
  Most carry the 4-digit sub-tier code (FAS `4732`, CBP `7014`). Some sub-tiers are effectively a single
  contracting activity (DHS "Office of Procurement Operations" `7001`, GSA "Office of Administrative
  Services" `4773`) — still **not** auto-promoted: the directory is sample-based, so "one record seen"
  ≠ "one office exists". Proof: "U.S. Army Corps of Engineers" matches exactly one record by token
  containment although USACE has ~45 district DoDAACs in the same directory under `ENDIST`.
- **umbrella_command (246):** Army Contracting Command 26, USACE 25+3+3, NAVFAC 23+5+3, NAVSEA 21+2,
  Air Combat Command 18, Army Materiel Command 17, NAVAIR 16+2, Air Mobility Command 13, TRADOC 12, NAVWAR 12+3, AFMC 11, AFLCMC 10,
  NAVSUP 8… Each contains many contracting offices; picking the HQ DoDAAC would be manufacturing identity.
- **named_office_multiple_codes (3):** Fort Worth district (2 codes), "USA Engineer District," (30).
- Directory candidate counts per U1 row: 0 candidates 92 rows · 1 candidate 127 · ≥2 candidates 561.
  A 0 means the directory cannot even offer a picker (e.g. Air Combat Command, TRADOC, NOAA, Forest Service
  under that spelling) — vocabulary work, not data.

### U2 — department level (204 rows, 69 users)
VA 51+1 ("Department of Veterans"), State 25, NASA 23+4, DOE 19, Army 10, Navy 9, Air Force 8, DoD 8,
USAID 8, EPA 5, SBA 4, Education 3, Smithsonian 3… `auto_setup` 97 and `target_list_search` 66 produce
most of them. Not groundable; can only be relabelled as an **agency-level target** or replaced by a
user-chosen office.

### X — inconsistent / unknown (57 rows, 17 users)
- **Code contradicts name (7):** `HQ0034` (Washington Headquarters Services) stored as "Defense Logistics
  Agency"; `N69450` (NAVFAC SOUTHEAST) stored as "Naval Air Warfare Center - Aircraft Division";
  `N62473` (NAVFAC SOUTHWEST) stored as "…Mid-Atlantic"; `M67854` whose directory name is literally
  "COMMANDER" (directory data defect) stored as "Marine Corps Logistics Command". Neither side can be
  trusted without the user.
- **Unverified DoDAAC shape (12 rows, 7 codes):** `W917BG`, `FA8627`, `W912CZ`, `SPM4L1`, `N61339`,
  `SPM5L4`, `H94002` — not in the directory, 0 SAM solicitations. Plausibly real; a directory refresh
  (not a guess) is what would promote them.
- **Office-shaped name, no record (38):** "Army Contracting Activity - Fort Bliss" (`BK05`), "U.S.
  Property and Fiscal Office for Oklahoma" (`HA34`), "Wiesbaden Contracting Center" (`BN01`),
  "Unknown Office" (`CW05`/`CW01`), "37th Contracting Squadron" (`JA03`)… These are real-looking legacy
  FPDS office names with non-DoDAAC codes. Leave as-is and label unverified; do not fuzzy-match to a
  current MICC/CONS office.

## 6. Anonymized examples (≤10 per class, user dropped; row id prefix only)

#### G1

| row | added_from | stored office_name | stored sub_agency | office_code | sub-class | evidence |
|---|---|---|---|---|---|---|
| `00cddac8` | triage_modal | Engineer District Fort Worth | Department of the Army | W9126G | dodaac_resolves_name_agrees | W9126G → ENDIST FT WORTH (equal) |
| `5ed6a991` | triage_modal | Naval Sea Systems Command | Department of the Navy | N00024 | dodaac_resolves_stored_name_subset | N00024 → NAVSEA HQ; stored "Naval Sea Systems Command" is a subset (shorter or parent form) of the record name — the code is the identity, the label needs repair |
| `028c7921` | triage_modal | Naval Information Warfare Systems | Department of the Navy | N00039 | dodaac_resolves_name_agrees | N00039 → NAVAL INFORMATION WARFARE SYSTEMS (equal) |
| `7ae77e73` | auto_setup | 341th Contracting Squadron | Department of the Air Force | FA4626 | dodaac_resolves_stored_name_subset | FA4626 → 341 CONS LGC; stored "341th Contracting Squadron" is a subset (shorter or parent form) of the record name — the code is the identity, the label needs repair |
| `0442490c` | triage_modal | Naval Facilities Engineering Commandsyscom Mid-Atlantic | Department of the Navy | N40085 | dodaac_resolves_name_agrees | N40085 → NAVFACSYSCOM MID-ATLANTIC (equal) |
| `ad5056f3` | profile_agency | Naval Supply Systems Command | Department of the Navy | N00189 | dodaac_resolves_stored_name_subset | N00189 → NAVSUP FLT LOG CTR NORFOLK; stored "Naval Supply Systems Command" is a subset (shorter or parent form) of the record name — the code is the identity, the label needs repair |
| `06d5f371` | profile_agency | 0414 Aq Headquarters Contract Aug | Department of the Army | W912PF | dodaac_resolves_name_agrees | W912PF → AQ HQ CONTRACT AUG (equal) |
| `d80e78f1` | profile_agency | U.S. Property and Fiscal Office - California Army National Guard | Department of the Army | W912LA | dodaac_resolves_stored_name_subset | W912LA → USPFO ACTIVITY CA ARNG; stored "U.S. Property and Fiscal Office - California Army National Guard" is a subset (shorter or parent form) of the record name — the code is the identity, the label needs repair |
| `0a87a6b7` | profile_agency | DOD Education Activity | Department of Defense | HE1254 | dodaac_resolves_name_agrees | HE1254 → DOD EDUCATION ACTIVITY (equal) |
| `0cadeb36` | profile_agency | Naval Supply Systems Command FLT Log Center Pearl Harbor | Department of the Navy | N00604 | dodaac_resolves_name_agrees | N00604 → NAVSUP FLT LOG CTR PEARL HARBOR (equal) |

#### G2

| row | added_from | stored office_name | stored sub_agency | office_code | sub-class | evidence |
|---|---|---|---|---|---|---|
| `372cbe8b` | auto_setup | USA Engineer District, Los | Department of the Army | — | unique_truncated_prefix_match | truncated "USA Engineer District, Los" completes uniquely to W912PL (ENDIST LOS ANGELES) — REVIEW before write |
| `9027a617` | auto_setup | USA Engineer District, Seattle | Department of the Army | — | unique_directory_name_match | "USA Engineer District, Seattle" = directory office W912DW (ENDIST SEATTLE, Department of the Army); exactly 1 record carries this name (abbreviation-canonical) |
| `cbcb36ee` | triage_modal | Naval Surface Warfare Center, Da | Department of the Navy | — | unique_truncated_prefix_match | truncated "Naval Surface Warfare Center, Da" completes uniquely to N00178 (NSWC DAHLGREN) — REVIEW before write |
| `b55dbe00` | triage_modal | USA Engineer District, Omaha | Department of the Army | CA45 | unique_directory_name_match | "USA Engineer District, Omaha" = directory office W9128F (ENDIST OMAHA, Department of the Army); exactly 1 record carries this name (abbreviation-canonical) |
| `bb93b103` | triage_modal | USA Engineer District, Norfolk | Department of the Army | CA65 | unique_directory_name_match | "USA Engineer District, Norfolk" = directory office W91236 (ENDIST NORFOLK, Department of the Army); exactly 1 record carries this name (abbreviation-canonical) |
| `f269c4bc` | triage_modal | USA Engineer District, Honolulu | Department of the Army | CA83 | unique_directory_name_match | "USA Engineer District, Honolulu" = directory office W9128A (ENDIST HONOLULU, Department of the Army); exactly 1 record carries this name (abbreviation-canonical) |

#### U1

| row | added_from | stored office_name | stored sub_agency | office_code | sub-class | evidence |
|---|---|---|---|---|---|---|
| `001898db` | auto_setup | Naval Facilities Engineering Systems Command | Department of the Navy | — | umbrella_command | major command / abbreviation — contains many contracting offices |
| `001e7afa` | auto_setup | Public Buildings Service | Public Buildings Service | 4740 | sub_agency_as_office | office_name equals a sub-tier name (carries sub-tier code 4740) |
| `44df3d9d` | triage_modal | USA Engineer District,fort Worth | Department of the Army | CA63 | named_office_multiple_codes | "USA Engineer District,fort Worth" is contained in 2 directory records (W518EA ENDIST FORT WORTH CW; W9126G ENDIST FT WORTH) — sibling guard |
| `02c6d3ed` | profile_agency | Army Contracting Command | Department of the Army | — | umbrella_command | major command / abbreviation — contains many contracting offices |
| `002c0922` | triage_modal | Federal Emergency Management Agency | Federal Emergency Management Agency | 7022 | sub_agency_as_office | office_name equals a sub-tier name (carries sub-tier code 7022) |
| `55212717` | profile_agency | USA Engineer District, | Department of the Army | CA21 | named_office_multiple_codes | truncated "USA Engineer District," completes to 30 records (W911KB,W911WN,W911XK,W91236,W91237) |
| `02eccd0d` | profile_agency | Air Force Materiel Command | Department of the Air Force | — | umbrella_command | major command / abbreviation — contains many contracting offices |
| `004f5647` | triage_modal | Office of Procurement Operations | Office of Procurement Operations | 7001 | sub_agency_as_office | office_name equals a sub-tier name (carries sub-tier code 7001) |
| `040cf002` | profile_agency | U.S. Army Training and Doctrine Command | Department of the Army | — | umbrella_command | major command / abbreviation — contains many contracting offices |
| `011e19c8` | profile_agency | Office of the Inspector General | Office of the Inspector General | 7004 | sub_agency_as_office | office_name equals a sub-tier name (carries sub-tier code 7004) |

#### U2

| row | added_from | stored office_name | stored sub_agency | office_code | sub-class | evidence |
|---|---|---|---|---|---|---|
| `010604fa` | target_list_search | Department of the Navy | — | — | department_as_office | office_name is a department/independent-agency name |
| `012bab68` | profile_agency | Department of Energy | Department of Energy | 8900 | department_as_office | office_name is a department/independent-agency name |
| `020bd167` | auto_setup | Department of Veterans Affairs | Department of Veterans Affairs | — | department_as_office | office_name is a department/independent-agency name |
| `037ab3fa` | target_list_search | Department of the Air Force | — | — | department_as_office | office_name is a department/independent-agency name |
| `08e3eb44` | auto_setup | Department of State | Department of State | 1900 | department_as_office | office_name is a department/independent-agency name |
| `105fc746` | auto_setup | Agency for International Development | Agency for International Development | 7200 | department_as_office | office_name is a department/independent-agency name |
| `12882366` | target_list_search | Department of Homeland Security | — | — | department_as_office | office_name is a department/independent-agency name |
| `14c4fc52` | auto_setup | National Aeronautics and Space Administration | National Aeronautics and Space Administration | — | department_as_office | office_name is a department/independent-agency name |
| `16e8a59d` | auto_setup | Department of Housing and Urban Development | Department of Housing and Urban Development | 8600 | department_as_office | office_name is a department/independent-agency name |
| `204983af` | target_list_search | Department of Defense | — | — | department_as_office | office_name is a department/independent-agency name |

#### X

| row | added_from | stored office_name | stored sub_agency | office_code | sub-class | evidence |
|---|---|---|---|---|---|---|
| `03201705` | auto_setup | Xr W6ex Grd Central District | Department of the Army | W917BG | dodaac_shape_unverified | W917BG: not in dodaac_directory, 0 SAM solicitations with prefix |
| `09eebcdd` | profile_agency | Regional Contracting Office Wuerzburg | Department of Defense | BN06 | no_office_record | no directory/SAM record for "Regional Contracting Office Wuerzburg" (code BN06 is not a DoDAAC) |
| `19b5a51c` | triage_modal | Naval Facilities Engineering Systems Command - Mid-Atlantic | Department of the Navy | N62473 | dodaac_resolves_name_partial | N62473 → NAVFACSYSCOM SOUTHWEST vs stored "Naval Facilities Engineering Systems Command - Mid-Atlantic" — shares the parent phrase but the distinguishing words differ |
| `1b4c0cc6` | auto_setup | Marine Corps Logistics Command | Department of the Navy | M67854 | dodaac_resolves_name_conflicts | M67854 → COMMANDER (Department of the Navy) vs stored "Marine Corps Logistics Command" |
| `03298a22` | auto_setup | Fa8627  650 Aess Pk | Department of the Air Force | FA8627 | dodaac_shape_unverified | FA8627: not in dodaac_directory, 0 SAM solicitations with prefix |
| `0c9f7754` | auto_setup | USA Materiel Command Acquisition | Department of Defense | — | no_office_record | no directory/SAM record for "USA Materiel Command Acquisition" |
| `88926745` | auto_setup | Defense Logistics Agency | Department of Defense | HQ0034 | dodaac_resolves_name_conflicts | HQ0034 → WASHINGTON HEADQUARTERS SERVICES (Washington Headquarters Services) vs stored "Defense Logistics Agency" |
| `3d1a0b3e` | triage_modal | 0413 Aq Headquarters Headquarters Parc | Department of the Army | W912CZ | dodaac_shape_unverified | W912CZ: not in dodaac_directory, 0 SAM solicitations with prefix |
| `1ae19043` | triage_modal | MDW Acquisition Center | Department of Defense | DW35 | no_office_record | no directory/SAM record for "MDW Acquisition Center" (code DW35 is not a DoDAAC) |
| `d5c6e35f` | triage_modal | Naval Air Warfare Center - Aircraft Division | Department of the Navy | N69450 | dodaac_resolves_name_conflicts | N69450 → NAVFACSYSCOM SOUTHEAST (Department of the Navy) vs stored "Naval Air Warfare Center - Aircraft Division" |

## 7. Proposed canonical resolver contract (text only — not implemented)

```ts
// src/lib/gov-contacts/resolve-office.ts  (PROPOSED)
type OfficeEvidence = {
  officeCode?: string | null;      // anything the caller has; the resolver decides what it is
  officeName?: string | null;      // label from USASpending/SAM/FPDS
  subAgencyName?: string | null;   // branch, used ONLY as an ambiguity guard
  agencyName?: string | null;      // never used to derive an office
  solicitationNumber?: string | null; // prefix may carry a DoDAAC
  hasSpecificOffice?: boolean;     // find-agencies already computes this; writers must pass it
};
type OfficeResolution =
  | { level: 'office'; dodaac: string; name: string; subAgency: string | null;
      provenance: 'dodaac_directory' | 'solicitation_prefix' | 'name_unique' ;
      confidence: 'exact' | 'derived'; evidence: string }
  | { level: 'sub_agency' | 'department' | 'umbrella'; name: string;
      candidates: number | null;  // offices a user could choose from; null = unknown
      provenance: string; evidence: string }
  | { level: 'unknown'; reason: 'code_unverified' | 'code_name_conflict' | 'no_record';
      evidence: string };
```

Rules the contract enforces:
1. **Code first.** A value passing `isValidDodaac` that resolves in `dodaac_directory_display` → `office`,
   `exact`, and the directory display name **replaces** the caller's label.
2. A valid-shape code that does not resolve → `unknown/code_unverified`. Never keep a guessed name next
   to an unverified code as if it were identity.
3. A resolving code whose record name contradicts the caller's label → `unknown/code_name_conflict`.
4. 4-digit / non-DoDAAC codes are **never** an office. A 4-digit code classifies the row as
   `sub_agency` (it is the sub-tier code) — it is not persisted in `office_code`.
5. Name-only: exactly one directory record, same branch, **no superset sibling** → `office`, `derived`,
   `name_unique`. Truncated completion only with the same uniqueness, and the evidence string says so.
6. `hasSpecificOffice === false` (USASpending had no office) → never `office`. The name is a sub-agency.
7. Department / sub-tier / umbrella vocabularies → the matching non-office level, with a candidate count
   for the picker.
8. Ties are never broken by $ / award count / "HQ". A tie is a picker, not an answer.
9. One resolver, used by every writer AND by any repair script (mirror rule: app + MCP + scripts).

## 8. Repair plan per class (each step needs Eric's sign-off before any write)

| class | rows | proposed action | write? |
|---|---|---|---|
| G1 agree | 65 | nothing | no |
| G1 label subset | 5 | set `office_name` to directory display name (same as `research_drawer` does on save) | yes, 5 rows, reversible (log old value) |
| G2 R-NAME-UNIQUE | 5 | set `office_code` to the resolved DoDAAC, `office_name` to display name, drop the legacy 4-char code; log provenance | yes, 5 rows |
| G2 R-TRUNC-UNIQUE | 4 | same, **only after a human confirms each** (3 LA District, 1 Dahlgren) | yes, 4 rows, per-row sign-off |
| U1 | 780 | no data write. Relabel in UI as "Agency-level target — pick an office"; offer a picker from the directory where candidates ≥1. Move 4-digit codes out of `office_code` (into `sub_agency_code`) only with a schema/data decision. | no (UI + later user action) |
| U2 | 204 | no data write. Same relabel ("Department-level target"). Decide whether department-level saves are allowed at all going forward (see open decisions). | no |
| X conflict/partial | 7 | flag, show both, ask user; do not auto-pick either side. Fix the `M67854 → "COMMANDER"` directory row separately. | no |
| X unverified code | 12 | re-check after the next `dodaac_directory` refresh; promote to G1 only if it resolves | no |
| X no record | 38 | label "unverified office"; keep | no |

**Writer fixes (separate PR, after sign-off), in order of rows prevented:**
1. `profile_agency` (`seed-target-list.ts`): adopt the `auto_setup` DoDAAC guard and the
   `capability_text_seed` rule — no office → don't write an office row (or write an explicit
   agency-level target once that concept exists).
2. `auto_setup`: stop falling back to `a.name` for `office_name`; stop writing the office label into
   `agency_name`.
3. `triage_modal` server: stop `agency_name || office_name`; route through the resolver.
4. `find-agencies`: pass `hasSpecificOffice` through; rename/stop emitting a sub-tier code as `officeId`.
5. `target_list_search`: keep, but save as an explicit agency-level target, not as an office.

Net effect of the automatic part: **at most 14 rows** (5 + 5 + 4) change, all for ≤ 9 users. The
material improvement for the 58 users with zero grounded offices comes from the UI relabel + picker and
the writer fixes, not from a backfill.

## 9. Open decisions (need Eric)

1. Is a **department-level or sub-agency-level target** a legitimate thing to save (as its own level),
   or should those saves be refused / redirected to an office picker? (Drives U1/U2 treatment and the
   `target_list_search` flow.)
2. Should the 9 G2 rows be written at all, or left for the user picker to confirm? (Recommendation:
   write the 5 R-NAME-UNIQUE, confirm the 4 truncated.)
3. Where do 4-digit sub-tier codes live? Moving 371 values from `office_code` to `sub_agency_code` is a
   data migration and changes the `(user_email, office_name)` dedupe story not at all, but it does
   change what `office_code` means for every reader (`target-enrichment`, opp-count backfill).
4. The umbrella list is hand-curated (≈30 names). Accept a curated list, or derive umbrella-ness from a
   hierarchy source (SAM Federal Hierarchy level-3 orgs)?
5. `agency_name` holding the office label on ~900 rows: repair (derive agency from sub-agency /
   directory) in the same pass, or separately?

## Limits of this pass

- The directory is sample-based (offices seen in FPDS awards). "Not in directory" ≠ "not an office".
- The umbrella and department vocabularies are partly hand-listed; every row they classify is listed by
  name in §5 so misclassification is auditable.
- No USASpending/BigQuery scan was run; awarding-office lookups per row were not attempted.
- Name canonicalisation is conservative: a false G2 is prevented by the sibling guard, at the cost of
  leaving some real offices in X.

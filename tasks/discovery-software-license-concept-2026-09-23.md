# Discovery — "software license" concept + typo wrapper contract (Decision #4, 2026-09-23)

Gate before the Saved Search migration. Saved Searches are **not** changed here.

## Contract

`software license` is one recognized concept (`src/lib/discovery/matcher.ts` `CONCEPTS`).

| part | value | role |
|---|---|---|
| `names` | `software license` (query inflections: licenses / licensing / licensed) | the only way a QUERY recognizes the concept |
| `forms` | software license · software subscription · software maintenance renewal · software renewal · license subscription · license renewal · license maintenance | extra phrases a RECORD may match on (adjacent, space or hyphen, last word inflected) |
| `cooccur` | `software` AND `license`, anywhere | the concept's plain-word meaning before this change, kept on purpose |

- The concept **only adds**: after ⊇ before on every surface.
- `license`, `subscription`, `maintenance` and `renewal` are **never** enough on their own.
- Typing a record-only form ("license renewal", "software subscriptions") keeps its plain-word meaning.
- An exclusion (`-software license`) removes the named forms only, never the co-occurrence.

### A rejected alternative (measured)

The first build was phrase-only. It **dropped** real buys the plain words find, and was rejected:

| surface | before | phrase-only |
|---|---|---|
| Open | 221 | 52 |
| Recompete | 7,642 | 1,337 |

Dropped examples include "Microsoft Software Enterprise Licenses", "Renewal of Adobe Subscription Licenses", the Oracle ULA, and every recompete whose PSC reads "(PERPETUAL LICENSE SOFTWARE)".

## Form evidence (active open / live recompete / forecast)

| form | counts | audit |
|---|---|---|
| software licen{se,ses,sing,sed} | 46 / 786 / 232 | |
| software subscription(s) | 6 / 170 / 50 | 0 rows without a software cue |
| software renewal(s) | 0 / 126 / 77 | 0 rows without a software cue |
| software maintenance renewal(s) | 1 / 32 / 14 | 0 rows without a software cue |
| license subscription(s) | 0 / 70 / 13 | 0 rows without a software cue |
| license renewal(s) | 2 / 217 / 93 | rows without a cue are still named products (SolarWinds, UiPath, Citrix, Palo Alto, COMSOL); no professional, reactor or driver license |
| license maintenance | 1 / 39 / 15 | ANSYS, Stata, GeoStudio, EDR |

## Blast radius — query "software license" (before = origin/main `d131e272`, after = this branch)

| surface / horizon | before | after | added | removed |
|---|---|---|---|---|
| MCP Open | 221 | 227 | +6 | 0 |
| Maps Open | 221 | 227 | +6 | 0 |
| MCP Recompete | 7,642 | 7,781 | +139 | 0 |
| Maps Recompete | 7,642 | 7,781 | +139 | 0 |
| MCP Forecast | 411 | 567 | +156 | 0 |
| Maps Forecast | 411 | 567 | +156 | 0 |

Notes:
- "software licenses" gives exactly the same result.
- "software licensing" goes 51→227, 206→7,781 and 53→567. Before this change, "licensing" matched only the literal word; it is now the concept name (a requested form).
- "license renewal" and "software subscriptions" are unchanged: +0 / −0 on all six surfaces.
- MCP ≡ Maps identity-for-identity on every horizon.

### Added rows by form

| horizon | added by form |
|---|---|
| Open +6 | software subscription 4, software maintenance renewal 1, license maintenance 1 |
| Recompete +139 | software subscription 61, software renewal 33, license renewal 25, license subscription 8, software maintenance renewal 8, license maintenance 4 |
| Forecast +156 | software renewal 58, license renewal 41, software subscription 33, software maintenance renewal 10, license subscription 8, license maintenance 6 |

The Open +6 are:
- ANSYS Fluent License Maintenance
- FDIC SolarWinds Software Subscription Renewal
- Teledyne ACMS Software Subscription
- Fortify On Demand Software Subscriptions
- Terrainworks NetMap Software Subscription
- Applanix POSPac MMS Software Maintenance Renewal

### False-positive sample (all 301 added rows screened)

Almost all added rows are named software products.

**Weakest admits:**
- **Data or content licenses, not software:**
  - CRSP data license subscriptions
  - D&B Hoovers / Data Block license subscriptions
  - OCLC cataloging subscription
- **Equipment bundles that include a software subscription:**
  - outdoor lockers + software subscriptions
  - VR police training equipment
  - refrigeration repairs + software subscription
  - Geotab telematics devices
  - Aruba WLAN maintenance
- **Seat licenses for learning platforms:** Udacity, BetterUp, "Advance Online Training and License Renewal".

That is roughly 8–11 of 301 (~3%).

## Saved-search fixture a9eb09ff (`q=software license`, `naics=513210`, SAVED_SEARCH_POLICY)

| horizon | before | after |
|---|---|---|
| open | 9 | 12 |
| recompete | 716 | 733 |
| forecast | 106 | 128 |

**Open adds exactly the audited three:**
- ANSYS Fluent License Maintenance
- Fortify On Demand Software Subscriptions
- Applanix POSPac MMS Software Maintenance Renewal

**Still not admitted:**
- Simview Simulation Renewal. Its fields say "Simulation Software" but never name a license or a software renewal, so the "only if grounded" condition is not met.
- Predictor Remediation Exam.
- Both AI Legal Research RFI rows.
- Partial software-support rows.

Saved Search code is **not** migrated. This measures the canonical library under the saved-search policy only.

## Typo wrapper contract

`<word> me <opportunity noun> …` is a request wrapper **only** when the remainder resolves to structured intent. There is no general fuzzy spelling.

| query | result |
|---|---|
| "shoe me opportunities in the Virgin Islands" | state VI, no concepts |
| "shoe me opportunities" | concept `shoe` (no structured remainder, so the word is a search term again) |
| "shoe opportunities" | lexical `shoe` |
| "shoes in Virginia" | VA + lexical `shoes` |
| "email me opportunities in cyber" | cybersecurity + email |

## Gates

- Discovery suite: 76 passed, 2 todo.
- Cross-surface plan parity: green.
- Golden plans: two fixtures ADDED ("software license", "software licenses"); **0 existing plans changed** (0 deleted lines in the golden diff).
- `tsc --noEmit` passes clean.

# SUBAGENCY FORECAST IDENTITY + OFFICE ANCHORING AUDIT — READ ONLY

**Run:** 2026-09-14 · No implementation, no aliases added, no sources added, no Air Force discovery started.
Baseline: department identity closed (PR #1508 / `48e60ea8`) — 35,751/35,751 reachable by department.

> **Environment note (blocking, unrelated to this audit):** `.env.local` was overwritten by a `vercel env pull`
> at 11:01 today and dropped from **81 vars to 30**, losing `NEXT_PUBLIC_SUPABASE_URL`,
> `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` and the SAM keys. `npm run verify:env` fails; `npm run db`,
> `npm run verify:forecast-agency` and every drain runner are broken locally until it is restored
> (`vercel env pull .env.local --environment=production` returns 132 vars). I pulled a private copy to
> scratchpad for this audit and **did not modify your file**.

---

## 13. DOES THE ≥8,200 ESTIMATE SURVIVE? — **NO.**

**The 15 priority children anchor to exactly 7,586 unique rows** (−7.5% vs the ≥8,200 keyword estimate).

But the estimate was wrong in *both* directions, and the larger story is better:

| Scope | Rows |
|---|---:|
| 15 priority children, structured anchors | **7,586** |
| **All safely child-anchorable rows across the 6 parents** | **19,289** |

The keyword discovery pass measured the wrong thing — it counted title/office *mentions*, which over-counted
descriptive words ("park", "forest", "fish") and under-counted Navy commands whose identity lives only in a
DoDAAC. **Structured evidence wins, per instruction.**

---

## 1. Available child-identity fields

| Field | Classification | Populated | Notes |
|---|---|---|---|
| `bureau` | **SOURCE_NATIVE** | **100%** on DHS/DOI/USDA/GSA/HHS/NAVY | The find. Carries the source's own component name/code |
| `contracting_office` | **SOURCE_NATIVE** | 99.9% (NAVY 8,820/8,821) | DoDAAC for Navy; free-text name for civilian sources |
| `raw_data->>'office_label'` | SOURCE_NATIVE | NAVY only, **34 of 102 offices** | 68 offices NULL — cannot anchor alone |
| `dodaac_directory.office_name` | NORMALIZED_FROM_SOURCE (FPDS) | 4,826 codes | External reference; carries the Navy command |
| `program_office` | FREE_TEXT | 96–100% | Not used as an anchor |
| `department` | NORMALIZED | 0% on DHS/HHS/NAVY | Useless at child level |
| `title` / `description` | FREE_TEXT | — | **Explicitly rejected as a selector** |
| `raw_data` | mixed | 0% on DHS/DOI-api/USDA-api/GSA-api | Not a universal anchor |

**Per-source-family anchor differs, and that is stated rather than hidden:**

- **DHS (`api`)** — `bureau` is an APFS component path: `USCG/CG-SHORE`, `CBP/OIT`, `ICE/HSI`, `DHS HQ/CISA`. Child = the segment **before the first `/`**. Source-native, exhaustive.
- **HHS (`sbcx_api`)** — `bureau` = `HHS <COMPONENT>` (`HHS IHS`, `HHS CMS`, `HHS NIH`). Exact value set.
- **DOI / USDA / GSA** — `bureau` = the source's bureau name, exact value set (`Fish and Wildlife Service`, `Forest Service`, `FAS-Federal Acquisition Service`). A *parent-generic* value also occurs and is **not a child**.
- **NAVY (`lrae_xlsx`)** — `bureau` is flat (`Department of the Navy` ×8,754). Command identity requires **`contracting_office` (DoDAAC) → `dodaac_directory.office_name`**.

## 2–4. Final child anchor table, with proof

| Child | Parent | Anchor field | Accepted values | Structured rows | Distinct codes | Confidence |
|---|---|---|---|---:|---:|---|
| **USCG** | DHS | `bureau` prefix | `USCG/*` (CG-SHORE, CG-SURFACE, CG-HCA, CG-AIR, SFLC, LOGCOM, CG-C5I…) | **702** | 7+ | **DETERMINISTIC** |
| **CBP** | DHS | `bureau` prefix | `CBP`, `CBP/OIT`, `CBP/OFO`, `CBP/Facilities Managemen` | **256** | 4 | **DETERMINISTIC** |
| **FEMA** | DHS | `bureau` prefix | `FEMA*` | **117** | 1+ | **DETERMINISTIC** |
| **TSA** | DHS | `bureau` prefix | `TSA*` | **83** | 1+ | **DETERMINISTIC** |
| **USSS** | DHS | `bureau` prefix | `USSS*` | **59** | 1 | **DETERMINISTIC** |
| **CMS** | HHS | `bureau` exact | `HHS CMS` | **80** | 1 | **DETERMINISTIC** |
| **NIH** | HHS | `bureau` exact | `HHS NIH` | **34** | 1 | **DETERMINISTIC** |
| **FWS** | DOI | `bureau` exact | `Fish and Wildlife Service` | **710** | 1 | **DETERMINISTIC** |
| **NPS** | DOI | `bureau` exact | `%National Park%` | **14** | 1 | **DETERMINISTIC** (tiny) |
| **Forest Service** | USDA | `bureau` exact | `Forest Service` | **639** | 1 | **DETERMINISTIC** |
| **FAS** | GSA | `bureau` exact | `FAS-Federal Acquisition Service` | **182** | 1 | **DETERMINISTIC** |
| **PBS** | GSA | `bureau` exact | `PBS-Public Building Service` | **28** | 1 | **DETERMINISTIC** |
| **NAVFAC** | NAVY | DoDAAC → `office_name` | `NAVFACSYSCOM *` (MID-ATLANTIC, FAR EAST, WASHINGTON, SOUTHWEST, SOUTHEAST, HAWAII, EUROPE AFRICA CENTRAL, MARIANAS, ATLANTIC, PACIFIC) | **2,278** | 10 | **HIGH_CONFIDENCE** |
| **NAVAIR** | NAVY | DoDAAC → `office_name` | NAVAL AIR SYSTEMS COMMAND · NAVAIR WARFARE CTR AIRCRAFT DIV · NAVAL AIR WARFARE CENTER (AIR DIV) · NAWC TRAINING SYSTEMS DIV · FLEET READINESS CENTER | **1,631** | 6 | **HIGH_CONFIDENCE** |
| **NAVSEA** | NAVY | DoDAAC → `office_name` | NAVSEA HQ · NSWC * · NUWC * · NAVAL SURFACE WARFARE CENTER · *NAVAL SHIPYARD* · *REGIONAL MAINT CENTER* | **773** | 14+ | **HIGH_CONFIDENCE** |

**Why Navy is HIGH_CONFIDENCE, not DETERMINISTIC:** the command name is not in the forecast row. It comes from
joining a stable source-native code (DoDAAC) to `dodaac_directory`, which is FPDS-award-derived and has
**known coverage gaps** — a false-*negative* source, never a false-positive one.

**Representative rows:** `N40085`→NAVFACSYSCOM MID-ATLANTIC (851) · `N00019`→NAVAL AIR SYSTEMS COMMAND (889) ·
`N00024`→NAVSEA HQ (172) · DHS `USCG/CG-SHORE` (277) · HHS `HHS CMS` (80).

**False positives:** none detected. Every anchor is an exact value or a source-native structural prefix.
**False negatives (measured, Navy only):** `N44225` = NAVFAC Northwest (**119 rows**) and `NAVFAC Mid-Atlantic`
as free text (1) are absent from `dodaac_directory`; `N60530` = NAWCWD (1) missed for NAVAIR; `NAVSUP WSS`
(949) is a text label, not a code. **Adding these to the accepted code set lifts NAVFAC 2,278 → ~2,398 —
which independently converges on the 2,402 keyword figure.**

## 5. Previous (keyword) vs structured count

| Child | Keyword | **Structured** | Δ | Reason |
|---|---:|---:|---:|---|
| NAVFAC | 2,402 | **2,278** | −124 | keyword also hit NAVFAC mentions in other commands' text; structured misses `N44225` (+119 recoverable) |
| NAVAIR | 931 | **1,631** | **+700** | keyword matched only 2 DoDAACs; 6 offices actually belong to NAVAIR |
| NAVSEA | 194 | **773** | **+579** | keyword missed NSWC/NUWC/shipyards entirely |
| FWS | 1,470 | **710** | **−760** | "fish"/"wildlife" appear in titles of BLM/Reclamation rows |
| Forest Service | 1,283 | **639** | **−644** | "forest" is a common descriptive word in USDA titles |
| **NPS** | 221 | **14** | **−207** | **"park" is a location word, not an identity.** Worst over-count |
| FAS | 324 | **182** | −142 | "acquisition service" matched generic GSA text |
| PBS | 40 | **28** | −12 | same |
| USCG | 702 | **702** | **0** | exact agreement |
| USSS | 59 | **59** | **0** | exact agreement |
| CBP | 257 | 256 | −1 | |
| FEMA | 118 | 117 | −1 | |
| TSA | 84 | 83 | −1 | |
| CMS | 81 | 80 | −1 | |
| NIH | 35 | 34 | −1 | |
| **Total** | **8,201** | **7,586** | **−615** | |

## 6. Sibling exclusivity — clean

```
total assignments      7,586
unique rows            7,586
multi-child rows           0
rows in ≥2 children        0
```
**Zero overlap.** Anchors are mutually exclusive by construction (a `bureau` value belongs to one component;
a DoDAAC belongs to one command). No row silently belongs to two children.

## 7. Ambiguous / unsafe / parent-only rows

| Parent | Parent-only (genuinely unattributable) | Why |
|---|---:|---|
| DOI | **3,871** | `bureau = 'Department of the Interior'` — source published no bureau |
| USDA | **2,519** | `bureau = 'Department of Agriculture'` (the entire `gsa_gateway_csv` pair) |
| NAVY | **1,115** unjoined + **697** generic (`COMMANDER`, `COMMANDING GENERAL/OFFICER`) | no DoDAAC match, or an office name that names no command |
| GSA | **178** | `bureau = 'General Services Administration'` |
| DHS / HHS | **0** | 100% component-attributed |

**These must stay parent-only.** Assigning them by text would be exactly the substring bug that started this.

## 8. Revealed-demand overlay (all 15 clear the ≥5 bar)

| Child | Strong | Pursuit | Target | Profile | bulk caveat | Structured rows |
|---|---:|---:|---:|---:|---|---:|
| FAS | 33 | 0 | 33 | 33 | target-only | 182 |
| CBP | 27 | 1 | 26 | 76 | profile 100% bulk | 256 |
| NAVFAC | 25 | 0 | 25 | 5 | target-only | **2,278** |
| USCG | 23 | 4 | 20 | 176 | profile 97% bulk | 702 |
| CMS | 23 | 1 | 22 | 10 | | 80 |
| NAVSEA | 22 | 0 | 22 | 0 | target-only | 773 |
| NAVAIR | 18 | 0 | 18 | 0 | target-only | **1,631** |
| PBS | 17 | 2 | 16 | 86 | profile 98% bulk | 28 |
| NIH | 16 | 4 | 12 | 218 | profile 99% bulk | 34 |
| FEMA | 15 | 1 | 14 | 138 | profile 96% bulk | 117 |
| NPS | 13 | 4 | 10 | 93 | | **14** ⚠ |
| Forest Service | 13 | **8** | 5 | 58 | strongest pursuit signal | 639 |
| USSS | 11 | 1 | 10 | 314 | profile ~99% bulk | 59 |
| TSA | 10 | 1 | 9 | 43 | | 83 |
| FWS | 8 | 2 | 6 | 32 | | 710 |

**Priority is demand × usable corpus.** NAVFAC (25 users / 2,278 rows) and NAVAIR (18 / 1,631) are the top
value. **NPS is the cautionary case** — 13 real users but only **14** rows; shipping it advertises a market
we barely hold.

## 10. Current gap per child (measured on prod today)

| Child | Returns today | Owned attributable | False positives | False negatives |
|---|---:|---:|---:|---:|
| NAVFAC | **8,881** | 2,278 | **6,603** | 0 |
| NAVAIR | **8,881** | 1,631 | **7,250** | 0 |
| NAVSEA | **8,881** | 773 | **8,108** | 0 |
| USCG | 0 | 702 | 0 | **702** |
| FWS | 0 | 710 | 0 | **710** |
| Forest Service | 0 | 639 | 0 | **639** |
| CBP | 0 | 256 | 0 | 256 |
| FAS | 0 | 182 | 0 | 182 |
| FEMA | 0 | 117 | 0 | 117 |
| TSA | 0 | 83 | 0 | 83 |
| CMS | 0 | 80 | 0 | 80 |
| USSS | 0 | 59 | 0 | 59 |
| NIH | 0 | 34 | 0 | 34 |
| PBS | 0 | 28 | 0 | 28 |
| NPS | 0 | 14 | 0 | 14 |

**21,961 false-positive row-returns across 3 Navy commands; 3,004 false negatives across 12 children.**

## 11. Unique rows unlocked

| Category | Rows |
|---|---:|
| **Unique unlocked — 15 priority children** | **7,586** |
| Overlapping child rows | **0** |
| Ambiguous / parent-only (DOI 3,871 · USDA 2,519 · NAVY 1,812 · GSA 178) | **8,380** |
| Heuristic / unsafe (proposed for production) | **0** |
| Recoverable with an extended Navy code set | ~+120 |
| **All safely child-anchorable rows across the 6 parents** | **19,289** |

## 9. Proposed shared-resolver extension (PROPOSAL ONLY — not implemented)

Extend **`src/lib/forecasts/agency-identity.ts`**. No second resolver, no per-surface logic.

```ts
type ChildAnchor =
  | { kind: 'bureau_exact';  values: string[] }       // DOI / USDA / GSA / HHS
  | { kind: 'bureau_prefix'; values: string[] }       // DHS APFS "COMPONENT/sub"
  | { kind: 'office_code';   codes: string[] };       // NAVY DoDAAC (curated from dodaac_directory)

interface ForecastChildIdentity {
  key: string;                 // 'USCG'
  label: string;               // 'U.S. Coast Guard'
  parent: string;              // 'DHS'  -> existing identity key
  parentSourceAgency: string;  // 'DHS'  -> source_agency to scope by FIRST
  aliases: string[];           // resolve IDENTITY only — never used as a row selector
  anchor: ChildAnchor;         // the row selector
  coverage: 'represented' | 'partial';
  confidence: 'deterministic' | 'high_confidence';
  note?: string;
}
```

**Contract:**
- A child filter = `source_agency = parent` **AND** the anchor predicate. Never the parent alone.
- **Parent still aggregates children** (`DHS` → all 1,644 including USCG); **a child never inherits the parent**.
- `ARMY` → `USACE` unchanged; **USACE must not inherit future Army rows** — it stays a `source_agency` identity, not a child anchor.
- Aliases (`Coast Guard`, `United States Coast Guard`, `Naval Facilities Engineering Systems Command`) resolve to the **child identity**; the identity then applies its structured anchor. Alias text is never a row selector.
- Emission extends `forecastAgencyOrExpr` to return `source_agency.in.(…)` **AND** the anchor clause — one expression, all four surfaces.

## 14. Test plan

| # | Test | Assert |
|---|---|---|
| 1 | Child exactness | `USCG` = 702 · `NAVFAC` = 2,278 · `NIH` = 34 — equal to the structured anchor count |
| 2 | **NAVFAC ≠ all Navy** | `NAVFAC` ≠ 8,881; every returned row's DoDAAC ∈ the NAVFAC code set |
| 3 | **USCG ≠ all DHS** | `USCG` ≠ 1,644; every row's `bureau` starts `USCG/` |
| 4 | **NIH ≠ all HHS** | `NIH` ≠ 5,504; every row `bureau = 'HHS NIH'` |
| 5 | Parent rollup intact | `DHS` ⊇ USCG ∪ CBP ∪ FEMA ∪ TSA ∪ USSS; `NAVY` ⊇ NAVFAC ∪ NAVAIR ∪ NAVSEA |
| 6 | Child ⊄ parent inheritance | for every child: `count(child) < count(parent)` |
| 7 | Sibling exclusivity | Σ child counts = count(distinct rows); 0 multi-child |
| 8 | Short-alias safety | `CBP`,`TSA`,`FAS`,`PBS`,`NPS`,`FWS`,`CMS`,`NIH` emit **no** `ilike.%…%` |
| 9 | No arbitrary substring | anchor expression contains only `.in.(`, `.eq.`, or `bureau.like.'X/%'` — never a bare `%term%` |
| 10 | Department identities unregressed | the existing 53 tests + `verify:forecast-agency` still pass (DOD 11,789, EPA 50, SEC 0, 35,751 reachable) |
| 11 | **Maps / MCP / /api/forecasts / saved-search parity** | same child term → identical resolved row set on all four (totals may differ by coordinate/FY rules only) |
| 12 | Parent-only rows unassigned | DOI's 3,871 generic-bureau rows belong to **no** child |
| 13 | Unknown child term | `Bureau of Reclamation` (not yet an identity) → word-boundary fallback, never the parent corpus |

## 11/12. Ship readiness

**Safe to ship now (12 DETERMINISTIC):** USCG · CBP · FEMA · TSA · USSS · CMS · NIH · FWS · Forest Service · FAS · PBS · NPS*
\* NPS is deterministic but only **14 rows** — ship it with the honest count, or hold it; it is a product call, not a data one.

**Safe to ship with a curated code set (3 HIGH_CONFIDENCE):** NAVFAC · NAVAIR · NAVSEA — these fix the worst
defect (21,961 false-positive returns) and carry the largest corpora. Recommend shipping with the extended
code set (+`N44225`, +`N60530`, + the free-text `NAVFAC Mid-Atlantic`) and a test pinning the code list.

**Needs additional source work (NOT proposable):**
- **NAVSUP** — 1,231 rows, but its largest office is the free-text `NAVSUP WSS` (949) with no DoDAAC. Needs an office-name normalization pass first.
- **DOI 3,871 / USDA 2,519 / GSA 178 parent-generic rows** — the source published no bureau. Only a re-ingest could attribute them.
- **NAVY 697 generic office names** (`COMMANDER`, `COMMANDING GENERAL/OFFICER`) — the DoDAAC is present but `dodaac_directory` has no useful name. Recoverable by extending that reference, not by guessing.
- **Army commands** (ACC 24 users, AMC 17) — **no Army-proper forecast corpus exists at all**; this is a source gap, not an identity gap.

## 14. Does anything change Air Force as the first NEW source?

**No — and the case for sequencing strengthens.**

This work is **not a source**; it is identity on data already owned. It unlocks **7,586 rows** (and up to
19,289 with the full bureau set) for **zero source engineering**, and it removes **21,961 false-positive rows**
currently being returned to users — a correctness bug, not just a coverage gap. That is strictly better
value-per-effort than any discovery.

**Air Force remains the first NEW source investigation**, unchanged: still **0 forecast rows**, still 45 strong
users / 20 pursuits / 794 open opportunities / 21% audience alignment. Nothing in this audit touches it —
no Air Force rows exist to anchor. The two workstreams are independent and this one should land first.

---

**READ ONLY. Nothing implemented. No aliases added. No sources added. No Air Force discovery started.**

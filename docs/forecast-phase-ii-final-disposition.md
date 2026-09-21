# Forecast domain — Phase II FINAL disposition (2026-09-14)

**This table is historical evidence. Operational authority is `data_source_pair_bindings`
joined to `data_source_instances`.** `docs/phase-ii-forecast-source-disposition.md` is
superseded by this document and by the control plane.

## Counts, measured not assumed

| | |
|---|---|
| Distinct agencies | **20** |
| Physical `(agency, source_type)` pairs | **30** |
| **Canonical upstream source instances** | **12** |
| Physical forecast records | **35,741** |
| Records under the control plane | **35,741 (100%)** |
| Agencies backed by a canonical instance | **18** (ONR + NRL are controlled *without* one) |

A canonical source is **not** a source_type. One GSA Gateway source governs **7** current
pairs plus **6** retained duplicate paths; one USACE source governs **3** pairs.

## Old-audit reconciliation — all 30 accounted for exactly once

| Old entry | Old disposition | Final pair disposition | Canonical instance | Why it changed |
|---|---|---|---|---|
| DHS · api | LIVING | `canonical_active` | `forecast_dhs_apfs` | Unchanged; now registered |
| DOE · osdbu_xlsx | LIVING | `canonical_active` | `forecast_doe_osbp` | Unchanged; now registered |
| DOI · gsa_gateway_csv | BLOCKED | `canonical_active` | `forecast_gsa_gateway` | **Not blocked.** "Gateway login" came from probing `ag-dashboard`; the public tool needs no auth |
| USDA · gsa_gateway_csv | BLOCKED | `canonical_active` | `forecast_gsa_gateway` | as above |
| VA · gsa_gateway_csv | BLOCKED | `canonical_active` | `forecast_gsa_gateway` | as above |
| DOT · gsa_gateway_csv | BLOCKED | `canonical_active` | `forecast_gsa_gateway` | as above |
| GSA · gsa_gateway_csv | BLOCKED | `canonical_active` | `forecast_gsa_gateway` | as above |
| DOL · gsa_gateway_csv | BLOCKED | `canonical_active` | `forecast_gsa_gateway` | as above |
| USACE · enterprise_da_format | BLOCKED | `canonical_controlled` | `forecast_usace_manual` | Akamai confirmed; now a *controlled* manual source |
| USACE · district_workbook | BLOCKED | `canonical_controlled` | `forecast_usace_manual` | as above |
| USACE · district_da_pdf | BLOCKED | `canonical_controlled` | `forecast_usace_manual` | as above |
| Treasury · osdbu_salesforce | BLOCKED | `canonical_controlled` | `forecast_treasury_osdbu` | Now controlled + registered |
| NASA · naf_grid | REPAIR_REQUIRED | `canonical_active` (`naf_xlsx`) | `forecast_nasa_naf` | **Repaired.** Transactional canonicalization; source_type renamed |
| EPA · apex_forecast_db | REPAIR_REQUIRED | `canonical_controlled` | `forecast_epa_apex` | **Diagnosed.** Not a redirect problem — the APEX host resets for everyone |
| SSA · excel | REPAIR_REQUIRED | `canonical_controlled` | `forecast_ssa_osdbu` | **Repaired + blocked.** Old URL 404s; SSA blocks Vercel egress |
| DOJ · excel | REPAIR_REQUIRED | `canonical_active` | `forecast_doj_live` | **Repaired.** File relocated; automated with identity rejections |
| NRC · api | UNMEASURED | `canonical_controlled` | `forecast_nrc_gateway` | **Measured.** FCO machine path auth-gated (Login.gov/AAL2) |
| NSF · api | BLOCKED | `canonical_controlled` | `forecast_gsa_gateway` | **Not independently blocked.** 33/37 ids match the 2026-06 Gateway refresh; the other 4 are `GSA-AG-*`. No separate NSF upstream ⇒ no separate instance |
| DOI · api | SUPERSEDED | `duplicate_ingest_path` | `forecast_gsa_gateway` | **Refined by ID evidence:** 3,011 ids identical to the csv pair. Not a predecessor — the same procurements stored twice |
| USDA · api | SUPERSEDED | `duplicate_ingest_path` | `forecast_gsa_gateway` | 2,509/2,519 identical after separator normalization |
| VA · api | SUPERSEDED | `duplicate_ingest_path` | `forecast_gsa_gateway` | 691 identical |
| DOT · api | SUPERSEDED | `duplicate_ingest_path` | `forecast_gsa_gateway` | 211 identical; 449 api-only rows are **not** duplicates |
| GSA · api | SUPERSEDED | `duplicate_ingest_path` | `forecast_gsa_gateway` | 122 identical; 214 api-only |
| DOL · api | SUPERSEDED | `duplicate_ingest_path` | `forecast_gsa_gateway` | 21 identical; 123 api-only |
| DOE · excel | SUPERSEDED | `superseded` | `forecast_doe_osbp` | Confirmed: normalized-ID overlap **0** — a true supersession, not duplication |
| NASA · excel | SUPERSEDED | `superseded` | `forecast_nasa_naf` | Confirmed: title overlap 0. 42 rows retained; **no second instance** |
| ONR · excel | RETIRED | `historical_only` | *(none)* | Softened: "retired" implies a decision to stop. No producer and no current source **within cleanup scope**; finding one is coverage-expansion work |
| NRL · excel | RETIRED | `historical_only` | *(none)* | as above |
| NAVY · lrae_xlsx | *(not in the old table)* | `canonical_controlled` | `forecast_navy_lrae` | **NEW PATH INTRODUCED AFTER THE ORIGINAL AUDIT** |
| HHS · sbcx_api | *(not in the old table)* | `canonical_active` | `forecast_hhs_sbcx` | **NEW PATH INTRODUCED AFTER THE ORIGINAL AUDIT** |

⚠️ The old audit listed `NASA · naf_grid` (146) and `SSA · excel` (60); those pairs are now
`naf_xlsx` (147) and 170 rows after Phase II canonicalization and ingest.

## Duplicate-ingest evidence (deterministic, ID-level — no fuzzy matching)

| Agency | PROVEN duplicate | unique to CSV | unique to API |
|---|---|---|---|
| DOI | 3,011 | 22 | 120 |
| USDA | 2,509 | 10 | 0 |
| VA | 691 | 7 | 1 |
| DOT | 211 | 26 | 449 |
| GSA | 122 | 56 | 214 |
| DOL | 21 | 1 | 123 |
| **Total** | **6,565** | **122** | **907** |

`GW-L:<id>` strips to the `api` id; USDA needed separator normalization only (`_` vs `-`).
**The 1,029 unique-path rows are NOT duplicates.** All six `api` producers are **inactive**
(last write 2026-06-25, 80 days; no enabled cron can write them). Physical deduplication is
**post-closeout cleanup**, not a closure blocker.

## Post-closeout backlog

Dedupe the 6,565 proven duplicates · retire the rotted `api` producer code · ONR/NRL coverage ·
audience-driven coverage expansion beyond the current 20 agencies.

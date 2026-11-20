# DARPA Grants.gov field proof — 2026-11-20

`POST https://api.grants.gov/v1/api/search2` with `oppStatuses=forecasted|posted` and the `DOD-DARPA-*` agency filter.

`errorcode` 0. `hitCount` 4. All four hits have `agencyCode` starting `DOD-DARPA-`. `darpaHitsFromSearch` keeps these fields verbatim and drops anything else. `cfdaList` is present on each hit and is not copied. No NAICS field was in the payload, so the collector does not write one. `docType` is `synopsis` on every hit; the stored opportunity type is `baa` because that is the collector's source class, not a Grants.gov label.

| number | title | agencyCode | agency | openDate | closeDate | oppStatus | id |
|---|---|---|---|---|---|---|---|
| HR001125S0011 | TTO Office Wide (OW) BAA 2025 | DOD-DARPA-TTO | DARPA - Tactical Technology Office | 06/23/2025 | 12/22/2026 | posted | 359782 |
| HR001126S0015 | Defense Sciences Office (DSO) Office-wide BAA | DOD-DARPA-DSO | DARPA - Defense Sciences Office | 08/28/2026 | 08/27/2027 | posted | 363738 |
| HR001126S0011 | Information Processing Techniques Office Office-Wide | DOD-DARPA-IPTO | DARPA - Information Processing Technologies Office | 06/22/2026 | 06/22/2027 | posted | 362905 |
| DARPARA2701 | Young Faculty Award (YFA) 2027 | DOD-DARPA-DSO | DARPA - Defense Sciences Office | 10/20/2026 | 01/13/2027 | posted | 364129 |

Customer readers that can return an `aggregated_opportunities` row call `isManufacturedDarpaRow`: `search_sbir` (and the MCP / Ask Mindy tool that wraps it), briefings multisite, `/api/sbir`, and market scan. Market scan's source list is `nih_reporter`, `nsf_sbir`, `sbir_gov`. The six April 2026 ids stay out while `naics_code` is still `541715`.

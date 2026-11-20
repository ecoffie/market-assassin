# Gateway live dry-run — 2026-11-19

Read-only. No `--apply`. No write to `agency_forecasts`. The API is not a writer.

Source: `GET https://ag-dashboard.acquisitiongateway.gov/api/v3.0/resources/forecast`

## DHS publication (not the Gateway)

DHS is not one of the 16 Gateway departments. OFPP's later phase will upload DHS forecasts to the Gateway; that phase has no date yet (DHS notice, November 2026).

The official industry page is https://www.dhs.gov/advance-acquisition-planning-forecast-contract-opportunities (page text: last updated 2026-11-09; full forecast and "most recent forecast updates," each as XLSX, CSV, and PDF). Those downloads are the APFS extract. The CSV URL returns Akamai 403 from this network. A public copy of `APFS_forecast_allRecords.csv` parsed on 2026-11-19 is **659** data rows, the same component split as `/forecasts/all`, newest Forecast Published 2026-11-18. An earlier 1,365 figure was a line count of that multiline file, not a record count.

The host in the old migration notice, `era-apfs.dhs.gov`, does not resolve. The live host is **`https://apfs-era.dhs.gov`**.

- `GET /api/apfs-public/forecasts?page=0&size=2` → HTTP 500
- `GET /api/apfs-public/forecasts/all` → HTTP 200, **659** records on 2026-11-19, newest `forecastPublished` 2026-11-18
- Components in that list: USCG 450, DHS HQ 56, USCIS 46, TSA 37, FEMA 24, CBP 20, ICE 16, USSS 6, FLETC 4
- Sample: `F2027076057`, USCG/LOGCOM, NAICS `488310` Port and Harbor Operations, solicitation release 2026-11-18. The JSON has no POC. NAICS is taken from the source string.

`sync-forecasts` now reads `/forecasts/all` when apfs-cloud is HTML, upserts on `(DHS, APFS number)`, and falls back to the CSV. A 500 and a 403 together still fail loud. They do not upsert empty.

No second official forecast turned up. SAM.gov special notice `27_01_IL` (published 2026-10-29) keeps the files on that DHS.gov page through the transition, schedules subscriptions and search on apfs-era for December 2026, and says the nightly upload to GSA's Forecast of Contracting Opportunities has no date. OSDBU "Prospective Business Opportunities" still points at APFS. `Daily_Contract_Reporting.csv` is awarded-contract reporting.

## DHS is not on this source

The agency filter vocabulary is 16 departments. Their filtered totals sum to the unfiltered total **13,468**. Department of Homeland Security is not in the vocabulary. `era-apfs.dhs.gov` does not resolve. `apfs-cloud.dhs.gov/api/forecast/` is the migration HTML notice. www.dhs.gov forecast and OSDBU URLs returned Akamai 403 from this network.

Keyword `search=Homeland+Security` returned 3 rows whose departments are Interior, Agriculture, and GSA. Those titles mention homeland security. They are not a DHS forecast feed.

| tid | listings | department |
|----:|---------:|---|
| 4 | 5,519 | Department of the Interior |
| 22 | 4,103 | Department of Agriculture |
| 20 | 1,183 | Department of Transportation |
| 2 | 1,006 | General Services Administration |
| 8 | 693 | Department of Veterans Affairs |
| 21 | 396 | Department of State |
| 25 | 240 | Department of Education |
| 5 | 187 | Department of Labor |
| 17 | 89 | Nuclear Regulatory Commission |
| 13 | 52 | Department of Commerce |
| 6, 7, 14, 15, 19, 23 | 0 | SBA, OPM, SSA, HHS, FCC, NSF (listed, empty) |
| | **13,468** | |

There is no DHS row to restore through Gateway.

## What an apply would do

Identity is `(source_agency, GW-L:<Listing ID>)`, `source_type=gsa_gateway_csv`. The live DOI listing `2027_ORWA_10101` becomes `GW-L:2027-ORWA-10101` (underscores become hyphens, which is the CSV form). Planner: `planGatewayCsvReconciliation`.

- Same external id and same owned fields → unchanged
- Same external id, different owned fields → update those fields
- External id not held → insert
- Held CSV id missing from the packet → `absentUpstream`, not deleted
- Same listing held as `source_type=api` → `twinApiOverlap`, not mutated

This environment has no production database credentials, so this run did **not** diff the 13,468 listing ids against the ~36.8k held rows. The counts above are the upstream populations. Insert vs update counts for DOI/USDA/VA/DOT/GSA/DOL require `npm run ingest:gateway-csv:dry` against a human Export CSV packet plus `.env.local`. That script is unchanged and still refuses `--apply` without `--i-authorize-apply`. This document is not that authorization.

Sample (page 0, DOI, changed 2026-11-18):

- Listing `2027_ORWA_10101`
- Title: FY27 Western Oregon BLM GeoPlatform Stocking Survey Contract
- Department: Department of the Interior → `DOI`
- Organization: Bureau of Land Management
- NAICS: 115310 Support Activities for Forestry
- Value: `$500K - $999K`
- The API render has no POC email. That is why the CSV export stays the canonical writer.

## Pagination

`page=0` is the first slice. `page=2` repeats `page=1`. `page=3` continues. A concurrent pool of 3 then returned HTTP 503. The census now walks sequentially by default, retries 503/429 with backoff, skips a page whose nid list equals the previous page, and sets `resumePage` instead of calling the source unreachable or complete. A partial read is `degraded` / `content_stale`.

## DOE customer path (separate from Gateway)

The 16 Nov 2026 DOE CSV is 869 data rows. `sync-forecasts` upserts on `(source_agency, external_id)`. The Forrestal painting row's key is `DOE-C:89303025DMA000037`. `get_agency_forecasts` maps `last_synced_at` to `as_of` and returns `source_url` (`https://www.energy.gov/documents/osbp-acquisition-forecast-public-2026-11-16csv`). If the new-identity count for DOE exceeds the daily cap, existing keys still upsert and only the new identities are quarantined.

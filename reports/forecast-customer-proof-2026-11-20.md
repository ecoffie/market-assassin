# Forecast customer proof — 2026-11-20

Read-only. `scripts/prove-forecast-customer-rows.mts` fetched the live sources and mapped them with the collector functions (`dhsEraToStoredRow`, `doeForecastToDbRow`) and `forecastCustomerRow`, which is what `get_agency_forecasts` returns. Nothing was written to `agency_forecasts`.

Sync clock for this run: `2026-11-20T13:42:17.051Z`. `as_of_basis` is `last_synced_at`.

## DHS

`GET https://apfs-era.dhs.gov/api/apfs-public/forecasts/all` → HTTP 200 on the first attempt. **664** records (659 on 2026-11-19; the list moved).

Sample customer row (first record in that response):

- external_id `F2025069721`
- agency `DHS`
- title USCG 87' WPB and 154' WPC Ventilation System Component Purchase
- naics `333412`
- source_url `https://apfs-era.dhs.gov/api/apfs-public/forecasts/all`
- as_of `2026-11-20T13:42:17.051Z`

A 5xx is retried up to 3 times. If the era list still fails, the cron falls back to the dhs.gov all-records CSV. A 403 is not retried. Both failing still throws and upserts nothing.

## DOE

OSDBU page linked edition `2026-11-16`. CSV HTTP 200, **869** data rows.

Forrestal painting customer row:

- external_id `DOE-C:89303025DMA000037`
- agency `DOE`
- incumbent `JB CONTRACTING, INC.`
- naics `238320`
- source_url `https://www.energy.gov/documents/osbp-acquisition-forecast-public-2026-11-16csv`
- as_of `2026-11-20T13:42:17.051Z`

Ask Mindy coming-soon items use the same clock (`forecastSyncClock`): `as_of` is `last_synced_at`, and a missing sync clock is `as_of_basis: unavailable` with `row_updated_at` labeled separately.

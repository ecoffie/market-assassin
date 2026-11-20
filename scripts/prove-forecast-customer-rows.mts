/**
 * Live proof: fetch DHS apfs-era /forecasts/all and the DOE OSDBU CSV,
 * map them with the collector functions, and print the customer row
 * get_agency_forecasts would return (as_of = this run's sync clock).
 *
 * Read-only. Does not write agency_forecasts.
 */
import { doeForecastToDbRow, extractDoeForecastDocuments, parseDoeCsv, absoluteDoeUrl, DOE_FORECAST_PAGE } from '../src/lib/forecasts/doe-forecast';
import { parseMoneyRange, parseNaics, parseSetAside } from '../src/lib/forecasts/usace-district-parse';
import { DHS_ERA_FORECASTS_URL, dhsEraToStoredRow } from '../src/lib/forecasts/dhs-allrecords';
import { forecastCustomerRow } from '../src/lib/forecasts/query';
import { fetchWithRetry } from '../src/lib/forecasts/http-retry';

const syncedAt = new Date().toISOString();

async function dhs() {
  const { response, attempts } = await fetchWithRetry(DHS_ERA_FORECASTS_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'GovConGiants-Mindy/1.0' },
  }, { attempts: 3, retryBaseMs: 400 });
  if (!response.ok) throw new Error(`DHS HTTP ${response.status} after ${attempts}`);
  const data = await response.json() as unknown[];
  if (!Array.isArray(data)) throw new Error('DHS body was not an array');
  const sample = data.find((row) => {
    const stored = dhsEraToStoredRow(row, syncedAt);
    return stored?.external_id === 'F2027076057';
  }) ?? data[0];
  const stored = dhsEraToStoredRow(sample, syncedAt);
  return {
    http: response.status,
    attempts,
    records: data.length,
    customer: stored ? forecastCustomerRow({ id: 'live', ...stored }) : null,
  };
}

async function doe() {
  const page = await fetch(DOE_FORECAST_PAGE, { headers: { 'User-Agent': 'GovConGiants-Mindy/1.0', Accept: 'text/html' } });
  if (!page.ok) throw new Error(`DOE page HTTP ${page.status}`);
  const html = await page.text();
  const docs = extractDoeForecastDocuments(html);
  const current = docs[0];
  if (!current) throw new Error('DOE page has no dated file');
  const sourceUrl = absoluteDoeUrl(current.href);
  const file = await fetch(sourceUrl, { headers: { 'User-Agent': 'GovConGiants-Mindy/1.0', Accept: 'text/csv' } });
  if (!file.ok) throw new Error(`DOE file HTTP ${file.status}`);
  const text = await file.text();
  const parsed = parseDoeCsv(text, { parseMoneyRange, parseSetAside, parseNaics });
  const painting = parsed.rows.find((r) => r.incumbentContractNumber === '89303025DMA000037') ?? parsed.rows[0];
  const stored = doeForecastToDbRow(painting, { sourceUrl, syncedAt });
  return {
    edition: current.edition,
    sourceUrl,
    rows: parsed.rows.length,
    customer: forecastCustomerRow({ id: 'live', ...stored }),
  };
}

const out = {
  syncedAt,
  dhs: await dhs().catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
  doe: await doe().catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
};
console.log(JSON.stringify(out, null, 2));

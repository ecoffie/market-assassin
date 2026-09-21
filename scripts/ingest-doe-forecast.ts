/**
 * Ingest the DOE (+NNSA) acquisition forecast.
 *
 * UNLIKE USACE, THIS ONE IS FETCHABLE — energy.gov serves the spreadsheet at a
 * stable path with no WAF and no login, so this runs unattended. That is the
 * point: a health sweep on 2026-08-01 found 15 of 17 forecast sources last
 * synced 36+ days ago because their Puppeteer scrapers rotted. A
 * fetch-a-spreadsheet job fails LOUDLY (404 / 0 rows) instead of silently
 * returning an empty page, which is the failure shape that hid the staleness.
 *
 *   npx tsx scripts/ingest-doe-forecast.ts            # dry run
 *   npx tsx scripts/ingest-doe-forecast.ts --write
 *   npx tsx scripts/ingest-doe-forecast.ts --file ~/Downloads/doe.xlsx
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { DOE_FORECAST_URL, parseDoeForecast, doeExternalId } from '../src/lib/forecasts/doe-forecast';
import { parseMoneyRange, parseSetAside, parseNaics } from '../src/lib/forecasts/usace-district-parse';

const argOf = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const WRITE = process.argv.includes('--write');
const LOCAL = argOf('file');
const URL_OVERRIDE = argOf('url');

function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      }
    }
  } catch { /* env may come from the shell */ }
}

async function main() {
  loadEnv();

  let buf: Buffer;
  if (LOCAL) {
    buf = readFileSync(LOCAL);
    console.log(`source      ${LOCAL} (local)`);
  } else {
    const url = URL_OVERRIDE || DOE_FORECAST_URL;
    console.log(`source      ${url}`);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } });
    // A moved monthly file 404s — that must fail the run, not quietly import 0.
    if (!res.ok) throw new Error(`fetch ${res.status} — DOE may have moved the monthly file; check the OSDBU page for the current URL`);
    buf = Buffer.from(await res.arrayBuffer());
    console.log(`downloaded  ${buf.length.toLocaleString()} bytes`);
  }

  const wb = XLSX.read(buf, { type: 'buffer' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }) as unknown[][];
  const parsed = parseDoeForecast(aoa, { parseMoneyRange, parseSetAside, parseNaics });

  if (parsed.headerRow === -1) throw new Error('no header row found — DOE changed the layout');
  if (!parsed.rows.length) throw new Error('0 rows parsed — layout changed, or the file is empty');

  const pct = (k: keyof (typeof parsed.rows)[0]) =>
    Math.round((100 * parsed.rows.filter(r => r[k] !== undefined && r[k] !== '').length) / parsed.rows.length);
  console.log(`parsed      ${parsed.rows.length} rows (header row ${parsed.headerRow}, ${parsed.skipped} skipped)`);
  console.log(`coverage    naics ${pct('naicsCode')}%  incumbent ${pct('incumbentName')}%  value ${pct('estimatedValueMax')}%  set-aside ${pct('setAside')}%  state ${pct('popState')}%`);

  console.log('\nfirst 5 rows:');
  for (const r of parsed.rows.slice(0, 5)) {
    console.log(`  • ${r.title.slice(0, 60)}`);
    console.log(`      ${r.programOffice?.slice(0, 36) ?? '—'} | ${r.naicsCode ?? '—'} | ${r.estimatedValueRange ?? '—'} | ${r.popState ?? '—'}`);
    console.log(`      incumbent: ${r.incumbentName?.slice(0, 34) ?? '—'} ${r.incumbentContractNumber ?? ''}`);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing Supabase env');
  const sb = createClient(url, key);

  const records = parsed.rows.map(r => ({
    source_agency: 'DOE',
    source_type: 'osdbu_xlsx',
    external_id: doeExternalId(r),
    title: r.title,
    description: r.naicsDescription || null,
    bureau: r.programOffice || null,
    contracting_office: r.programOffice || null,
    naics_code: r.naicsCode || null,
    naics_description: r.naicsDescription || null,
    estimated_value_min: r.estimatedValueMin ?? null,
    estimated_value_max: r.estimatedValueMax ?? null,
    estimated_value_range: r.estimatedValueRange || null,
    set_aside_type: r.setAside || null,
    contract_type: r.contractType || null,
    incumbent_name: r.incumbentName || null,
    incumbent_contract_number: r.incumbentContractNumber || null,
    performance_end_date: r.performanceEndDate || null,
    pop_state: r.popState || null,
    status: 'forecasted',
    raw_data: { source_row: r.raw },
    last_synced_at: new Date().toISOString(),
  }));

  const seen = new Set<string>();
  const deduped = records.filter(r => !seen.has(r.external_id) && seen.add(r.external_id));
  if (deduped.length !== records.length) console.log(`\n${records.length - deduped.length} duplicate id(s) collapsed`);

  const { count: before } = await sb.from('agency_forecasts')
    .select('id', { count: 'exact', head: true }).eq('source_agency', 'DOE');
  console.log(`\nDOE rows currently held: ${before ?? '?'}`);

  if (!WRITE) {
    console.log(`\nDRY RUN — nothing written. ${deduped.length} rows would upsert.`);
    return;
  }

  let written = 0;
  for (let i = 0; i < deduped.length; i += 200) {
    const batch = deduped.slice(i, i + 200);
    // Composite unique constraint is (source_agency, external_id).
    const { error } = await sb.from('agency_forecasts').upsert(batch, { onConflict: 'source_agency,external_id' });
    if (error) throw new Error(`upsert: ${error.message}`);
    written += batch.length;
    console.log(`  wrote ${written}/${deduped.length}`);
  }
  const { count: after } = await sb.from('agency_forecasts')
    .select('id', { count: 'exact', head: true }).eq('source_agency', 'DOE');
  console.log(`\n✓ ${written} upserted — DOE rows now ${after ?? '?'} (was ${before ?? '?'})`);
}

main().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });

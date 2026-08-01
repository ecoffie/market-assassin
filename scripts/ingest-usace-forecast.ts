/**
 * Ingest a USACE district acquisition-forecast document into agency_forecasts.
 *
 * MANUAL DROP by design. Every usace.army.mil host sits behind an Akamai edge
 * WAF that 403s unattended fetches (verified 2026-08-01: district PDFs, the HQ
 * MILCON page, and business.defense.gov all block), and there is no official
 * feed — acquisition.gov is a link directory with no Army entry, and DHS APFS
 * is DHS-only. A human downloads the file in a browser, where it serves
 * normally, and points this script at it.
 *
 * USAGE
 *   # 1. ALWAYS dry-run first — prints what WOULD be written, touches nothing.
 *   npx tsx scripts/ingest-usace-forecast.ts --file ~/Downloads/spl.pdf \
 *     --district "ENDIST LOS ANGELES"
 *
 *   # 2. Only after the rows look right:
 *   npx tsx scripts/ingest-usace-forecast.ts --file ~/Downloads/spl.pdf \
 *     --district "ENDIST LOS ANGELES" --write
 *
 * The --district value should match a dodaac_directory display_name so the
 * rows join to the office/early-signal work already shipped; the script warns
 * when it does not.
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { extractPdf, extractXlsx } from '../src/lib/sam/pdf-extract';
import {
  parseUsaceForecastText,
  usaceExternalId,
  type UsaceForecastRow,
} from '../src/lib/forecasts/usace-district-parse';
import { parseUsaceSheet, type UsaceWorkbookRow } from '../src/lib/forecasts/usace-workbook-parse';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const FILE = arg('file');
const DISTRICT = arg('district');
const WRITE = process.argv.includes('--write');
const LIMIT = Number(arg('limit') || '0');

if (!FILE) {
  console.error('usage: --file <path> [--district "<name>"] [--write] [--limit N]');
  console.error('  --district is REQUIRED for a PDF (it names the office);');
  console.error('  for an XLSX division workbook it is optional and scopes the run to one sheet.');
  process.exit(1);
}

// .env.local from `vercel env pull` can carry a literal \n on a value; strip it
// or the service key 401s with a misleading "Invalid API key".
function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      if (!process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      }
    }
  } catch { /* env may come from the shell instead */ }
}

const fmt = (n?: number) =>
  n === undefined ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${n.toLocaleString()}`;

/**
 * Sheet name → the office's display_name in dodaac_directory, so workbook rows
 * join the office rollup and early-signal badge. USACE districts are stored as
 * "ENDIST <city>", which is not what the sheet tabs are called.
 */
const SHEET_TO_OFFICE: Record<string, string> = {
  Buffalo: 'ENDIST BUFFALO', Chicago: 'ENDIST CHICAGO', Detroit: 'ENDIST DETROIT',
  Huntington: 'ENDIST HUNTINGTON', Louisville: 'ENDIST LOUISVILLE',
  Nashville: 'ENDIST NASHVILLE', Pittsburgh: 'ENDIST PITTSBURGH',
  Memphis: 'ENDIST MEMPHIS', 'New Orleans': 'ENDIST NEW ORLEANS',
  Galveston: 'ENDIST GALVESTON', 'Fort Worth': 'ENDIST FT WORTH',
  Tulsa: 'ENDIST TULSA', 'Little Rock': 'ENDIST LITTLE ROCK',
  Vicksburg: 'ENDIST VICKSBURG', 'St. Louis': 'ENDIST ST LOUIS',
  'Kansas City': 'ENDIST KANSAS CITY', Omaha: 'ENDIST OMAHA', Seattle: 'ENDIST SEATTLE',
  Portland: 'ENDIST PORTLAND', Sacramento: 'ENDIST SACRAMENTO', 'Los Angeles': 'ENDIST LOS ANGELES',
  Albuquerque: 'ENDIST ALBUQUERQUE', Mobile: 'ENDIST MOBILE', Savannah: 'ENDIST SAVANNAH',
  Charleston: 'ENDIST CHARLESTON', Wilmington: 'ENDIST WILMINGTON', Norfolk: 'ENDIST NORFOLK',
  Baltimore: 'ENDIST BALTIMORE', Philadelphia: 'ENDIST PHILADELPHIA', 'New York': 'ENDIST NEW YORK',
  'New England': 'ENDIST NEW ENGLAND', Alaska: 'ENDIST ALASKA', Honolulu: 'ENDIST HONOLULU',
};

/** Division workbook: one sheet per district, labelled columns. */
async function ingestWorkbook(buf: Buffer) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });

  const all: Array<{ office: string; sheet: string; row: UsaceWorkbookRow }> = [];
  let skipped = 0;
  console.log(`\nfile        ${FILE}`);
  console.log(`workbook    ${wb.SheetNames.length} sheet(s): ${wb.SheetNames.join(', ')}\n`);
  console.log('sheet         rows  skip  naics%  value%   FY%  set-aside%  → office');

  for (const name of wb.SheetNames) {
    // --district scopes the run to one sheet; omit it to ingest the whole book.
    if (DISTRICT && !name.toLowerCase().includes(DISTRICT.toLowerCase())
        && !(SHEET_TO_OFFICE[name] || '').toLowerCase().includes(DISTRICT.toLowerCase())) continue;
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as unknown[][];
    const res = parseUsaceSheet(name, aoa);
    skipped += res.skipped;
    const office = SHEET_TO_OFFICE[name] || `ENDIST ${name.toUpperCase()}`;
    const pct = (k: keyof UsaceWorkbookRow) => res.rows.length
      ? Math.round((100 * res.rows.filter(r => r[k] !== undefined && r[k] !== '').length) / res.rows.length) : 0;
    console.log(
      `  ${name.padEnd(11)} ${String(res.rows.length).padStart(4)} ${String(res.skipped).padStart(5)}` +
      ` ${String(pct('naicsCode')).padStart(6)} ${String(pct('estimatedValueMax')).padStart(6)}` +
      ` ${String(pct('fiscalYear')).padStart(5)} ${String(pct('setAside')).padStart(10)}  → ${office}`,
    );
    for (const row of res.rows) all.push({ office, sheet: name, row });
  }

  if (!all.length) {
    console.error('\nNo rows parsed from any sheet.');
    process.exit(1);
  }
  console.log(`\nTOTAL ${all.length} rows (${skipped} rows had no project description)`);

  console.log('\nfirst 8 rows:');
  for (const { office, row: r } of all.slice(0, 8)) {
    console.log(`  • [${office}] ${r.title.slice(0, 58)}`);
    console.log(`      ${r.location ?? '—'}  naics=${r.naicsCode ?? '—'}  ${r.estimatedValueRange ?? '—'}  ${r.fiscalYear ?? '—'} ${r.anticipatedQuarter ?? ''} ${r.setAside ?? ''}`.trimEnd());
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) { console.error('\nMissing Supabase env'); process.exit(1); }
  const sb = createClient(supabaseUrl, supabaseKey);

  // Which offices will actually join? Report per office so a mis-mapped sheet
  // is visible BEFORE the write, not discovered later as a disconnected row.
  const offices = [...new Set(all.map(a => a.office))];
  console.log('\noffice join check:');
  for (const o of offices) {
    const { data, error } = await sb.from('dodaac_directory_display')
      .select('dodaac, display_name').ilike('display_name', o).limit(1);
    if (error) console.log(`  ⚠ ${o} — lookup failed: ${error.message}`);
    else if (data?.length) console.log(`  ✓ ${o} → ${data[0].dodaac}`);
    else console.log(`  ✗ ${o} — no office match (rows store, but won't join the rollup/badge)`);
  }

  const records = all.map(({ office, row: r }) => ({
    source_agency: 'USACE',
    source_type: 'district_workbook',
    external_id: usaceExternalId(office, r.title, r.location),
    title: r.title,
    description: r.location ? `Location: ${r.location}` : null,
    bureau: 'U.S. Army Corps of Engineers',
    contracting_office: office,
    naics_code: r.naicsCode || null,
    psc_code: r.pscCode || null,
    estimated_value_min: r.estimatedValueMin ?? null,
    estimated_value_max: r.estimatedValueMax ?? null,
    estimated_value_range: r.estimatedValueRange || null,
    set_aside_type: r.setAside || null,
    contract_type: r.contractVehicle || null,
    fiscal_year: r.fiscalYear || null,
    anticipated_quarter: r.anticipatedQuarter || null,
    pop_state: r.popState || null,
    status: 'forecasted',
    raw_data: { sheet: r.district, source_row: r.raw, ingested_from: FILE },
    last_synced_at: new Date().toISOString(),
  }));

  // Same title can appear in two districts; external_id includes the office, but
  // a duplicate WITHIN one sheet would make the upsert fail on a repeated key.
  const seen = new Set<string>();
  const deduped = records.filter(r => {
    if (seen.has(r.external_id)) return false;
    seen.add(r.external_id); return true;
  });
  if (deduped.length !== records.length) {
    console.log(`\n${records.length - deduped.length} duplicate title(s) within a district collapsed`);
  }

  if (!WRITE) {
    console.log(`\nDRY RUN — nothing written. ${deduped.length} rows would upsert.`);
    console.log('Re-run with --write once the rows above look right.');
    return;
  }

  let written = 0;
  for (let i = 0; i < deduped.length; i += 200) {
    const batch = deduped.slice(i, i + 200);
    const { error } = await sb.from('agency_forecasts').upsert(batch, { onConflict: 'source_agency,external_id' });
    if (error) throw new Error(`upsert: ${error.message}`);
    written += batch.length;
    console.log(`  wrote ${written}/${deduped.length}`);
  }
  console.log(`\n✓ ${written} rows upserted across ${offices.length} district(s)`);
}

async function main() {
  loadEnv();

  const buf = readFileSync(FILE!);
  const isXlsx = /\.(xlsx|xls)$/i.test(FILE!);

  // XLSX gets real COLUMN mapping, not line scanning. The division workbooks
  // carry one sheet per district with labelled headers (Great Lakes & Ohio
  // River: 7 districts, 480 rows in one file), so treating them as text would
  // throw away the structure that makes the parse reliable.
  if (isXlsx) return ingestWorkbook(buf);

  const extracted = await extractPdf(buf);
  const parsed = parseUsaceForecastText(extracted.text);

  console.log(`\nfile        ${FILE}`);
  console.log(`district    ${DISTRICT}`);
  console.log(`extracted   ${extracted.text.length.toLocaleString()} chars${extracted.pageCount ? ` / ${extracted.pageCount} pages` : ''}`);
  console.log(`layout      ${parsed.layout}`);
  console.log(`parsed      ${parsed.rows.length} rows  (${parsed.skipped} lines had a signal but no usable title)`);

  if (!parsed.rows.length) {
    console.error(
      '\nNo rows parsed. This is a PARSER problem, not an empty document — the\n' +
      'district layout probably differs from the ones seen so far. Re-run with\n' +
      '--dump to print the raw extracted text so the parser can be extended.',
    );
    if (process.argv.includes('--dump')) console.log('\n--- RAW ---\n' + extracted.text.slice(0, 4000));
    process.exit(1);
  }

  const rows = LIMIT ? parsed.rows.slice(0, LIMIT) : parsed.rows;

  // Field-level fill rates: the honest measure of whether a parse is good.
  const fill = (k: keyof UsaceForecastRow) =>
    Math.round((100 * rows.filter(r => r[k] !== undefined && r[k] !== '').length) / rows.length);
  console.log(
    `\nfield coverage   naics ${fill('naicsCode')}%  value ${fill('estimatedValueMax')}%  ` +
    `FY ${fill('fiscalYear')}%  set-aside ${fill('setAside')}%  qtr ${fill('anticipatedQuarter')}%`,
  );

  console.log('\nfirst 10 rows:');
  for (const r of rows.slice(0, 10)) {
    console.log(`  • ${r.title.slice(0, 68)}`);
    console.log(`      naics=${r.naicsCode ?? '—'}  value=${fmt(r.estimatedValueMax)}  ${r.fiscalYear ?? '—'} ${r.anticipatedQuarter ?? ''} ${r.setAside ?? ''}`.trimEnd());
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('\nMissing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const sb = createClient(supabaseUrl, supabaseKey);

  // Warn (don't block) when the district name won't join to a real office —
  // the rows are still valid forecasts, they just won't light up the office
  // rollup or the early-signal badge.
  // Check { error }, not just { data }: PostgREST fails the WHOLE query on a
  // renamed column and returns data=null, which would read as "your district
  // name is wrong" when the truth is "the lookup broke". Distinguish the two.
  const { data: match, error: matchErr } = await sb
    .from('dodaac_directory_display')
    .select('dodaac, display_name')
    .ilike('display_name', `%${DISTRICT}%`)
    .limit(3);
  if (matchErr) {
    console.log(`\n⚠ could not check the district join: ${matchErr.message}`);
    console.log('  (ingest can still proceed — this check is advisory)');
  } else if (match?.length) {
    console.log(`\ndistrict joins to: ${match.map(m => `${m.dodaac} ${m.display_name}`).join(' · ')}`);
  } else {
    console.log(`\n⚠ "${DISTRICT}" matches no office in dodaac_directory — rows will store, but`);
    console.log('  will not join the office rollup or early-signal badge. Check the spelling');
    console.log('  against display_name (e.g. "ENDIST LOUISVILLE", not "Louisville District").');
  }

  const records = rows.map(r => ({
    source_agency: 'USACE',
    source_type: 'district_pdf',
    external_id: usaceExternalId(DISTRICT!, r.title),
    title: r.title,
    description: r.description || null,
    bureau: 'U.S. Army Corps of Engineers',
    contracting_office: DISTRICT,
    naics_code: r.naicsCode || null,
    estimated_value_min: r.estimatedValueMin ?? null,
    estimated_value_max: r.estimatedValueMax ?? null,
    set_aside_type: r.setAside || null,
    fiscal_year: r.fiscalYear || null,
    anticipated_quarter: r.anticipatedQuarter || null,
    solicitation_date: r.solicitationDate || null,
    contract_type: r.contractType || null,
    status: 'forecasted',
    raw_data: { source_line: r.raw, ingested_from: FILE },
    last_synced_at: new Date().toISOString(),
  }));

  if (!WRITE) {
    console.log(`\nDRY RUN — nothing written. ${records.length} rows would upsert.`);
    console.log('Re-run with --write once the rows above look right.');
    return;
  }

  let written = 0;
  for (let i = 0; i < records.length; i += 200) {
    const batch = records.slice(i, i + 200);
    // Upsert on external_id so a re-drop of a republished PDF updates in place
    // rather than duplicating the district.
    const { error } = await sb
      .from('agency_forecasts')
      .upsert(batch, { onConflict: 'source_agency,external_id' });
    if (error) throw new Error(`upsert: ${error.message}`);
    written += batch.length;
    console.log(`  wrote ${written}/${records.length}`);
  }
  console.log(`\n✓ ${written} rows upserted for ${DISTRICT}`);
}

main().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });

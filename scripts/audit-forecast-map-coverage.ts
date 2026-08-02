/**
 * Map-coverage audit — the weekly check that a 0% is a FACT, not a bug.
 * Read-only. See src/lib/forecasts/map-coverage.ts for the policy.
 */
import { config } from 'dotenv';
config({ path: '.env.local', override: true });
import { createClient } from '@supabase/supabase-js';
import { classifyMapGap, isFixable, type MapGap } from '../src/lib/forecasts/map-coverage';

// From the ledger: sources VERIFIED (by opening the portal / inspecting the
// file) to publish no place-of-performance field at all. Everything else is
// assumed to have one, so a blank there is reported as fixable rather than
// shrugged off.
const NO_LOCATION_SOURCES = new Set(['HHS', 'NASA', 'SSA']);

// ...and the same fact at SOURCE_TYPE level, because one agency can publish
// several artifacts with different schemas. USACE's enterprise DA workbook and
// district PDFs have no place column; only its district workbooks do. Keying
// on the agency alone over-counted USACE fixables by 2,349.
const NO_LOCATION_SOURCE_TYPES = new Set(['enterprise_da_format', 'district_da_pdf']);

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from('agency_forecasts')
      .select('source_agency,source_type,map_lat,pop_state,pop_city').order('id').range(f, f + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const tally = new Map<string, Map<MapGap, number>>();
  for (const r of rows) {
    const a = r.source_agency || '(none)';
    const publishes = !NO_LOCATION_SOURCES.has(a) && !NO_LOCATION_SOURCE_TYPES.has(r.source_type);
    const gap = classifyMapGap(r, publishes);
    if (!tally.has(a)) tally.set(a, new Map());
    const m = tally.get(a)!;
    m.set(gap, (m.get(gap) || 0) + 1);
  }

  console.log(`agency_forecasts: ${rows.length} rows\n`);
  console.log('source        rows  mapped  NOT_PUB  SUPPRESS  NOT_PLACE   FIXABLE');
  let totalFixable = 0;
  const order = [...tally.entries()].sort((a, b) =>
    [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0));
  for (const [agency, m] of order) {
    const n = (k: MapGap) => m.get(k) || 0;
    const total = [...m.values()].reduce((x, y) => x + y, 0);
    const fixable = [...m.entries()].filter(([k]) => isFixable(k)).reduce((s, [, v]) => s + v, 0);
    totalFixable += fixable;
    console.log(
      `${agency.slice(0, 12).padEnd(12)} ${String(total).padStart(5)} ${String(n('MAPPED')).padStart(7)}`
      + ` ${String(n('NO_LOCATION_PUBLISHED')).padStart(8)} ${String(n('SUPPRESSED_BY_SOURCE')).padStart(9)}`
      + ` ${String(n('NOT_A_PLACE')).padStart(10)} ${String(fixable).padStart(9)}${fixable ? '  ←' : ''}`);
  }
  console.log(`\nFIXABLE TOTAL: ${totalFixable} rows carry a location we are failing to map.`);
  console.log('Anything in that column is a PARSER bug — fix the parser and re-ingest,');
  console.log('never hand-patch rows (the next sync recreates them).');
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

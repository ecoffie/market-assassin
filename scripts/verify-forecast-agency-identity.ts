/**
 * verify:forecast-agency — proves forecast AGENCY IDENTITY against the LIVE database.
 *
 * Read-only. Sends no email. Exits non-zero on any mismatch so an agent cannot mistake a red
 * run for a green one.
 *
 * WHY A LIVE CHECK: the unit tests prove the resolver returns the right CODES, but only the
 * database can prove those codes select the right ROWS — and the 2026-09-14 audit defects were
 * exactly that gap (agency=EPA returned 7,246 rows for a 50-row agency; 9 of 16 map presets
 * returned zero). "It compiles" is not "it works"; a 200 with a wrong count is a FAIL.
 *
 *   npx tsx scripts/verify-forecast-agency-identity.ts
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import {
  resolveForecastAgencies,
  forecastAgencyOrExpr,
  FORECAST_AGENCY_IDENTITIES,
} from '../src/lib/forecasts/agency-identity';

config({ path: '.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** Exact count for a resolved agency term, applying the SAME expression every surface applies. */
async function countFor(term: string, mappedOnly = false): Promise<number> {
  const expr = forecastAgencyOrExpr(resolveForecastAgencies(term));
  let q = sb.from('agency_forecasts').select('id', { count: 'exact', head: true });
  if (mappedOnly) q = q.not('map_lat', 'is', null);
  if (expr) q = q.or(expr);
  const { count, error } = await q;
  // A null count is UNKNOWN, never zero (Bug Prevention Rule #11).
  if (error) throw new Error(`count failed for "${term}": ${error.message}`);
  if (count == null) throw new Error(`count came back NULL for "${term}" — unknown, not zero`);
  return count;
}

/** Ground truth straight from source_agency, bypassing the resolver entirely. */
async function truthFor(codes: string[]): Promise<number> {
  if (!codes.length) return 0;
  const { count, error } = await sb
    .from('agency_forecasts').select('id', { count: 'exact', head: true }).in('source_agency', codes);
  if (error) throw new Error(`truth count failed: ${error.message}`);
  if (count == null) throw new Error('truth count NULL — unknown, not zero');
  return count;
}

async function main() {
  let failures = 0;
  const row = (ok: boolean, label: string, detail: string) => {
    if (!ok) failures++;
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(34)} ${detail}`);
  };

  console.log('\n── forecast agency identity — LIVE verification ──\n');

  console.log('every identity resolves to exactly its own rows:');
  for (const id of FORECAST_AGENCY_IDENTITIES) {
    const viaResolver = await countFor(id.key);
    const truth = await truthFor(id.codes);
    row(viaResolver === truth, `${id.key} (${id.coverage})`,
      `resolver=${viaResolver} truth=${truth}${id.codes.length ? ` codes=[${id.codes.join(',')}]` : ' (no coverage)'}`);
  }

  // The acronyms Eric named. Each must equal its own corpus and NOT bleed into other agencies.
  console.log('\nshort-acronym over-match regression (the EPA/SEC class):');
  for (const a of ['EPA', 'FBI', 'DEA', 'ATF', 'TSA', 'FAA', 'DLA', 'SEC', 'GSA', 'VA']) {
    const got = await countFor(a);
    const id = FORECAST_AGENCY_IDENTITIES.find((x) => x.key === a)!;
    const truth = await truthFor(id.codes);
    row(got === truth, a, `${got} rows (expected ${truth})`);
  }

  console.log('\nparent/child determinism:');
  const navy = await countFor('NAVY');
  const dod = await countFor('DOD');
  const army = await countFor('ARMY');
  const usace = await countFor('USACE');
  row(dod >= navy, 'DOD ⊇ NAVY', `DOD=${dod} NAVY=${navy}`);
  row(dod >= usace, 'DOD ⊇ USACE', `DOD=${dod} USACE=${usace}`);
  row(army === usace, 'ARMY == USACE (partial)', `ARMY=${army} USACE=${usace}`);
  row(dod === navy + usace, 'DOD == NAVY + USACE exactly', `${dod} == ${navy} + ${usace}`);
  for (const [child, parent] of [['TSA', 'DHS'], ['FAA', 'DOT'], ['FBI', 'DOJ'], ['DLA', 'DOD']] as const) {
    const c = await countFor(child);
    row(c === 0, `${child} does NOT inherit ${parent}`, `${c} rows`);
  }

  console.log('\nagency-reachable corpus:');
  const { count: total, error: tErr } = await sb.from('agency_forecasts').select('id', { count: 'exact', head: true });
  if (tErr || total == null) throw new Error('total count unavailable');
  const reachable = new Set<string>();
  for (const id of FORECAST_AGENCY_IDENTITIES) for (const c of id.codes) reachable.add(c);
  const reach = await truthFor([...reachable]);
  row(reach === total, 'every owned row reachable by agency', `${reach} / ${total}`);

  console.log(`\n${failures === 0 ? '✓ PASS' : `✗ FAIL — ${failures} check(s)`} \n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify-forecast-agency-identity threw:', e); process.exit(1); });

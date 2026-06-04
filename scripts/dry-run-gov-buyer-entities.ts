/**
 * Dry-run: pull SAM entities for ONE NAICS and verify the
 * searchEntities → entityToRow → sam_entities mapping before we widen
 * the seed list. Calls the REAL functions the cron uses (no drift).
 *
 * Run:
 *   npx tsx scripts/dry-run-gov-buyer-entities.ts 541512 DC
 *   WRITE=true npx tsx scripts/dry-run-gov-buyer-entities.ts 541512   # also upsert
 *
 * Args: [naics] [state?]   Env: WRITE=true to actually upsert to Supabase.
 *
 * PRD: docs/PRD-gov-buyer-market-research.md §8
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { searchEntities } from '../src/lib/sam/entity-api';
import { entityToRow } from '../src/app/api/cron/sync-gov-buyer-data/route';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const NAICS = process.argv[2] || '541512';
const STATE = process.argv[3] || undefined;
const WRITE = process.env.WRITE === 'true';

function line() { console.log('─'.repeat(70)); }

async function main() {
  console.log(`\nDry run — SAM entities for NAICS ${NAICS}${STATE ? ` / ${STATE}` : ''}`);
  console.log(`Mode: ${WRITE ? 'WRITE (will upsert)' : 'READ-ONLY (no DB writes)'}`);
  line();

  // 1) Pull from the live SAM Entity API via the real wrapper.
  const result = await searchEntities({
    naicsCode: NAICS,
    stateCode: STATE,
    registrationStatus: 'Active',
    page: 1,
    size: 10, // small sample for inspection
  });

  console.log(`SAM returned: totalCount=${result.totalCount}, this page=${result.entities.length}, hasMore=${result.hasMore}, fromCache=${result.fromCache}`);
  if (!result.entities.length) {
    console.log('\n⚠️  0 entities. Check SAM_API_KEY, or this NAICS+state may have no active registrants.');
    return;
  }
  line();

  // 2) Show the raw→mapped transformation for the first few.
  const sample = result.entities.slice(0, 3);
  sample.forEach((e, i) => {
    const row = entityToRow(e);
    console.log(`\n[${i + 1}] ${row.legal_business_name}`);
    console.log(`    uei:          ${row.uei}`);
    console.log(`    cage:         ${row.cage_code ?? '(null)'}`);
    console.log(`    state/city:   ${row.physical_state ?? '?'} / ${row.physical_city ?? '?'}`);
    console.log(`    primary_naics:${row.primary_naics ?? '(null)'}`);
    console.log(`    naics_codes:  [${(row.naics_codes || []).join(', ')}]`);
    console.log(`    certifications:[${(row.certifications || []).join(', ')}]`);
    console.log(`    reg status:   ${row.registration_status ?? '?'}  expiry: ${row.registration_expiry ?? '?'}`);
    console.log(`    sam_url:      ${row.sam_url ?? '(null)'}`);
  });
  line();

  // 3) Field-mapping health check — flag blanks that would break the rubric.
  const rows = result.entities.map(entityToRow);
  const checks = {
    'missing uei':            rows.filter(r => !r.uei).length,
    'missing legal name':     rows.filter(r => !r.legal_business_name).length,
    'missing state':          rows.filter(r => !r.physical_state).length,
    'empty naics_codes':      rows.filter(r => !r.naics_codes?.length).length,
    'naics_codes lacks target': rows.filter(r => !(r.naics_codes || []).includes(NAICS)).length,
    'empty certifications':   rows.filter(r => !r.certifications?.length).length,
    'no registration_status': rows.filter(r => !r.registration_status).length,
  };
  console.log('Field-mapping health (out of ' + rows.length + '):');
  for (const [k, v] of Object.entries(checks)) {
    const flag = (k === 'missing uei' || k === 'missing legal name' || k === 'naics_codes lacks target') && v > 0 ? ' ❌' :
                 v > 0 ? ' ⚠️' : ' ✅';
    console.log(`    ${k.padEnd(26)} ${v}${flag}`);
  }
  console.log('\n  (empty certifications is EXPECTED for non-small-biz entities;');
  console.log('   "naics_codes lacks target" should be 0 — we filtered ON this NAICS.)');
  line();

  // 4) Optional write — round-trip through Supabase + read one back.
  if (WRITE) {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { error } = await sb.from('sam_entities').upsert(rows, { onConflict: 'uei', ignoreDuplicates: false });
    if (error) { console.log('❌ upsert failed:', error.message); return; }
    console.log(`✅ upserted ${rows.length} rows.`);

    const { data, error: rerr } = await sb
      .from('sam_entities')
      .select('uei, legal_business_name, certifications, naics_codes')
      .contains('naics_codes', [NAICS])
      .limit(3);
    if (rerr) { console.log('readback error:', rerr.message); return; }
    console.log(`Read back ${data?.length} rows that contain NAICS ${NAICS} — round-trip OK.`);
  } else {
    console.log('READ-ONLY: re-run with WRITE=true to upsert and test the round-trip.');
  }
  console.log('');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

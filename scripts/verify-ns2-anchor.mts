/**
 * NS-2 BEHAVIORAL ACCEPTANCE — the REAL query against LIVE data.
 *
 * The unit tests for this fix are source-string assertions, and this repo has been burned
 * by those ("a source test proves code SHIPPED, never that it RUNS"). This proves the
 * behaviour: North Star's own SABER task order must reach the evidence set.
 *
 *   npx tsx scripts/verify-ns2-anchor.mts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) fail++; console.log(`  ${c ? '✓' : '✗'} ${m}`); };

const { queryExpiringContracts } = await import('../src/lib/recompete/query');

console.log('\n  ══ NS-2 · anchored retrieval, live data ══\n');
const base: any = await queryExpiringContracts({ naics: '236220', months: 18, limit: 50 } as any);
const anchored: any = await queryExpiringContracts({ naics: '236220', months: 18, limit: 50, anchorPiidPrefixes: ['FA4610'] } as any);
const fa = (r: any) => (r.contracts || []).filter((c: any) => String(c.piid || '').startsWith('FA4610'));

console.log(`  without anchor: ${base.contracts?.length} rows, FA4610 = ${fa(base).length}`);
console.log(`  with anchor:    ${anchored.contracts?.length} rows, FA4610 = ${fa(anchored).length}\n`);

ok(fa(anchored).length > fa(base).length, `anchoring surfaces vehicles the ranking cut (${fa(base).length} → ${fa(anchored).length})`);
ok((anchored.contracts || []).some((c: any) => c.piid === 'FA461025F0190'), "North Star's own SABER task order FA461025F0190 is reachable");
ok(fa(anchored).every((c: any) => c.naics_code === '236220'), 'eligibility UNCHANGED — every anchored row is still NAICS 236220');
ok((anchored.contracts || []).length >= (base.contracts || []).length, 'anchoring never removes a row that already qualified');
ok(new Set((anchored.contracts || []).map((c: any) => c.contract_id)).size === (anchored.contracts || []).length, 'no duplicates after the merge');

const none: any = await queryExpiringContracts({ naics: '236220', months: 18, limit: 50, anchorPiidPrefixes: [] } as any);
ok((none.contracts || []).length === (base.contracts || []).length, 'an empty anchor list changes nothing');
const bogus: any = await queryExpiringContracts({ naics: '236220', months: 18, limit: 50, anchorPiidPrefixes: ["'; DROP--"] } as any);
ok((bogus.contracts || []).length === (base.contracts || []).length, 'an invalid prefix is rejected, not interpolated');

console.log(fail ? `\n  ✗ ${fail} FAILED\n` : '\n  ✓ NS-2 VERIFIED ON LIVE DATA\n');
process.exit(fail ? 1 : 0);

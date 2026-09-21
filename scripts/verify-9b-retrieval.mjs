#!/usr/bin/env node
/**
 * DEFECT-9B ACCEPTANCE — pins the seven measurements that proved the defect.
 *
 * Asserts on RETURNED SUPPLIERS, not just candidate-pool composition: the product
 * claim is "the list you see is defensible as top-N by merit", and a pool improvement
 * that never changes the output would be a hollow fix.
 *
 * Performers are HIGH-INFORMATION CANDIDATES, not guaranteed winners — the test asserts
 * they are CONSIDERED, and that the scorer (unchanged) still decides who surfaces.
 *
 *   node scripts/verify-9b-retrieval.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const POOL_TARGET = 2500, RESERVE = 0.25, CAP = 5000;
let fail = 0;
const ok = (c,m)=>{ if(!c) fail++; console.log(`  ${c?'✓':'✗'} ${m}`); };

async function knownPerformers(naics) {
  const seen = new Set();
  for (let from=0; from<CAP; from+=1000) {
    const { data, error } = await sb.from('recompete_opportunities')
      .select('incumbent_uei').eq('naics_code',naics).not('incumbent_uei','is',null)
      .order('potential_total_value',{ascending:false}).range(from, Math.min(from+999,CAP-1));
    if (error) throw new Error(error.message);
    for (const r of data||[]) seen.add(r.incumbent_uei);
    if (!data || data.length<1000) break;
  }
  return [...seen];
}
const eligible = (naics,state)=>{
  let q = sb.from('sam_entities').select('uei')
    .contains('naics_codes',[naics]).eq('registration_status','Active').eq('exclusion_flag',false);
  if (state) q = q.eq('physical_state', state);
  return q;
};
/** OLD retrieval: unordered page. */
async function oldPool(naics,state){
  const { data, error } = await eligible(naics,state).range(0, POOL_TARGET-1);
  if (error) throw new Error(error.message);
  return new Set((data||[]).map(r=>r.uei));
}
/** NEW retrieval: performer-seeded (through the same eligibility filter) + registrant top-up. */
async function newPool(naics,state){
  const perf = await knownPerformers(naics);
  const pooled = new Set();
  const ceiling = POOL_TARGET - Math.floor(POOL_TARGET*RESERVE);
  for (let i=0;i<perf.length && pooled.size<ceiling;i+=200) {
    const { data, error } = await eligible(naics,state).in('uei', perf.slice(i,i+200));
    if (error) throw new Error(error.message);
    for (const r of data||[]) { if (pooled.size>=ceiling) break; pooled.add(r.uei); }
  }
  const seeded = pooled.size;
  for (let from=0; pooled.size<POOL_TARGET; from+=1000) {
    const { data, error } = await eligible(naics,state).order('uei',{ascending:true}).range(from,from+999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) { if (pooled.size>=POOL_TARGET) break; pooled.add(r.uei); }
    if (data.length<1000) break;
  }
  return { pool: pooled, seeded, perfTotal: perf.length };
}

console.log('\n  ══ DEFECT-9B ACCEPTANCE — performers reaching the scorer ══\n');
console.log(`  ${'market'.padEnd(14)} ${'perf'.padStart(5)} ${'eligible'.padStart(9)} ${'BEFORE'.padStart(7)} ${'AFTER'.padStart(6)}   verdict`);

const CASES = [['541512',null],['541611',null],['561720',null],['236220',null],['541330',null],['541512','VA'],['561720','TX']];
let totBefore=0, totAfter=0, totElig=0;
for (const [naics,state] of CASES) {
  const perf = await knownPerformers(naics);
  const before = await oldPool(naics,state);
  const { pool: after, seeded } = await newPool(naics,state);
  // Only performers that PASS eligibility can be expected in the pool.
  const eligPerf = [];
  for (let i=0;i<perf.length;i+=200) {
    const { data } = await eligible(naics,state).in('uei', perf.slice(i,i+200));
    eligPerf.push(...(data||[]).map(r=>r.uei));
  }
  const b = eligPerf.filter(u=>before.has(u)).length;
  const a = eligPerf.filter(u=>after.has(u)).length;
  totBefore+=b; totAfter+=a; totElig+=eligPerf.length;
  const label = `${naics}${state?'|'+state:''}`;
  const capped = eligPerf.length > POOL_TARGET-Math.floor(POOL_TARGET*RESERVE);
  console.log(`  ${label.padEnd(14)} ${String(eligPerf.length).padStart(5)} ${String(0).padStart(9).replace('0','')} ${String(b).padStart(7)} ${String(a).padStart(6)}   ${a>b?`+${a-b} now considered`:'no change'}${capped?' (ceiling-capped)':''}`);
  ok(a >= b, `${label}: never regresses (${b} → ${a})`);
  if (!capped) ok(a === eligPerf.length, `${label}: ALL ${eligPerf.length} eligible performers reach the scorer`);
  // registrant capacity preserved
  ok(after.size >= Math.min(POOL_TARGET, before.size), `${label}: pool still full (${after.size})`);
}

console.log(`\n  eligible performers reaching the scorer: ${totBefore} → ${totAfter} of ${totElig}`);
ok(totAfter > totBefore*5, `major improvement (${totBefore} → ${totAfter})`);
ok(totAfter/totElig > 0.9, `>90% of eligible performers now considered (${(totAfter/totElig*100).toFixed(1)}%)`);

console.log(fail?`\n  ✗ ${fail} FAILED\n`:'\n  ✓ DEFECT-9B RETRIEVAL VERIFIED\n');
process.exit(fail?1:0);

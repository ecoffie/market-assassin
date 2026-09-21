// Live proof for #88 (dated comps + value-history timeline). Calls the two new RPCs against the
// real DB and asserts they return grounded rows for a well-populated NAICS. Exits non-zero on any
// failure so a green run == the migration landed AND the data is real. Run AFTER the migration:
//   node scripts/verify-m88.mjs 541512
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const naics = process.argv[2] || '541512';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const out = [];
const check = (n, c, extra) => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);

// COMPS
const { data: comps, error: cErr } = await db.rpc('opp_value_comps', { p_naics: naics, p_agency: null, p_sub: null, p_limit: 10 });
if (cErr) {
  check('opp_value_comps RPC exists', false, cErr.message);
} else {
  const rows = Array.isArray(comps) ? comps : [];
  check('opp_value_comps returns rows', rows.length > 0, `n=${rows.length}`);
  check('comps carry a real $ value', rows.every((r) => Number(r.total_obligation) > 0));
  check('comps carry an incumbent name', rows.some((r) => (r.incumbent_name || '').trim().length > 0));
  check('comps are within the $1K-$500M cap', rows.every((r) => Number(r.total_obligation) >= 1000 && Number(r.total_obligation) <= 500000000));
  check('comps newest-first (dates descending, nulls last)', (() => {
    const dated = rows.map((r) => r.award_date).filter(Boolean);
    for (let i = 1; i < dated.length; i++) if (dated[i] > dated[i - 1]) return false;
    return true;
  })());
}

// TIMELINE
const { data: tl, error: tErr } = await db.rpc('opp_value_timeline', { p_naics: naics, p_agency: null, p_sub: null, p_min_per_year: 2 });
if (tErr) {
  check('opp_value_timeline RPC exists', false, tErr.message);
} else {
  const rows = Array.isArray(tl) ? tl : [];
  check('opp_value_timeline returns multiple years', rows.length >= 2, `years=${rows.length}`);
  check('every year has a positive median', rows.every((r) => Number(r.median_value) > 0));
  check('every year clears the min-per-year floor (n>=2)', rows.every((r) => Number(r.n) >= 2));
  check('years are ascending + plausible (2008..now)', (() => {
    const yrs = rows.map((r) => Number(r.yr));
    const now = new Date().getUTCFullYear();
    for (let i = 1; i < yrs.length; i++) if (yrs[i] <= yrs[i - 1]) return false;
    return yrs.every((y) => y >= 2008 && y <= now);
  })());
}

console.log(`NAICS ${naics}`);
console.log(out.join('\n'));
const failed = out.filter((l) => l.startsWith('FAIL'));
console.log(out.length === 0 ? '\nNO CHECKS' : failed.length ? `\n${failed.length}/${out.length} FAILED` : `\nALL ${out.length} PASS`);
process.exit(failed.length ? 1 : 0);

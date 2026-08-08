// Live proof for the #88 PSC-tier follow-up: opp_value_comps / _timeline / _histogram accept p_psc
// and return PSC-family-scoped rows (so they MATCH a PSC-scoped band). Run AFTER the migration:
//   node scripts/verify-m88-psc.mjs 541512 DA10
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const naics = process.argv[2] || '541512';
const psc = process.argv[3] || 'DA10';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const out = [];
const check = (n, c, extra) => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);

// COMPS with p_psc — narrows on the PSC family (first 2 chars), NOT the NAICS.
const { data: comps, error: cErr } = await db.rpc('opp_value_comps', { p_naics: naics, p_agency: null, p_sub: null, p_limit: 10, p_psc: psc });
if (cErr) check('opp_value_comps accepts p_psc', false, cErr.message);
else {
  const rows = Array.isArray(comps) ? comps : [];
  check('PSC-scoped comps return rows', rows.length > 0, `n=${rows.length}`);
  check('comps carry real $ + incumbent', rows.every((r) => Number(r.total_obligation) > 0) && rows.some((r) => (r.incumbent_name || '').trim()));
}

// TIMELINE with p_psc.
const { data: tl, error: tErr } = await db.rpc('opp_value_timeline', { p_naics: naics, p_agency: null, p_sub: null, p_min_per_year: 2, p_psc: psc });
if (tErr) check('opp_value_timeline accepts p_psc', false, tErr.message);
else {
  const rows = Array.isArray(tl) ? tl : [];
  check('PSC-scoped timeline returns years', rows.length >= 1, `years=${rows.length}`);
  check('every year positive median + n>=2', rows.every((r) => Number(r.median_value) > 0 && Number(r.n) >= 2));
}

// HISTOGRAM with p_psc.
const { data: hist, error: hErr } = await db.rpc('opp_value_histogram', { p_naics: naics, p_agency: null, p_sub: null, p_buckets: 10, p_psc: psc });
if (hErr) check('opp_value_histogram accepts p_psc', false, hErr.message);
else check('PSC-scoped histogram returns buckets', (Array.isArray(hist) ? hist.length : 0) > 0, `buckets=${Array.isArray(hist) ? hist.length : 0}`);

// PROOF THE PSC SCOPE IS REAL: a PSC-scoped comp set should differ from the NAICS-only set
// (different median/count) — the whole reason PSC-scoping matters.
const { data: naicsComps } = await db.rpc('opp_value_comps', { p_naics: naics, p_agency: null, p_sub: null, p_limit: 10 });
const pscN = (comps || []).length, naicsN = (naicsComps || []).length;
check('PSC scope differs from NAICS scope (real narrowing)', JSON.stringify((comps||[])[0]) !== JSON.stringify((naicsComps||[])[0]) || pscN !== naicsN, `psc[0]!=naics[0]`);

console.log(`NAICS ${naics} · PSC ${psc}`);
console.log(out.join('\n'));
const failed = out.filter((l) => l.startsWith('FAIL'));
console.log(out.length === 0 ? '\nNO CHECKS' : failed.length ? `\n${failed.length}/${out.length} FAILED` : `\nALL ${out.length} PASS`);
process.exit(failed.length ? 1 : 0);

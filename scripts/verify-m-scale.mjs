/**
 * verify:m-scale — prove the two branded Mindy numbers are GROUNDED, the same way verify:live
 * proves a route. Run it and eyeball PASS/FAIL; it exits non-zero on any mismatch so it can't be
 * mistaken for green.
 *
 *   npm run verify:m-scale                 # default NAICS 541512
 *   npm run verify:m-scale -- --naics 236220
 *   npm run verify:m-scale -- --json       # machine-readable
 *
 * What it checks
 *   1. M-Estimate™ (comparable-award value range): the opp_value_range RPC's low/median/high must
 *      EQUAL the real 25th/50th/75th percentiles of recompete_opportunities for that NAICS — i.e.
 *      the number on the card is exactly what the raw award data says (no drift, no stale RPC, no
 *      silent fallback). Also proves the honest-miss gate: a NAICS with < 8 comparables → the RPC
 *      yields a below-threshold n (the code returns null → "No estimate", never a fabricated band).
 *   2. M-Win (win-probability score): a FIXED profile + opp must produce an EXACT total from the
 *      documented factor points, so a scoring-weight change can't silently move the score. This is
 *      the deterministic oracle — the number is re-derived here by hand and asserted.
 *
 * Grounding, not vibes: every M-Estimate figure is a real obligated amount from USASpending
 * (cached in recompete_opportunities); every M-Win point traces to a named factor in
 * win-probability.ts. Nothing here is an LLM guess.
 *
 * ⚠️ Reads .env.local → PRODUCTION Supabase. Read-only (SELECT + RPC only).
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { calculateWinProbability } from '../src/lib/briefings/win-probability.ts';

dotenv.config({ path: '.env.local', quiet: true });

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const JSON_OUT = args.includes('--json');
const NAICS = flag('naics', '541512');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
const record = (name, pass, detail) => { results.push({ name, pass, detail }); };
const money = (n) => (n == null ? 'null' : '$' + Math.round(n).toLocaleString());

// ── 1. M-ESTIMATE: RPC vs raw-table oracle ──────────────────────────────────────────────────────
async function checkMEstimate() {
  // (a) the RPC the app actually calls
  const { data: rpcData, error: rpcErr } = await db.rpc('opp_value_range', {
    p_naics: NAICS, p_agency: null, p_sub: null,
  });
  if (rpcErr) { record(`M-Estimate RPC(${NAICS})`, false, `RPC error: ${rpcErr.message}`); return; }
  const rpc = Array.isArray(rpcData) ? rpcData[0] : rpcData;

  // (b) re-derive the oracle straight from the table with the SAME filter the RPC uses
  //     (total_obligation BETWEEN 1000 AND 500,000,000, exact 6-digit NAICS). We can't run
  //     percentile_cont from PostgREST, so pull the amounts and compute percentiles here.
  const amounts = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('recompete_opportunities')
      .select('total_obligation')
      .eq('naics_code', NAICS)
      .gte('total_obligation', 1000)
      .lte('total_obligation', 500000000)
      .range(from, from + PAGE - 1);
    if (error) { record(`M-Estimate oracle(${NAICS})`, false, `table read error: ${error.message}`); return; }
    if (!data || data.length === 0) break;
    for (const r of data) amounts.push(Number(r.total_obligation));
    if (data.length < PAGE) break;
  }
  amounts.sort((a, b) => a - b);
  const n = amounts.length;

  // linear-interpolation percentile == percentile_cont
  const pct = (p) => {
    if (!n) return null;
    const idx = p * (n - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return amounts[lo];
    return amounts[lo] + (amounts[hi] - amounts[lo]) * (idx - lo);
  };
  const oracle = { n, p25: pct(0.25), p50: pct(0.5), p75: pct(0.75) };

  // n must agree (the RPC and our read used the same filter)
  const nMatch = Number(rpc?.n) === oracle.n;
  // low/median/high are rounded ints from the RPC; compare to rounded oracle percentiles (±1 for
  // float rounding between Postgres percentile_cont and JS interpolation).
  const near = (a, b) => a != null && b != null && Math.abs(Math.round(a) - Math.round(b)) <= 1;
  const lowOk = near(rpc?.p10, oracle.p25);   // RPC col p10 actually holds the 25th (API-compat name)
  const medOk = near(rpc?.p50, oracle.p50);
  const highOk = near(rpc?.p90, oracle.p75);
  const pass = nMatch && lowOk && medOk && highOk;
  record(
    `M-Estimate ${NAICS} = raw-award percentiles`,
    pass,
    `RPC n=${rpc?.n} low/med/high ${money(rpc?.p10)}/${money(rpc?.p50)}/${money(rpc?.p90)}  ` +
    `| oracle n=${oracle.n} p25/p50/p75 ${money(oracle.p25)}/${money(oracle.p50)}/${money(oracle.p75)}` +
    (pass ? '' : `  [nMatch=${nMatch} low=${lowOk} med=${medOk} high=${highOk}]`),
  );

  // honest-miss gate: a bogus NAICS must yield < 8 comparables → the app returns null ("No estimate")
  const { data: thinData } = await db.rpc('opp_value_range', { p_naics: '999999', p_agency: null, p_sub: null });
  const thin = Array.isArray(thinData) ? thinData[0] : thinData;
  const thinN = Number(thin?.n ?? 0);
  record(
    'M-Estimate honest-miss (bogus NAICS 999999 < 8 comparables → null, not a fabricated band)',
    thinN < 8,
    `n=${thinN} (MIN_SAMPLE=8; below → getComparableAwardRange returns null)`,
  );
}

// ── 2. M-WIN: deterministic factor oracle ───────────────────────────────────────────────────────
function checkMWin() {
  // A profile with everything set so each factor hits its MAX, and an opp that matches all of them.
  // Expected max: NAICS 25 + Set-Aside 25 + Agency 15 + Size 15 + Capability 10 + Vehicle(GSA) 8 = 98.
  const profile = {
    naicsCodes: ['541512'], topNaics: [], targetAgencies: ['Department of Defense'], topAgencies: [],
    keywords: ['cybersecurity'], capabilityKeywords: ['cybersecurity'],
    certifications: ['SDVOSB'], companySize: 'small', maxContractSize: null,
    contractVehicles: ['GSA Schedule'],
  };
  const opp = {
    naicsCode: '541512', setAside: 'SDVOSB', agency: 'Department of Defense',
    amount: 500000, title: 'Cybersecurity support services', description: 'cybersecurity',
  };
  const r = calculateWinProbability(opp, profile);
  const byName = Object.fromEntries(r.factors.map((f) => [f.name, f.points]));
  const expected = { 'NAICS Match': 25, 'Set-Aside': 25, 'Agency Experience': 15, 'Contract Size': 15, 'Capability Match': 10, 'Contract Vehicle': 8 };
  const expectedTotal = Object.values(expected).reduce((a, b) => a + b, 0); // 98
  let allFactorsOk = true;
  for (const [k, v] of Object.entries(expected)) {
    if (byName[k] !== v) { allFactorsOk = false; record(`M-Win factor "${k}"`, false, `got ${byName[k]}, expected ${v}`); }
  }
  const totalOk = r.score === expectedTotal;
  record(
    `M-Win strong-match total = ${expectedTotal} (25+25+15+15+10+8)`,
    totalOk && allFactorsOk,
    `score=${r.score} tier=${r.tier} factors=${JSON.stringify(byName)}`,
  );

  // no-profile fallback must be a fixed 30 (never a crash / never a fabricated high score)
  const np = calculateWinProbability({ naicsCode: '541512' }, null);
  record('M-Win no-profile fallback is a fixed 30/low', np.score === 30 && np.tier === 'low', `score=${np.score} tier=${np.tier}`);

  // an unrelated opp must score strictly lower than the strong match (monotonic)
  const weak = calculateWinProbability({ naicsCode: '999999', setAside: 'HUBZone' }, profile);
  record('M-Win monotonic (unrelated opp scores lower than a strong match)', weak.score < r.score, `weak=${weak.score} < strong=${r.score}`);
}

async function main() {
  await checkMEstimate();
  checkMWin();

  if (JSON_OUT) { console.log(JSON.stringify(results, null, 2)); }
  else {
    console.log(`\n  M-Scale verification (NAICS ${NAICS}) — oracle: recompete_opportunities + win-probability.ts\n`);
    for (const r of results) console.log(`  ${r.pass ? '✅ PASS' : '❌ FAIL'}  ${r.name}\n            ${r.detail}`);
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n  ${results.length - failed}/${results.length} checks passed.${failed ? '  ❌ ' + failed + ' FAILED' : '  ✅ all grounded'}\n`);
  }
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((e) => { console.error('verify:m-scale crashed:', e); process.exit(1); });

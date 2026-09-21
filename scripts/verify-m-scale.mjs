/**
 * verify:m-scale — prove the three branded Mindy numbers are GROUNDED, the same way verify:live
 * proves a route. Run it and eyeball PASS/FAIL; it exits non-zero on any mismatch so it can't be
 * mistaken for green.
 *
 *   npm run verify:m-scale                 # default NAICS 541512
 *   npm run verify:m-scale -- --naics 236220
 *   npm run verify:m-scale -- --json       # machine-readable
 *
 * THIN RUNNER: all the check logic lives in the SHARED oracle lib (src/lib/qa/m-scale-oracle.ts),
 * which the MCP tool (verify_m_scale) and this CLI both call — ONE source of truth, so the CLI, the
 * predeploy gate, and the tool can never disagree. This file only does CLI concerns: arg parsing,
 * .env, reading the route source for the M-Scale source-assert, pretty-printing, and the exit code.
 *
 *   1. M-Estimate™ — the opp_value_range RPC's low/median/high must EQUAL the 25th/50th/75th
 *      percentiles re-derived from the raw recompete_opportunities table (a NAICS with no comparables
 *      is an honest miss → null "No estimate", never a fabricated band).
 *   2. M-Win — a fixed profile+opp must produce the EXACT documented factor total (98) + fallback + monotonic.
 *   3. M-Scale™ — the tier flips exactly on fixed $ bands; the mirror is source-asserted against the
 *      live companyScaleTier in the map route; grounded against the real firm pyramid.
 *
 * ⚠️ Reads .env.local → PRODUCTION Supabase. Read-only (SELECT + RPC only).
 */
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  checkMEstimate,
  checkMWin,
  checkMScaleBoundaries,
  checkMScaleSourceAssert,
  checkMScaleDistribution,
} from '../src/lib/qa/m-scale-oracle.ts';

const __dir = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: '.env.local', quiet: true });

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const JSON_OUT = args.includes('--json');
const NAICS = flag('naics', '541512');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const results = [];

  // 1. M-Estimate (DB) + 2. M-Win (pure) — straight from the shared lib.
  results.push(...(await checkMEstimate(db, NAICS)));
  results.push(...checkMWin());

  // 3. M-Scale — boundaries (pure) + source-assert (CLI reads the route file) + grounded distribution (DB).
  results.push(...checkMScaleBoundaries());
  const routeSrc = readFileSync(join(__dir, '../src/app/opportunity-map/route.ts'), 'utf8');
  results.push(checkMScaleSourceAssert(routeSrc));
  results.push(await checkMScaleDistribution(db));

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

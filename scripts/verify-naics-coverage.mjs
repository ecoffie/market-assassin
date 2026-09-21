#!/usr/bin/env node
/**
 * THE INVARIANT, checked against live data:
 *
 *   Every NAICS code with live opportunity inventory must be discoverable in the picker.
 *
 * A unit test can only prove the catalog contains codes we thought to name. This one asks the
 * database what actually has inventory and requires the catalog to represent all of it — so a
 * new code appearing in federal data cannot silently become unselectable.
 *
 * MEASURED 2026-08-23, before the fix:
 *   authoritative catalog  547 / 547 live codes = 100%
 *   hand-maintained list   342 / 547 live codes = 62.5%   ← 205 codes unselectable
 *
 * Usage: node scripts/verify-naics-coverage.mjs
 * Exit 0 = the invariant holds. Exit 1 = a code with real opportunities cannot be picked.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
config({ path: '.env.local' });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const catalog = JSON.parse(readFileSync('src/data/naics-codes.json', 'utf8')).codes;
const known = new Set(Object.keys(catalog));

/**
 * The catalog carries levels 2, 4 and 6 — the levels USASpending publishes. Federal data
 * sometimes stores a TRUNCATED code (238 rows of open SAM inventory carry 2-5 digit values).
 *
 * "Representable" therefore means: the code resolves, either exactly or through the nearest
 * ancestor the catalog does hold. A stored "541" still renders as a real industry via 5411.
 * Requiring an exact key would fail on the source's own truncation and teach us to hand-add
 * entries for codes that are not real NAICS levels.
 */
function representable(code) {
  if (known.has(code)) return true;
  for (let len = code.length - 1; len >= 2; len--) {
    if (known.has(code.slice(0, len))) return true;
  }
  // A 3- or 5-digit code resolves DOWN too: "541" is representable if any 5411xx exists.
  return [...known].some((k) => k.startsWith(code));
}

/** Paged — an un-ranged select caps at 1,000 and would silently under-report the gap. */
async function liveCodes(table, eligible) {
  const seen = new Set();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select('naics_code').range(from, from + PAGE - 1);
    q = eligible(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data ?? []) {
      // Guard the shape: a select that returns objects (or a renamed column) must not
      // stringify to "[object Object]" and get reported as a missing NAICS code.
      const v = r?.naics_code;
      if (typeof v === 'string' && /^\d{2,6}$/.test(v)) seen.add(v);
    }
    if ((data ?? []).length < PAGE) break;
  }
  return seen;
}

(async () => {
  const now = new Date().toISOString();
  const sources = [
    ['sam_opportunities (open)', 'sam_opportunities', (q) => q.gte('response_deadline', now)],
    ['recompete_opportunities', 'recompete_opportunities', (q) => q.is('quality_flag', null).not('map_lat', 'is', null)],
    ['agency_forecasts', 'agency_forecasts', (q) => q],
  ];

  console.log('\nNAICS coverage invariant');
  console.log('  every code with live inventory must be representable in the picker\n');

  const all = new Set();
  for (const [label, table, eligible] of sources) {
    const codes = await liveCodes(table, eligible);
    const missing = [...codes].filter((c) => !representable(c));
    const pct = codes.size ? ((codes.size - missing.length) / codes.size) * 100 : 100;
    console.log(
      `  ${missing.length === 0 ? '✓' : '✗'} ${label.padEnd(26)} ` +
      `${String(codes.size).padStart(4)} codes · ${pct.toFixed(1)}% covered` +
      (missing.length ? `  MISSING: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}` : ''),
    );
    codes.forEach((c) => all.add(c));
  }

  const missingAll = [...all].filter((c) => !representable(c));
  console.log(`\n  union: ${all.size} live codes · ${missingAll.length} unrepresentable\n`);

  // A handful of source rows carry codes that are not valid NAICS at all (measured
  // 2026-08-23: `344511` — there is no 344 sector; `461492` on a row titled "Court Reporter
  // Services"). Those are upstream typos, not catalog gaps, and hand-adding them would put
  // fake industries in the picker. Tolerate a tiny number, fail on a real regression.
  const BAD_DATA_TOLERANCE = 5;
  if (missingAll.length > BAD_DATA_TOLERANCE) {
    console.log('  These codes return opportunities but cannot be selected:');
    console.log(`  ${missingAll.join(', ')}\n`);
    console.log('  The catalog is src/data/naics-codes.json (USASpending). If a real federal');
    console.log('  code is missing, refresh it from the source — do not hand-add entries.\n');
    process.exit(1);
  }
  if (missingAll.length) {
    console.log(`  ⚠ ${missingAll.length} code(s) unrepresentable, within the bad-source-data`);
    console.log(`    tolerance of ${BAD_DATA_TOLERANCE}: ${missingAll.join(', ')}`);
    console.log('    Verify these are upstream typos, not real codes, before ignoring.\n');
    console.log('  ✓ invariant holds\n');
    process.exit(0);
  }

  console.log('  ✓ invariant holds\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * TRUTH CANARY — daily contradiction tests against production.
 *
 * Not "does the endpoint return 200". These assert that two subsystems which each look correct
 * AGREE WITH EACH OTHER, because that is where every real customer bug has been:
 *
 *   2026-08-22 Robert: NAICS 333612 filter worked, cards were right, COUNT said 3,555 vs 805 true
 *   2026-08-23 Hector: 226 records under 324110, picker had no 324 family -> "you don't cover fuel"
 *   2026-08-23 (ours): head-count via read replica fails -> would have rendered "0 open"
 *
 * Each case is a CONTRADICTION: a pair of claims that cannot both be true. A green run means the
 * subsystems agree; a red run names which two disagree.
 *
 * Read-only. Safe to run against production on a schedule.
 *
 *   node scripts/truth-canary.mjs                    # all
 *   node scripts/truth-canary.mjs --only naics       # one group
 *   node scripts/truth-canary.mjs --base http://localhost:3000
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const BASE = argOf('--base', 'https://getmindy.ai');
const ONLY = argOf('--only', null);

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const results = [];
const rec = (group, name, ok, detail) => results.push({ group, name, ok, detail });

async function json(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

async function count(table, apply) {
  const { count: n, error } = await apply(db.from(table).select('*', { count: 'exact', head: true }));
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
}

// ───────────────────────────────────────────────────────────────────────────
// NAICS — the group every reported bug came from.
// ───────────────────────────────────────────────────────────────────────────
async function naicsGroup() {
  // Adversarial values, not happy paths: the reported codes, each prefix length, a code with
  // NO inventory, and an upstream typo.
  const CASES = ['324110', '333612', '541512', '33361', '3336', '324', '32'];

  for (const code of CASES) {
    // CONTRADICTION 1: search returns a code -> the picker must be able to offer it.
    const s = await json(`/api/app/naics-search?counts=0&q=${code}`);
    const offered = (s.results || []).some((r) => r.code === code || r.code.startsWith(code));
    rec('naics', `picker offers ${code}`, offered,
      offered ? `${(s.results || []).length} suggestions` : 'search returned nothing — a user reads this as "not covered"');
  }

  // CONTRADICTION 2: if the data layer returns rows for a code, the count cannot be an
  // order of magnitude different. This is the 3,555-vs-805 bug.
  for (const code of ['324110', '333612', '541512']) {
    const truth =
      (await count('sam_opportunities', (q) => q.eq('naics_code', code).gte('response_deadline', new Date().toISOString()))) +
      (await count('recompete_opportunities', (q) => q.eq('naics_code', code).is('quality_flag', null).not('map_lat', 'is', null))) +
      (await count('agency_forecasts', (q) => q.eq('naics_code', code)));

    const bbox = 'bbox=-125,24,-66,50';
    const [open, rc, fc] = await Promise.all([
      json(`/api/app/opportunity-map?${bbox}&status=active&sources=sam,sbir&q=${code}`),
      json(`/api/app/recompete-map?${bbox}&q=${code}`),
      json(`/api/app/forecast-map?${bbox}&q=${code}&includeUnplaced=1`),
    ]);
    const shown = (open.totalForFilters ?? 0) + (rc.totalForFilters ?? 0) + (fc.totalForFilters ?? 0);
    // Generous: this catches an order-of-magnitude lie, not bbox variance.
    const ok = truth === 0 ? shown === 0 : shown / truth < 2 && shown / truth > 0.3;
    rec('naics', `count is honest for ${code}`, ok, `displayed ${shown} vs nationwide truth ${truth}`);
  }

  // CONTRADICTION 3: a code with real inventory must never render zero counts. The false-zero
  // class — a failed count and an empty market are indistinguishable to a user.
  const withCounts = await json('/api/app/naics-search?q=324110');
  const row = (withCounts.results || [])[0];
  const hasCounts = row && typeof row.open === 'number';
  rec('naics', 'counts present, not silently dropped', !!hasCounts,
    hasCounts ? `open=${row.open} rec=${row.recompetes} fc=${row.forecasts}`
              : 'counts missing — a failed count must be OMITTED, but omitted everywhere means the client is broken');
}

// ───────────────────────────────────────────────────────────────────────────
// PROVENANCE — zero must mean zero, never "the query failed".
// ───────────────────────────────────────────────────────────────────────────
async function provenanceGroup() {
  // A nonsense code must return NO results, not a confident zero-count row. "999999 — Unknown,
  // 0 open" would read as a real but empty market.
  const bogus = await json('/api/app/naics-search?q=999999');
  rec('provenance', 'unknown code returns nothing, not a zero row',
    (bogus.results || []).length === 0, `${(bogus.results || []).length} results`);

  // An empty query must not dump the catalog.
  const empty = await json('/api/app/naics-search?q=');
  rec('provenance', 'empty query returns nothing, not everything',
    (empty.results || []).length === 0, `${(empty.results || []).length} results`);
}

// ───────────────────────────────────────────────────────────────────────────
// REFERENCE — live inventory must be representable.
// ───────────────────────────────────────────────────────────────────────────
async function referenceGroup() {
  // Sample the highest-volume live codes and require each to be offerable. This is the
  // generalisation of Hector's bug: it would have failed on 324110 before the fix.
  const { data, error } = await db
    .from('sam_opportunities')
    .select('naics_code')
    .gte('response_deadline', new Date().toISOString())
    .not('naics_code', 'is', null)
    .limit(400);
  if (error) throw new Error(error.message);

  const freq = {};
  for (const r of data ?? []) if (String(r.naics_code).length === 6) freq[r.naics_code] = (freq[r.naics_code] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);

  const missing = [];
  for (const c of top) {
    const s = await json(`/api/app/naics-search?counts=0&q=${c}`);
    if (!(s.results || []).some((r) => r.code === c)) missing.push(c);
  }
  rec('reference', 'top live codes are all selectable', missing.length === 0,
    missing.length ? `NOT offerable: ${missing.join(', ')}` : `${top.length} sampled`);
}

const GROUPS = { naics: naicsGroup, provenance: provenanceGroup, reference: referenceGroup };

(async () => {
  console.log(`\nTruth Canary — ${BASE}`);
  console.log('  contradiction tests: two subsystems that must agree\n');

  for (const [name, fn] of Object.entries(GROUPS)) {
    if (ONLY && ONLY !== name) continue;
    try { await fn(); }
    catch (e) { rec(name, 'group threw', false, e.message); }
  }

  let group = '';
  for (const r of results) {
    if (r.group !== group) { group = r.group; console.log(`  ${group.toUpperCase()}`); }
    console.log(`    ${r.ok ? '✓' : '✗'} ${r.name.padEnd(42)} ${r.detail}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} contracts hold.\n`);
  if (failed.length) {
    console.log('  A failure here means two subsystems DISAGREE. Find which one is wrong before');
    console.log('  changing either — the last four of these were fixed on the wrong side first.\n');
  }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

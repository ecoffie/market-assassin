#!/usr/bin/env node
/**
 * SAM KEY INVENTORY — test every configured key individually against a trivial known-entity
 * lookup, so a rotation replaces only what is actually dead or exhausted.
 *
 * WHY THIS EXISTS (DEFECT-7, 2026-08-24): the failure surfaced to a user as "this company is
 * not registered in SAM". The real cause was one DEAD key (401 API_KEY_INVALID) plus two
 * EXHAUSTED keys (429) — and nothing reported that per key, so the outage read as a fact about
 * the world. Worse, the app's own error claimed "all API keys are rate-limited" while the
 * entity counter showed 996/1000 remaining: the message described a quota problem that was not
 * happening, because a rejected key had been miscategorised as a throttled one.
 *
 * Run this BEFORE rotating (to see what is actually broken) and AFTER (to prove the fix).
 *
 *   node scripts/sam-key-inventory.mjs
 *   node scripts/sam-key-inventory.mjs --json
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') });

/** A trivial, always-present lookup: cheap, unambiguous, and 0 rows means something is wrong. */
const PROBE = 'Chugach';
const JSON_OUT = process.argv.includes('--json');

const KEY_VARS = Object.keys(process.env)
  .filter((k) => /^SAM_(API_KEY|ENTITY_API_KEY|CONTRACT_AWARDS_API_KEY)(_\d+|_BACKUP)?$/.test(k))
  .sort();

async function probe(key) {
  const u = new URL('https://api.sam.gov/entity-information/v3/entities');
  u.searchParams.set('api_key', key);
  u.searchParams.set('legalBusinessName', PROBE);
  try {
    const r = await fetch(u, { headers: { Accept: 'application/json' } });
    const body = await r.text();
    if (r.status === 200) {
      let n = 0;
      try { n = JSON.parse(body)?.totalRecords ?? 0; } catch { /* non-json 200 */ }
      return { status: 200, verdict: n > 0 ? 'HEALTHY' : 'HEALTHY (0 rows — check the probe)', rows: n };
    }
    if (/API_KEY_INVALID/i.test(body)) return { status: r.status, verdict: 'DEAD — replace', rows: 0 };
    if (r.status === 429) return { status: 429, verdict: 'EXHAUSTED — resets daily', rows: 0 };
    return { status: r.status, verdict: `other (${body.slice(0, 60)})`, rows: 0 };
  } catch (err) {
    return { status: 0, verdict: `unreachable: ${String(err).slice(0, 50)}`, rows: 0 };
  }
}

const seen = new Map();
const results = [];
for (const name of KEY_VARS) {
  const key = process.env[name];
  if (!key) { results.push({ name, key: null, verdict: 'NOT SET' }); continue; }
  // Distinct VALUES matter, not distinct var names — a duplicate adds no fail-over capacity,
  // which is exactly why "four keys" was really two usable ones.
  if (seen.has(key)) { results.push({ name, tail: key.slice(-6), verdict: `DUPLICATE of ${seen.get(key)}` }); continue; }
  seen.set(key, name);
  const r = await probe(key);
  results.push({ name, tail: key.slice(-6), ...r });
}

if (JSON_OUT) { console.log(JSON.stringify({ probe: PROBE, results }, null, 2)); process.exit(0); }

console.log(`\n  SAM key inventory — probe: legalBusinessName="${PROBE}"\n`);
for (const r of results) {
  console.log(`  ${String(r.name).padEnd(28)} ${r.tail ? '…' + r.tail : '(unset)'}  ${r.status ? 'HTTP ' + String(r.status).padEnd(4) : '     '} ${r.verdict}`);
}
const distinct = results.filter((r) => r.status !== undefined && !String(r.verdict).startsWith('DUPLICATE'));
const healthy = distinct.filter((r) => String(r.verdict).startsWith('HEALTHY'));
console.log(`\n  ${healthy.length} of ${distinct.length} distinct key(s) healthy.`);
if (!healthy.length) {
  console.log('  ⚠️ NO usable key. Live SAM lookups will fall back to the local registry');
  console.log('     (degraded:true, source:local_registry) — correct, but no freshness.');
}
process.exit(0);

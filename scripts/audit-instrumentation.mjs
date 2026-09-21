#!/usr/bin/env node
/**
 * INSTRUMENTATION INTEGRITY — is the registry still true?
 *
 * The Product Surface Registry declares what Mindy SHOULD be able to observe. This script
 * checks that against `user_engagement` and reports the three states that must never collapse:
 *
 *   measured + used     instrumented, real usage observed
 *   measured, 0 users   instrumented correctly, genuinely unused — a PRODUCT fact
 *   NOT MEASURED        no valid emitter — a MEASUREMENT fact
 *
 * WHY: `opportunity_map` (7,546 views / 611 users) was invisible to feature analytics for its
 * entire life because one emitter said `opportunity_map` and the classifier looked for
 * `metadata.path`. Nothing errored. A registry only helps if something checks it.
 *
 * ⚠️ DRIFT IS THE POINT. A surface the registry calls `measured_used` that now emits nothing
 * is a REGRESSION (someone removed an emitter); a `not_measured` surface that started emitting
 * is progress the registry has not caught up with. Both are reported.
 *
 *   node scripts/audit-instrumentation.mjs [--json]
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '').trim();
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { PRODUCT_SURFACES, instrumentationCoverage } = await import('../src/lib/integrity/surface-registry.ts');

async function observe(id) {
  const [a, b, c] = await Promise.all([
    sb.from('user_engagement').select('*', { count: 'exact', head: true }).eq('metadata->>surface', id),
    sb.from('user_engagement').select('*', { count: 'exact', head: true }).eq('metadata->>panel', id),
    sb.from('user_engagement').select('*', { count: 'exact', head: true }).eq('event_source', id),
  ]);
  // INT-002 inside the instrumentation auditor itself: `count ?? 0` here would report
  // "0 events" for a table we could not READ, which is exactly the not-measured/unused
  // collapse this script exists to prevent. Surface it instead.
  const err = a.error || b.error || c.error;
  // ⚠️ `err.message` can be an EMPTY STRING (the same empty-error shape that hid a 401 during
  // this audit), which would make `unreadable` falsy and let a -1 sentinel render as a real
  // count. Always return a non-empty reason.
  if (err) return { events: -1, users: -1, unreadable: err.message || 'query failed with an empty error' };
  if (a.count === null && b.count === null && c.count === null) {
    return { events: -1, users: -1, unreadable: 'user_engagement returned null counts with no error' };
  }
  const events = (a.count || 0) + (b.count || 0) + (c.count || 0);
  let users = 0;
  if (events > 0) {
    const { data } = await sb.from('user_engagement').select('user_email')
      .or(`metadata->>surface.eq.${id},metadata->>panel.eq.${id},event_source.eq.${id}`).limit(3000);
    users = new Set((data || []).map((r) => r.user_email).filter(Boolean)).size;
  }
  return { events, users };
}

const rows = [];
for (const s of PRODUCT_SURFACES) {
  const o = await observe(s.id);
  if (o.unreadable) {
    console.error(`\n  ✗ cannot audit ${s.id}: ${o.unreadable}`);
    console.error('  Refusing to report coverage from an unreadable source (INT-002/INT-003).');
    process.exit(2);
  }
  const actual = o.events === 0 ? 'not_measured' : (o.users === 0 ? 'measured_unused' : 'measured_used');
  rows.push({ id: s.id, display: s.display, declared: s.state, actual, ...o, drift: actual !== s.state });
}

const cov = instrumentationCoverage();
const drift = rows.filter((r) => r.drift);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ coverage: cov, surfaces: rows, drift }, null, 2));
  process.exit(drift.length ? 1 : 0);
}

console.log('\n  INSTRUMENTATION COVERAGE');
console.log(`  ${cov.caveat}\n`);
console.log('  surface'.padEnd(28), 'events'.padStart(8), 'users'.padStart(7), '  state');
for (const r of rows.sort((x, y) => y.events - x.events)) {
  const label = r.actual === 'not_measured' ? 'NOT MEASURED'
    : r.actual === 'measured_unused' ? 'measured, 0 users' : 'measured + used';
  console.log(`  ${r.display.slice(0, 26).padEnd(26)} ${String(r.events).padStart(8)} ${String(r.users).padStart(7)}   ${label}${r.drift ? '  ⚠️ DRIFT vs registry' : ''}`);
}
if (drift.length) {
  console.error(`\n  ✗ ${drift.length} surface(s) DRIFTED from the registry:`);
  for (const d of drift) console.error(`      ${d.id}: declared ${d.declared}, observed ${d.actual}`);
  console.error('  Update the registry (or restore the emitter) — a stale registry is the bug it exists to prevent.');
  process.exit(1);
}
console.log('\n  ✓ registry matches observed reality');

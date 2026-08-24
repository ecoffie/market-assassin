#!/usr/bin/env node
/**
 * Record the EXACT production cutover moment as `homepage_today_cutover`.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: this is the single change that alters what Mindy IS —
 *
 *   before:  getmindy.ai → marketing site → eventually the product
 *   after:   getmindy.ai → live procurement intelligence → Map
 *
 * Every acquisition, Map-arrival, signup and retention number from here on has to be readable
 * as before/after. Without a durable marker that segmentation gets reconstructed later from
 * memory or a git log — which is exactly the "we can re-run a query but we cannot re-run
 * yesterday" failure the recompete moat already taught us. A marker written at the moment of
 * the flip costs nothing; inferring it afterwards is guesswork.
 *
 * Stamped when the APEX IS VERIFIED SERVING Today's Intel — not at commit time, not at merge
 * time. The deploy is the event.
 *
 *   node scripts/record-homepage-cutover.mjs --check   # read the marker back
 *   node scripts/record-homepage-cutover.mjs --go      # write it (idempotent)
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dir, '..', '.env.local') });

const METRIC_KEY = 'homepage_today_cutover';
const GO = process.argv.includes('--go');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function readMarker() {
  const { data, error } = await supabase
    .from('daily_metric_snapshots')
    .select('snapshot_date, metric_key, value, meta, created_at')
    .eq('metric_key', METRIC_KEY)
    .limit(5);
  if (error) throw new Error(`marker read failed: ${error.message}`);
  return data || [];
}

const existing = await readMarker();
if (existing.length) {
  console.log(`  marker already recorded (${existing.length} row(s)):`);
  for (const r of existing) console.log(`    ${r.snapshot_date}  ${r.metric_key} = ${r.value}`);
  console.log('    meta:', JSON.stringify(existing[0].meta));
  if (!GO) process.exit(0);
  console.log('  (idempotent — re-running will not duplicate; upsert keyed on date+metric)');
}

if (!GO) {
  console.log(`  DRY — would record ${METRIC_KEY}. Re-run with --go once the apex is verified.`);
  process.exit(0);
}

// Verify the apex ACTUALLY serves Today's Intel before stamping. A marker that claims a
// cutover which did not happen is worse than no marker at all.
const res = await fetch('https://getmindy.ai/', { redirect: 'follow' });
const html = await res.text();
const servesToday = /Today's Intel|what changed in federal contracting today/i.test(html);
const canonicalApex = /<link rel="canonical" href="https:\/\/getmindy\.ai"\s*\/?>/.test(html);

if (!servesToday) {
  console.error('  ✗ REFUSING TO STAMP: the apex is not serving Today\'s Intel yet.');
  console.error('    A marker for a cutover that did not happen would corrupt every');
  console.error('    before/after comparison built on it.');
  process.exit(1);
}

const now = new Date();
const { error } = await supabase.from('daily_metric_snapshots').upsert(
  {
    snapshot_date: now.toISOString().slice(0, 10),
    metric_key: METRIC_KEY,
    value: now.toISOString(),
    meta: {
      event: 'homepage cutover: getmindy.ai/ now serves Today\'s Intel',
      before: 'getmindy.ai → /mindy-landing (marketing)',
      after: 'getmindy.ai → /today (live procurement intelligence → Map)',
      canonical_is_apex: canonicalApex,
      rollback: "next.config.ts '/' destination → '/mindy-landing' + MAPS_HOME_PATH → '/today'",
      verified_at: now.toISOString(),
    },
  },
  { onConflict: 'snapshot_date,metric_key' },
);
if (error) throw new Error(`marker write failed: ${error.message}`);

console.log(`  ✓ recorded ${METRIC_KEY} = ${now.toISOString()}`);
console.log(`    canonical is apex: ${canonicalApex}`);
console.log('    Segment acquisition / Map-arrival / signup / retention on this timestamp.');

#!/usr/bin/env node
/**
 * DRY RUN — which NULL-provenance starter-code profiles can be PROVEN to be untouched defaults?
 *
 * Read-only. Writes nothing to the database. Prints aggregates only; per-user rows and the
 * PROPOSED (never executed) SQL go to --out <dir>, which must be a private path (never commit it).
 *
 * Candidate: user_notification_settings row with naics_source IS NULL whose codes are exactly the
 * 5-code starter set. Labelling one `system_default` is a claim about history, so it is proposed
 * ONLY when every check below holds; anything else is CANNOT_PROVE and stays NULL.
 *
 *   P1 codes are exactly ['541512','541611','541330','541990','561210'] in that order — the array
 *      ensureMindyFreeProfile inserted (email signup, removed by #1852).
 *   P2 treatment_type = 'free' — the value that same insert wrote.
 *   P3 profile_updated_at IS NULL and naics_profile_hash IS NULL — /api/alerts/preferences sets
 *      both whenever it writes codes, so a user who saved codes there would carry them.
 *   P4 no user_engagement event of type 'profile_update' for the email, ever.
 *
 * Usage: node scripts/starter-profile-provenance-dry-run.mjs [--out /private/dir]
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('✗ missing Supabase env'); process.exit(2); }
const sb = createClient(url, key);
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : null;

const STARTER = ['541512', '541611', '541330', '541990', '561210'];
const STARTER_KEY = [...STARTER].sort().join(',');
const setKey = (a) => [...new Set((a || []).map(String))].sort().join(',');

const rows = [];
for (let last = null; ;) {
  let q = sb.from('user_notification_settings')
    .select('id,user_email,naics_codes,naics_source,treatment_type,profile_updated_at,naics_profile_hash,created_at,alerts_enabled') // truncation-ok: keyset-paged by id below until a short page
    .is('naics_source', null).order('id').limit(1000);
  if (last) q = q.gt('id', last);
  const { data, error } = await q;
  if (error) throw new Error(`settings read failed: ${error.message}`);
  rows.push(...data);
  if (data.length < 1000) break;
  last = data[data.length - 1].id;
}
const candidates = rows.filter((r) => setKey(r.naics_codes) === STARTER_KEY);

const { count: alreadyDefault, error: cErr } = await sb.from('user_notification_settings')
  .select('id', { count: 'exact', head: true }).eq('naics_source', 'system_default');
if (cErr) throw new Error(`count failed: ${cErr.message}`);

const results = [];
for (const r of candidates) {
  const email = (r.user_email || '').toLowerCase().trim();
  const { count: profileEvents, error } = await sb.from('user_engagement')
    .select('id', { count: 'exact', head: true }).eq('user_email', email).eq('event_type', 'profile_update');
  if (error) throw new Error(`engagement count failed: ${error.message}`);
  if (profileEvents == null) throw new Error('engagement count unknown — refusing to call it zero');
  const fails = [];
  if (JSON.stringify((r.naics_codes || []).map(String)) !== JSON.stringify(STARTER)) fails.push('P1_order_differs_from_signup_insert');
  if (r.treatment_type !== 'free') fails.push(`P2_treatment_type=${r.treatment_type ?? 'null'}`);
  if (r.profile_updated_at) fails.push('P3_profile_updated_at_set');
  if (r.naics_profile_hash) fails.push('P3_naics_profile_hash_set');
  if (profileEvents > 0) fails.push(`P4_profile_update_events=${profileEvents}`);
  results.push({
    email, verdict: fails.length ? 'CANNOT_PROVE' : 'PROVEN_DEFAULT', reasons: fails.join('|'),
    created_at: r.created_at, alerts_enabled: r.alerts_enabled,
    proposed: fails.length ? 'leave naics_source NULL' : "set naics_source='system_default' (codes unchanged)",
  });
}

const proven = results.filter((r) => r.verdict === 'PROVEN_DEFAULT');
const tally = {};
for (const r of results.filter((x) => x.verdict === 'CANNOT_PROVE')) for (const reason of r.reasons.split('|')) {
  const k = reason.replace(/=.*/, ''); tally[k] = (tally[k] || 0) + 1;
}
console.log(`already labelled system_default: ${alreadyDefault}`);
console.log(`NULL-provenance rows holding exactly the starter set: ${candidates.length}`);
console.log(`  PROVEN_DEFAULT (all of P1–P4): ${proven.length}`);
console.log(`  CANNOT_PROVE: ${results.length - proven.length}  reasons: ${JSON.stringify(tally)}`);
console.log('Proposed SQL (NOT executed; held for review) is written only to --out.');

if (OUT) {
  fs.mkdirSync(OUT, { recursive: true });
  const cols = ['email', 'verdict', 'reasons', 'created_at', 'alerts_enabled', 'proposed'];
  const esc = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  fs.writeFileSync(path.join(OUT, 'starter-provenance-dry-run.csv'), [cols.join(','), ...results.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
  const list = proven.map((r) => `'${r.email.replace(/'/g, "''")}'`).join(',\n  ');
  fs.writeFileSync(path.join(OUT, 'starter-provenance-PROPOSED.sql'), `-- PROPOSED ONLY. Not executed. Held for Eric's review (2026-10-06).
-- Labels provenance; never changes codes. Re-checks every proof condition at write time.
UPDATE user_notification_settings
SET naics_source = 'system_default'
WHERE naics_source IS NULL
  AND naics_codes = ARRAY['541512','541611','541330','541990','561210']::text[]
  AND treatment_type = 'free'
  AND profile_updated_at IS NULL
  AND naics_profile_hash IS NULL
  AND user_email IN (
  ${list || "''"}
);
-- Expected row count: ${proven.length}
`);
  console.log(`per-user rows + proposed SQL → ${OUT} (private; do not commit)`);
}

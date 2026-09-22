#!/usr/bin/env node
/**
 * Gate: no credential may be stored in a `cron_jobs.route` value.
 *
 * `snapshot-multisite-nih` stored the live admin password as `?password=...`
 * inside its route. A credential in a database column is readable by anything
 * that can SELECT the table, is echoed into dispatcher logs on every run, and
 * shows up in any routine audit of the schedule.
 *
 * It was there because the route accepted only `x-vercel-cron-secret` or
 * `?password=`, while the dispatcher sends `Authorization: Bearer $CRON_SECRET`.
 * The route now accepts the dispatcher's mechanism, so nothing needs inlining.
 *
 * ⚠️ This script NEVER prints a matched value — only the job name and the
 * offending PARAMETER NAME. Printing the finding must not re-leak the secret.
 *
 * Exits 0 when clean, 1 when a credential-bearing route exists, and 0 with a
 * SKIPPED notice when no database is configured (so it cannot block a
 * credential-less environment such as CI without secrets).
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

dotenv.config({ path: '.env.local', quiet: true });

/** Query params that must never appear in a stored route. */
const CREDENTIAL_PARAMS = [
  'password', 'passwd', 'pwd', 'secret', 'token', 'apikey', 'api_key',
  'auth', 'key', 'access_token', 'cron_secret',
];
const PARAM_RE = new RegExp(`[?&](${CREDENTIAL_PARAMS.join('|')})=`, 'i');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log('[cron-route-credentials] SKIPPED — no database configured.');
  process.exit(0);
}

const sb = createClient(url, key);
const { data, error } = await sb.from('cron_jobs').select('job_name, route').limit(500);
if (error) {
  // A failed check is UNKNOWN, never "clean". Surface it and fail.
  console.error(`[cron-route-credentials] query failed: ${error.message}`);
  process.exit(1);
}

// Known cross-application routes that cannot be fixed from this repo. Listed by
// JOB NAME only — the baseline never stores a value either.
let known = [];
try {
  known = JSON.parse(readFileSync('tests/fixtures/cron-route-credential-baseline.json', 'utf8')).known ?? [];
} catch { known = []; }

const findings = [];
for (const row of data ?? []) {
  const m = PARAM_RE.exec(row.route ?? '');
  // Report the job and the PARAM NAME only — never the value.
  if (m && !known.includes(row.job_name)) {
    findings.push(`${row.job_name} (param: ${m[1].toLowerCase()})`);
  }
}

if (findings.length > 0) {
  console.error('[cron-route-credentials] credential(s) stored in cron_jobs.route:');
  for (const f of findings) console.error(`  ${f}`);
  console.error('\nRoutes must authenticate via the dispatcher\'s Authorization: Bearer');
  console.error('$CRON_SECRET header, not a secret embedded in the stored URL.');
  console.error('Strip the parameter AND rotate the exposed credential.');
  process.exit(1);
}
console.log(
  `[cron-route-credentials] OK — ${(data ?? []).length} route(s) checked, ` +
  `${known.length} known cross-app exception(s) (see the baseline; fix in govcon-funnels).`,
);

/**
 * READ-ONLY audit: which paid KV grants have NO matching Supabase entitlement?
 *
 * Why: KV is the primary access gate. During a KV outage / Upstash quota
 * exhaustion, the resilient access getters serve a per-instance last-known value
 * (24h) and otherwise deny. A user whose grant lives ONLY in KV drops to Free on a
 * cold instance. Measured 2026-11-10: 47 of 130 `briefings:*` holders had no
 * `user_profiles.access_briefings`. This script LISTS them so an operator can
 * decide on a one-time reconcile. It never writes anything.
 *
 *   node scripts/audit-kv-only-entitlements.mjs            # summary + lists
 *   node scripts/audit-kv-only-entitlements.mjs --json     # machine-readable
 *
 * Guarantees:
 *   - KV: uses KV_REST_API_READ_ONLY_TOKEN only (refuses to run without it) and
 *     only issues SCAN / MGET.
 *   - DB: one `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`, SELECT only.
 *   - There is no --go flag. There is no write path. Keep it that way.
 *   - A missing column is reported as UNKNOWN, never as "not entitled".
 */
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: '.env.local' });

const JSON_OUT = process.argv.includes('--json');

// KV prefix → user_profiles column(s) that represent the same entitlement.
const PREFIXES = {
  briefings: { columns: ['access_briefings'], expiresColumn: 'briefings_expires_at' },
  ma: { columns: ['ma_tier'], tier: true },
  dbaccess: { columns: ['access_contractor_db'] },
  ospro: { columns: ['access_hunter_pro'] },
  contentgen: { columns: ['content_generator_access'] },
  recompete: { columns: ['access_recompete'] },
};

const KV_URL = process.env.KV_REST_API_URL;
const KV_RO_TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN;
if (!KV_URL || !KV_RO_TOKEN) {
  console.error('Missing KV_REST_API_URL or KV_REST_API_READ_ONLY_TOKEN — refusing to run (read-only token required).');
  process.exit(1);
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL.');
  process.exit(1);
}

async function kvCmd(args) {
  const cmd = String(args[0]).toUpperCase();
  if (cmd !== 'SCAN' && cmd !== 'MGET') throw new Error(`refusing non-read KV command ${cmd}`);
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_RO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`KV ${cmd} failed: HTTP ${res.status} ${body.error ?? ''}`);
  return body.result;
}

async function scanPrefix(prefix) {
  const keys = new Set();
  let cursor = '0';
  let rounds = 0;
  do {
    const [next, batch] = await kvCmd(['SCAN', cursor, 'MATCH', `${prefix}:*`, 'COUNT', '5000']);
    for (const k of batch) keys.add(k);
    cursor = String(next);
    if (++rounds > 1000) throw new Error(`SCAN ${prefix} did not converge`);
  } while (cursor !== '0');
  return [...keys];
}

/** A KV value counts as a grant unless it is empty or an explicit false. */
function kvGrants(value) {
  if (value === null || value === undefined) return false;
  const s = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (s === '' || s === 'false' || s === '0' || s === 'null') return false;
  return true;
}

async function kvGrantHolders(prefix) {
  const keys = await scanPrefix(prefix);
  const holders = [];
  let nonGrantValues = 0;
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const values = await kvCmd(['MGET', ...chunk]);
    chunk.forEach((k, j) => {
      if (kvGrants(values[j])) holders.push(k.slice(prefix.length + 1).toLowerCase());
      else nonGrantValues++;
    });
  }
  return { keys: keys.length, holders: [...new Set(holders)], nonGrantValues };
}

function supabaseGrants(row, spec, existing) {
  const col = spec.columns[0];
  if (!existing.has(col)) return null; // unknown, never false
  const v = row?.[col];
  let granted = spec.tier ? !!v && String(v).toLowerCase() !== 'free' : v === true;
  if (granted && spec.expiresColumn && existing.has(spec.expiresColumn) && row?.[spec.expiresColumn]) {
    granted = new Date(row[spec.expiresColumn]).getTime() > Date.now();
  }
  return granted;
}

async function main() {
  const kvByPrefix = {};
  for (const prefix of Object.keys(PREFIXES)) kvByPrefix[prefix] = await kvGrantHolders(prefix);

  const allEmails = [...new Set(Object.values(kvByPrefix).flatMap((r) => r.holders))];
  const wanted = [...new Set(Object.values(PREFIXES).flatMap((s) => [...s.columns, s.expiresColumn].filter(Boolean)))];

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let existing;
  const rowsByEmail = new Map();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const colRes = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = ANY($1)`,
      [wanted],
    );
    existing = new Set(colRes.rows.map((r) => r.column_name));
    const cols = [...existing].map((c) => `"${c}"`).join(', ');
    if (allEmails.length) {
      const res = await client.query(
        `SELECT lower(email) AS email${cols ? ', ' + cols : ''} FROM public.user_profiles WHERE lower(email) = ANY($1)`,
        [allEmails],
      );
      for (const r of res.rows) rowsByEmail.set(r.email, r);
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }

  const report = { generatedAt: new Date().toISOString(), missingColumns: wanted.filter((c) => !existing.has(c)), prefixes: {} };
  for (const [prefix, spec] of Object.entries(PREFIXES)) {
    const kvr = kvByPrefix[prefix];
    const kvOnly = [];
    const noProfileRow = [];
    let unknown = 0;
    for (const email of kvr.holders) {
      const row = rowsByEmail.get(email);
      if (!row) {
        noProfileRow.push(email);
        continue;
      }
      const g = supabaseGrants(row, spec, existing);
      if (g === null) unknown++;
      else if (!g) kvOnly.push(email);
    }
    report.prefixes[prefix] = {
      kvKeys: kvr.keys,
      kvGrantHolders: kvr.holders.length,
      kvNonGrantValues: kvr.nonGrantValues,
      supabaseColumn: spec.columns[0],
      kvOnlyFlagFalse: kvOnly.sort(),
      kvOnlyNoProfileRow: noProfileRow.sort(),
      unknownColumnMissing: unknown,
    };
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`KV-only paid entitlements (READ-ONLY audit, ${report.generatedAt})`);
  if (report.missingColumns.length) console.log(`⚠ user_profiles columns missing (reported as UNKNOWN): ${report.missingColumns.join(', ')}`);
  for (const [prefix, r] of Object.entries(report.prefixes)) {
    const total = r.kvOnlyFlagFalse.length + r.kvOnlyNoProfileRow.length;
    console.log(
      `\n${prefix}:  KV holders ${r.kvGrantHolders} (keys ${r.kvKeys}, non-grant values ${r.kvNonGrantValues})` +
        `  →  KV-only ${total} (flag false ${r.kvOnlyFlagFalse.length}, no profile row ${r.kvOnlyNoProfileRow.length})` +
        (r.unknownColumnMissing ? `, unknown ${r.unknownColumnMissing}` : ''),
    );
    for (const e of r.kvOnlyFlagFalse) console.log(`  flag-false   ${e}`);
    for (const e of r.kvOnlyNoProfileRow) console.log(`  no-profile   ${e}`);
  }
  console.log('\nNothing was written. A reconcile is a separate, approved data operation.');
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});

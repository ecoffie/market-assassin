#!/usr/bin/env node
/**
 * Repair daily_metric_snapshots.setup_emails_sent for 2026-07-07 → 2026-07-15.
 *
 * WHY: cron/snapshot-metrics counted setup emails with
 * `.select('id', { count: 'exact', head: true })` through getReadClient() — the
 * read replica. The replica rejects EVERY HTTP HEAD request with a 400, and the
 * caller did `const { count } = ...; metrics.setup_emails_sent = count ?? 0`
 * without ever looking at `error`. So the 400 became a confident 0 and got
 * upserted into history every day from the replica's creation (06 Jul 2026).
 *
 * Nine days recorded 0. The true totals are 190 emails. The source rows in
 * email_provider_sends were never touched, so this is fully recomputable — we are
 * restoring measured values, not estimating.
 *
 * The count here uses a GET + Range (content-range total), NOT head:true, so it
 * works against either host and can't silently repeat the original bug.
 *
 * Usage:
 *   node scripts/backfill-setup-emails-snapshots.mjs            # dry run (default)
 *   node scripts/backfill-setup-emails-snapshots.mjs --apply    # write
 */
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');

// Same list the cron uses (keep in sync with cron/snapshot-metrics).
const EMAIL_TYPES = [
  'mi_account_setup',
  'market_intelligence_welcome',
  'profile_reminder',
  'bootcamp_profile_setup',
];

const DATES = [
  '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11',
  '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15',
];

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) {
    console.error('Missing .env.local — run: vercel env pull .env.local');
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[m[1]] = v.replace(/\\n/g, '').trim();
  }
  return env;
}

const env = loadEnv();
// PRIMARY on purpose: never count against the replica (it 400s HEAD, and we want
// the authoritative node for a history repair regardless).
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/** GET-based exact count (no head:true) — reads the total out of content-range. */
async function trueCount(date) {
  const q =
    `${URL_}/rest/v1/email_provider_sends?select=id` +
    `&email_type=in.(${EMAIL_TYPES.join(',')})` +
    `&sent_at=gte.${date}T00:00:00.000Z&sent_at=lte.${date}T23:59:59.999Z`;
  const r = await fetch(q, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  if (!r.ok && r.status !== 206 && r.status !== 200) {
    throw new Error(`count failed for ${date}: HTTP ${r.status}`);
  }
  const total = Number((r.headers.get('content-range') || '').split('/')[1]);
  if (!Number.isFinite(total)) throw new Error(`no content-range total for ${date}`);
  return total;
}

async function recorded(date) {
  const r = await fetch(
    `${URL_}/rest/v1/daily_metric_snapshots?select=value&snapshot_date=eq.${date}&metric_key=eq.setup_emails_sent`,
    { headers: H },
  );
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0].value : null;
}

const main = async () => {
  console.log(APPLY ? '=== APPLY (writing) ===' : '=== DRY RUN (no writes) — pass --apply to write ===');
  console.log('date        | recorded | true | action');
  console.log('------------|----------|------|-------');

  const toFix = [];
  for (const date of DATES) {
    const [was, is] = await Promise.all([recorded(date), trueCount(date)]);
    let action = 'no change';
    // Only repair rows that are the known-bad shape: recorded 0 while the source
    // says otherwise. Never overwrite a value that already matches, and never
    // touch a row that isn't a false zero — this is a targeted repair.
    if (was === 0 && is > 0) { action = `FIX -> ${is}`; toFix.push({ date, value: is }); }
    else if (was === null) action = 'no row (skip)';
    else if (was === is) action = 'already correct';
    else action = `differs (${was} vs ${is}) — SKIP, not a false zero`;
    console.log(`${date} | ${String(was ?? '-').padEnd(8)} | ${String(is).padEnd(4)} | ${action}`);
  }

  const total = toFix.reduce((a, b) => a + b.value, 0);
  console.log(`\n${toFix.length} day(s) to repair, ${total} emails restored to history.`);

  if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply.'); return; }
  if (!toFix.length) { console.log('Nothing to do.'); return; }

  const rows = toFix.map(({ date, value }) => ({
    snapshot_date: date,
    metric_key: 'setup_emails_sent',
    value,
    updated_at: new Date().toISOString(),
  }));
  const r = await fetch(`${URL_}/rest/v1/daily_metric_snapshots?on_conflict=snapshot_date,metric_key`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) { console.error('upsert failed:', r.status, (await r.text()).slice(0, 300)); process.exit(1); }
  console.log(`✅ upserted ${(await r.json()).length} row(s).`);

  console.log('\nVerifying against the DB…');
  for (const { date, value } of toFix) {
    const now = await recorded(date);
    console.log(`  ${date}: ${now}`, now === value ? '✅' : `❌ expected ${value}`);
  }
};

main().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * ORACLE: are the signed-in engagement producers actually recording?
 *
 *   npm run verify:engagement                 # last 7 days, exits 1 on a dead producer
 *   npm run verify:engagement -- --days 3
 *   npm run verify:engagement -- --json
 *
 * WHY. From 2026-08-21 to 2026-09-26 every signed-in /app beacon was 401'd (#1232 made
 * /api/app/engagement require a header a beacon cannot carry). Nothing errored: pipeline
 * went 157 → 0, market_intel_dashboard 773 → 0, signed-in map-card events 14,397 → 0, and
 * the silence looked exactly like "nobody used it". A producer that drops to ZERO while
 * its control producers are still busy is a transport bug, not low usage.
 *
 * HOW IT DECIDES (read-only, one SQL round-trip):
 *   - CONTROLS are producers that never broke (Map _track, Today's Intel). If they are
 *     quiet too, there was no signed-in traffic → the verdict is UNKNOWN, never PASS/FAIL.
 *   - GUARDED producers are high-volume ones with a measured baseline. 0 signed-in events
 *     while controls are busy → FAIL.
 *   - WATCHED producers are real but low-volume (≈1/day or less); 0 is reported, never failed.
 *
 * Anonymous ids (anon:<uuid>) are excluded everywhere — the question is signed-in identity.
 * Staff (@govcongiants.com) and the controlled acceptance/reviewer accounts are excluded too:
 * a verification session must never be what turns this green. It proves the transport, not
 * that CUSTOMERS' events flow — the #1719 acceptance session wrote exactly the rows this
 * oracle counts. Pass --include-staff only to inspect a controlled test.
 */
import pg from 'pg';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
const require = createRequire(import.meta.url);
const { getDatabaseUrl } = require('./lib/db-url.js');

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) > 0 && args.includes('--days')
  ? Number(args[args.indexOf('--days') + 1]) : 7;
const asJson = args.includes('--json');
const includeStaff = args.includes('--include-staff');
const STAFF_SQL = includeStaff ? '' : `
      AND user_email NOT LIKE '%@govcongiants.com'
      AND user_email NOT IN ('demo@getmindy.ai')`;

// Each producer is a named predicate over user_engagement. Baselines are signed-in events
// in the 30 days BEFORE the 2026-08-21 break (measured 2026-09-26).
const PRODUCERS = [
  // controls — never broke
  { key: 'map_track', role: 'control', where: `event_source = 'opportunity_map'` },
  { key: 'todays_intel', role: 'control', where: `event_source = 'todays_intel'` },
  // guarded — broke on 2026-08-21
  { key: 'market_intel_dashboard', role: 'guarded', baseline30d: 773, where: `event_source = 'market_intel_dashboard'` },
  { key: 'pipeline_panel', role: 'guarded', baseline30d: 157, where: `event_source = 'pipeline'` },
  { key: 'map_card_signed_in', role: 'guarded', baseline30d: 14397,
    where: `event_source = 'source_feed' AND metadata ? 'kind'` },
  // The unload flush: only a panel_time written on tab-hide / close proves the exit path.
  // flush_reason is new with this fix, so this reads 0 until the fix is deployed.
  { key: 'app_panel_time_on_exit', role: 'guarded',
    where: `event_source = 'market_intelligence' AND metadata->>'action' = 'panel_time'
            AND metadata->>'flush_reason' IN ('hidden','pagehide')` },
  // watched — real but ≈1/day or less
  { key: 'forecasts_panel', role: 'watched', baseline30d: 55, where: `event_source = 'forecasts'` },
  { key: 'settings_panel', role: 'watched', baseline30d: 27, where: `event_source = 'settings'` },
  { key: 'grants_panel', role: 'watched', baseline30d: 18, where: `event_source = 'grants'` },
  { key: 'market_research_panel', role: 'watched', baseline30d: 16, where: `event_source = 'market_research'` },
  { key: 'onboarding_steps', role: 'watched',
    where: `event_source = 'onboarding' AND COALESCE(metadata->>'step','') <> 'welcome_choice'` },
];

const client = new pg.Client({ connectionString: getDatabaseUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET default_transaction_read_only = on');

const selects = PRODUCERS.map((p, i) => `count(*) FILTER (WHERE ${p.where}) AS p${i}`).join(',\n  ');
const { rows } = await client.query(
  `SELECT ${selects},
          max(created_at) AS newest
     FROM user_engagement
    WHERE created_at >= now() - ($1 || ' days')::interval
      AND user_email NOT LIKE 'anon:%'${STAFF_SQL}`,
  [String(days)],
);
await client.end();

const row = rows[0];
const results = PRODUCERS.map((p, i) => ({ ...p, count: Number(row[`p${i}`]) }));
const controlsBusy = results.filter((r) => r.role === 'control').every((r) => r.count > 0);

for (const r of results) {
  if (r.role === 'control') r.verdict = r.count > 0 ? 'OK' : 'QUIET';
  else if (!controlsBusy) r.verdict = 'UNKNOWN';
  else if (r.role === 'guarded') r.verdict = r.count > 0 ? 'PASS' : 'FAIL';
  else r.verdict = r.count > 0 ? 'OK' : 'ZERO (low volume — not failed)';
}

const failed = results.filter((r) => r.verdict === 'FAIL');
const overall = !controlsBusy ? 'UNKNOWN' : failed.length ? 'FAIL' : 'PASS';

if (asJson) {
  console.log(JSON.stringify({ window_days: days, overall, newest_signed_in_event: row.newest, results }, null, 2));
} else {
  console.log(`Signed-in engagement producers — last ${days} day(s)${includeStaff ? ' — INCLUDING staff/test accounts' : ', customers only'}  (newest signed-in event: ${row.newest?.toISOString?.() ?? row.newest})`);
  for (const r of results) {
    const base = r.baseline30d ? `  (pre-break 30d: ${r.baseline30d})` : '';
    console.log(`  ${r.verdict.padEnd(32)} ${r.role.padEnd(8)} ${r.key.padEnd(24)} ${String(r.count).padStart(6)}${base}`);
  }
  if (!controlsBusy) console.log('\nUNKNOWN: control producers are quiet too — no signed-in traffic to judge against.');
  console.log(`\n${overall}${failed.length ? `: ${failed.map((f) => f.key).join(', ')} recorded 0 signed-in events while controls were busy` : ''}`);
}
process.exit(overall === 'FAIL' ? 1 : 0);

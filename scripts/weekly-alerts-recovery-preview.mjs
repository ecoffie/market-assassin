#!/usr/bin/env node
/**
 * READ-ONLY recovery preview for the weekly-alerts delivery repair (2026-10-06).
 *
 * Lists who the two weekly defects affected and what WOULD happen to them — it performs no writes,
 * sends nothing, and changes no settings. Per-user rows (emails) go ONLY to --out <file>, which must
 * be a private path (never commit it); stdout carries aggregate counts only.
 *
 *   A. Explicit weekly subscribers (alert_frequency='weekly', alerts on) with no weekly alert_log row
 *      in a cycle since 2026-08-23 — never reached by the capacity-limited, email-ordered queue.
 *   B. Suppressed addresses with a weekly row logged 'sent' AFTER their suppression date — phantom sends.
 *
 * Usage: node scripts/weekly-alerts-recovery-preview.mjs [--out /private/path.csv]
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('✗ missing Supabase env'); process.exit(2); }
const sb = createClient(url, key);
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : null;
const SINCE_CYCLE = '2026-08-23';
const k = (s) => (s || '').toLowerCase().trim();

async function pageAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const weekly = await pageAll(() => sb.from('alert_log')
  .select('id,user_email,alert_date,delivery_status,error_message,sent_at') // truncation-ok: paged by pageAll() — .range() per 1,000 until a short page
  .eq('alert_type', 'weekly').gte('alert_date', '2026-07-01').order('id'));
const users = await pageAll(() => sb.from('user_notification_settings')
  .select('user_email,alert_frequency,alerts_enabled,is_active,naics_codes').eq('alert_frequency', 'weekly').order('user_email')); // truncation-ok: paged by pageAll() — .range() per 1,000 until a short page
const supp = await pageAll(() => sb.from('email_suppressions').select('user_email,reason,created_at').order('user_email')); // truncation-ok: paged by pageAll() — .range() per 1,000 until a short page

const cycles = [...new Set(weekly.map((r) => r.alert_date))].filter((d) => d >= SINCE_CYCLE).sort();
const byUser = new Map();
for (const r of weekly) { const e = k(r.user_email); if (!byUser.has(e)) byUser.set(e, []); byUser.get(e).push(r); }
const suppressed = new Map(supp.map((s) => [k(s.user_email), s]));

const rows = [];
// A — explicit weekly subscribers not reached
for (const u of users.filter((x) => x.alerts_enabled && x.is_active)) {
  const e = k(u.user_email);
  const mine = byUser.get(e) || [];
  const reached = cycles.filter((d) => mine.some((r) => r.alert_date === d)).length;
  const lastSent = mine.filter((r) => r.delivery_status === 'sent').map((r) => r.alert_date).sort().at(-1) || '';
  const s = suppressed.get(e);
  if (reached === cycles.length) continue;
  rows.push({
    group: 'A_explicit_weekly_not_reached', email: e, cycles_missed: cycles.length - reached, cycles_total: cycles.length,
    last_weekly_sent: lastSent, has_naics: (u.naics_codes || []).length > 0, suppressed: s ? s.reason : '',
    proposed_action: s ? 'none — suppressed; needs a deliverable address decision'
      : (u.naics_codes || []).length ? 'reached on the next scheduled cycle after the fix ships; NO catch-up email'
        : 'reached next cycle but will log "No NAICS configured" — profile setup, not delivery',
  });
}
// B — phantom sends to suppressed addresses
for (const [e, s] of suppressed) {
  const phantom = (byUser.get(e) || []).filter((r) => r.delivery_status === 'sent' && r.sent_at && r.sent_at > s.created_at);
  if (!phantom.length) continue;
  rows.push({
    group: 'B_suppressed_logged_sent', email: e, cycles_missed: phantom.length, cycles_total: '', last_weekly_sent: phantom.map((r) => r.alert_date).sort().at(-1),
    has_naics: '', suppressed: s.reason,
    proposed_action: 'no send. Decide: annotate the historical rows (non-destructive) or leave history as-is; future cycles log send_guard_blocked',
  });
}

// Per-cycle history: rows written and EVERY outcome reason, plus explicit-weekly coverage
// against today's explicit-weekly population (eligibility changes over time — labelled current).
const explicitNow = new Set(users.filter((x) => x.alerts_enabled && x.is_active).map((x) => k(x.user_email)));
console.log('\ncycle      | rows | explicit-weekly reached (of current ' + explicitNow.size + ') | outcomes');
for (const d of [...new Set(weekly.map((r) => r.alert_date))].sort()) {
  const g = weekly.filter((r) => r.alert_date === d);
  const reasons = {};
  for (const r of g) { const key = r.delivery_status === 'sent' ? 'sent' : `${r.delivery_status}:${r.error_message || 'unspecified'}`; reasons[key] = (reasons[key] || 0) + 1; }
  const reached = g.filter((r) => explicitNow.has(k(r.user_email))).length;
  console.log(`${d} | ${String(g.length).padStart(4)} | ${String(reached).padStart(3)} | ${JSON.stringify(reasons)}`);
}
console.log('(users with NO row in a cycle were never reached — there is no skip reason to show for them)\n');
const count = (g) => rows.filter((r) => r.group === g).length;
console.log(`cycles since ${SINCE_CYCLE}: ${cycles.length} (${cycles[0]} → ${cycles.at(-1)})`);
console.log(`explicit weekly subscribers (alerts on): ${users.filter((x) => x.alerts_enabled && x.is_active).length}`);
console.log(`A explicit weekly missed ≥1 cycle: ${count('A_explicit_weekly_not_reached')}`
  + ` (missed ALL: ${rows.filter((r) => r.group === 'A_explicit_weekly_not_reached' && r.cycles_missed === r.cycles_total).length};`
  + ` suppressed: ${rows.filter((r) => r.group === 'A_explicit_weekly_not_reached' && r.suppressed).length};`
  + ` no NAICS: ${rows.filter((r) => r.group === 'A_explicit_weekly_not_reached' && r.has_naics === false).length})`);
console.log(`B suppressed addresses with weekly rows logged sent after suppression: ${count('B_suppressed_logged_sent')}`
  + ` (rows: ${rows.filter((r) => r.group === 'B_suppressed_logged_sent').reduce((s, r) => s + r.cycles_missed, 0)})`);
if (OUT) {
  const cols = Object.keys(rows[0] || { group: '' });
  const esc = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  fs.writeFileSync(OUT, [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
  console.log(`per-user rows → ${OUT} (private; do not commit)`);
}

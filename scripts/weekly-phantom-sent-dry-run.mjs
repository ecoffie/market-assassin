#!/usr/bin/env node
/**
 * DRY RUN ONLY — proposed annotations for weekly alert_log rows logged 'sent' to an address that was
 * already suppressed (2026-10-06 weekly delivery repair, #1851).
 *
 * Writes NOTHING. Original alert_log rows are evidence and are never edited or deleted; the proposal is
 * an append-only annotation per row, classified by what the evidence actually shows — NOT a blanket
 * "bounced" claim:
 *
 *   NO_PROVIDER_HANDOFF  — no email_provider_sends record for that address + weekly_alert within ±15 min
 *                          of the row's sent_at. The send guard refused the recipient; the 'sent' status is
 *                          false. Annotation: "logged sent; no provider handoff; recipient suppressed since …".
 *   PROVIDER_HANDOFF     — a provider record exists. The email WAS handed to the provider (e.g. a
 *                          suppression reason the guard did not block at the time). Not phantom; the
 *                          annotation only links the provider outcome events, it does not claim non-delivery.
 *
 * stdout: aggregate counts + the proposed DDL/INSERT shape (no emails). Per-row output (emails) ONLY via
 * --out <private path>. Usage: node scripts/weekly-phantom-sent-dry-run.mjs [--out /private/file.csv]
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
const k = (s) => (s || '').toLowerCase().trim();
const WINDOW_MS = 15 * 60 * 1000;

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

const supp = await pageAll(() => sb.from('email_suppressions').select('user_email,reason,created_at').order('user_email')); // truncation-ok: paged by pageAll() — .range() per 1,000
const rows = [];
for (const s of supp) {
  const e = k(s.user_email);
  const { data: sent, error } = await sb.from('alert_log')
    .select('id,user_email,alert_date,sent_at,delivery_status') // truncation-ok: one address, weekly rows after its suppression date — bounded by cycles elapsed
    .eq('user_email', s.user_email).eq('alert_type', 'weekly').eq('delivery_status', 'sent').gt('sent_at', s.created_at).limit(200);
  if (error) throw new Error(error.message);
  for (const r of sent || []) {
    const t = Date.parse(r.sent_at);
    const { data: prov, error: pe } = await sb.from('email_provider_sends')
      .select('id,provider,provider_message_id,sent_at,status') // truncation-ok: one address, ±15 min window
      .eq('user_email', e).eq('email_type', 'weekly_alert')
      .gte('sent_at', new Date(t - WINDOW_MS).toISOString()).lte('sent_at', new Date(t + WINDOW_MS).toISOString()).limit(5);
    if (pe) throw new Error(pe.message);
    const handoff = (prov || [])[0] || null;
    rows.push({
      alert_log_id: r.id, email: e, alert_date: r.alert_date, sent_at: r.sent_at,
      suppressed_since: s.created_at, suppression_reason: s.reason,
      classification: handoff ? 'PROVIDER_HANDOFF' : 'NO_PROVIDER_HANDOFF',
      provider_message_id: handoff?.provider_message_id || '',
      proposed_annotation: handoff
        ? 'Provider handoff recorded; see provider events for the outcome. Status not changed.'
        : `Logged 'sent' but no provider handoff was recorded; recipient suppressed since ${s.created_at.slice(0, 10)} (${s.reason}). Likely blocked by the send guard.`,
    });
  }
}

const by = (c) => rows.filter((r) => r.classification === c);
console.log(`weekly rows logged 'sent' after the address was suppressed: ${rows.length} (addresses: ${new Set(rows.map((r) => r.email)).size})`);
for (const c of ['NO_PROVIDER_HANDOFF', 'PROVIDER_HANDOFF']) {
  const g = by(c); const reasons = {};
  for (const r of g) reasons[r.suppression_reason] = (reasons[r.suppression_reason] || 0) + 1;
  console.log(`  ${c}: ${g.length} rows, ${new Set(g.map((r) => r.email)).size} addresses, by suppression reason ${JSON.stringify(reasons)}`);
}
console.log(`
PROPOSED (HOLD — not applied, no migration file committed):
  CREATE TABLE IF NOT EXISTS alert_log_annotations (
    id bigserial PRIMARY KEY,
    alert_log_id <alert_log.id type> NOT NULL,     -- original row untouched
    annotation text NOT NULL,
    basis jsonb NOT NULL,                           -- {classification, suppressed_since, suppression_reason, provider_message_id}
    created_by text NOT NULL DEFAULT 'weekly-delivery-repair-2026-10-06',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (alert_log_id, created_by)
  );
  INSERT INTO alert_log_annotations (alert_log_id, annotation, basis) VALUES (...one row per id in --out...)
  ON CONFLICT (alert_log_id, created_by) DO NOTHING;`);
if (OUT) {
  const cols = Object.keys(rows[0] || { alert_log_id: '' });
  const esc = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  fs.writeFileSync(OUT, [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
  console.log(`per-row proposals → ${OUT} (private; do not commit)`);
}

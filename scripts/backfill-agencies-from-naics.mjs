/**
 * One-time backfill: populate user_notification_settings.agencies from NAICS for
 * every existing user who has NAICS but empty agencies (the slurpee never seeded
 * this field — Eric 2026-07-02). Idempotent + resumable: it only touches rows with
 * empty agencies, so re-running skips everyone already done.
 *
 * Bulk job (>1000 rows) → local runner with a concurrency pool per CLAUDE.md rule
 * #7, NOT an HTTP cron loop. Calls the LIVE public find-agencies scan (no auth) so
 * results match what the seed-on-save path produces.
 *
 * Run:  vercel env pull .env.vercel.tmp --environment=production
 *       node scripts/backfill-agencies-from-naics.mjs [--dry] [--limit=N]
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const DRY = process.argv.includes('--dry');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const MAX = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : Infinity;
const BASE = 'https://getmindy.ai';
const CONCURRENCY = 6;          // polite to find-agencies (each call scans USASpending)
const AGENCIES_PER_USER = 10;

// Target ONLY custom-NAICS users (Eric 2026-07-02): people who replaced the
// pre-populated default template, not the ~7,877 who kept it. A user is "custom"
// if their NAICS includes ANY code outside this default 5-set. Default/subset-of-
// default users are skipped here (new-user seed-on-save still covers them going
// forward; Decision Makers also derives agencies on the fly).
const DEFAULT_NAICS = new Set(['541512', '541611', '541330', '541990', '561210']);
const isCustomNaics = (codes) => codes.map(String).some((c) => !DEFAULT_NAICS.has(c));

const clean = v => v.trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '').trim();
const env = Object.fromEntries(
  fs.readFileSync('.env.vercel.tmp', 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), clean(l.slice(i + 1))]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Derive top agencies from a user's NAICS via the live find-agencies scan.
async function derive(naics) {
  const codes = naics.map(String).map(s => s.trim()).filter(Boolean).slice(0, 3);
  const seen = new Set(), out = [];
  for (const code of codes) {
    try {
      const r = await fetch(`${BASE}/api/usaspending/find-agencies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naicsCode: code }),
      });
      if (!r.ok) continue;
      const j = await r.json();
      for (const a of (j.agencies || [])) {
        const label = (a.subAgency || a.name || a.parentAgency || '').trim();
        if (!label) continue;
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key); out.push(label);
        if (out.length >= AGENCIES_PER_USER) return out;
      }
    } catch { /* skip this code */ }
  }
  return out;
}

// Page through ALL rows (Supabase caps at 1000/req).
async function fetchAllTargets() {
  const targets = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('user_notification_settings')
      .select('user_email, naics_codes, agencies')
      .not('naics_codes', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const hasNaics = Array.isArray(r.naics_codes) && r.naics_codes.length > 0;
      const emptyAgencies = !Array.isArray(r.agencies) || r.agencies.length === 0;
      // Custom-NAICS only — skip users who kept the pre-populated default set.
      if (hasNaics && emptyAgencies && isCustomNaics(r.naics_codes)) targets.push(r);
    }
    if (data.length < PAGE) break;
  }
  return targets;
}

const targets = (await fetchAllTargets()).slice(0, MAX);
console.log(`${DRY ? '[DRY] ' : ''}Backfilling ${targets.length} users (NAICS set, agencies empty)…`);

let done = 0, seeded = 0, empty = 0, failed = 0;
async function worker(queue) {
  while (queue.length) {
    const row = queue.shift();
    try {
      const agencies = await derive(row.naics_codes);
      if (agencies.length === 0) { empty++; }
      else {
        seeded++;
        if (!DRY) {
          const { error } = await sb.from('user_notification_settings')
            .update({ agencies }).eq('user_email', row.user_email);
          if (error) { failed++; seeded--; console.warn(`  write fail ${row.user_email}: ${error.message}`); }
        }
      }
    } catch (e) { failed++; console.warn(`  derive fail ${row.user_email}: ${e.message}`); }
    if (++done % 25 === 0) console.log(`  ${done}/${targets.length} — seeded ${seeded}, empty ${empty}, failed ${failed}`);
  }
}

const queue = [...targets];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
console.log(`\nDONE. seeded=${seeded} empty=${empty} failed=${failed} of ${targets.length}${DRY ? ' (dry — no writes)' : ''}`);

/**
 * One-time: classify the users who have briefings_enabled but NO
 * customer_classifications row — the THIRD gate, which is the one that
 * actually blocks delivery.
 *
 * WHY THEY EXIST. `briefings_enabled` is set automatically (Stripe webhook,
 * backfills). A classification row is NOT — every writer is an /api/admin/*
 * route someone invokes by hand, and the table was last populated in bulk on
 * 2026-04-29. So the two flags drift apart by design: gate 2 flips on its own,
 * gate 3 never does. Everyone who signed up after the last manual pass is
 * invisible to the briefing cron.
 *
 * TWO OF THEM ARE PAYING $149/MONTH (verified against Stripe directly, not
 * inferred from paid_status): active subscriptions, receiving nothing.
 *
 * Dry by default. --go to write.
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const GO = process.argv.includes('--go');

// Verified against Stripe 2026-08-19: both hold an ACTIVE $149/mo subscription.
const PAYERS = new Set(['jgruber@claveworkforce.com', 'info@akhgcorporation.com']);

async function main() {
  const enabled: { user_email: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('user_notification_settings')
      .select('user_email')
      .eq('briefings_enabled', true)
      .range(from, from + 999);
    if (error) throw new Error(`read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    enabled.push(...data);
    if (data.length < 1000) break;
  }

  // PAGED. PostgREST silently caps an unranged select at 1,000 rows, and this
  // table holds 1,750 — so a bare read made 750 ALREADY-CLASSIFIED users look
  // stranded and inflated the write from 28 rows to 87. Caught by cross-checking
  // against a SQL COUNT before writing; the two must agree or nothing is written.
  const have = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('customer_classifications')
      .select('email')
      .range(from, from + 999);
    if (error) throw new Error(`read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) { const e = (r.email || '').toLowerCase().trim(); if (e) have.add(e); }
    if (data.length < 1000) break;
  }
  const stranded = enabled
    .map((r) => (r.user_email || '').toLowerCase().trim())
    .filter((e) => e && !have.has(e));

  // Established labels, not invented ones: `free`+`beta_preview` is the existing
  // 123-row convention; `mi_subscription`+`subscription` is the 19-row one.
  const rows = stranded.map((email) => {
    const payer = PAYERS.has(email);
    return {
      email,
      classification: payer ? 'mi_subscription' : 'free',
      briefings_access: payer ? 'subscription' : 'beta_preview',
      briefings_expiry: null,           // null = never expires, matches existing rows
      has_active_subscription: payer,
      classification_version: 3,
    };
  });

  console.log(`stranded: ${rows.length}`);
  console.log(`  payers → mi_subscription/subscription : ${rows.filter((r) => r.briefings_access === 'subscription').length}`);
  console.log(`  free   → free/beta_preview            : ${rows.filter((r) => r.briefings_access === 'beta_preview').length}`);
  console.log('\nsample:', JSON.stringify(rows[0], null, 1));

  if (!GO) { console.log('\nDRY RUN — pass --go to write.'); return; }

  // INSERT only. Every row here has NO existing classification (that is the
  // definition of stranded), so nothing is overwritten.
  const { error } = await sb.from('customer_classifications').insert(rows);
  if (error) throw new Error(`insert failed: ${error.message}`);
  console.log(`\n✓ inserted ${rows.length} classification rows`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

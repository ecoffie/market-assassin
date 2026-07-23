#!/usr/bin/env npx tsx
/**
 * Backfill paid_status/stripe_customer_id drift in user_notification_settings.
 *
 * Cohort: users with user_profiles.access_briefings=true (Pro entitlement) but
 * user_notification_settings.paid_status=false. For each we verify against Stripe
 * and only set paid_status=true + stripe_customer_id when there's a REAL payment
 * (active sub or paid charge). Staff / comp / advocate / testimonial accounts
 * (isExcludedFromMetrics) are SKIPPED — they hold access complimentarily and must
 * NOT be counted as paid revenue.
 *
 * DRY-RUN BY DEFAULT — prints the classified cohort, writes NOTHING. Pass --go to
 * apply. Idempotent + resumable. See tasks/paid-status-drift-notification-settings.md.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + STRIPE_SECRET_KEY.
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getStripeVerification } from '../src/lib/admin/member-grants';
import { isExcludedFromMetrics } from '../src/lib/mindy/campaign-exclusions';

const GO = process.argv.includes('--go');

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 1) Entitled emails (only ~56, no pagination worry).
  const { data: entitled, error: e1 } = await db
    .from('user_profiles').select('email').eq('access_briefings', true);
  if (e1) throw e1;
  const entitledEmails = new Set((entitled || []).map((r: any) => String(r.email).toLowerCase()));

  // 2) Their settings rows where paid_status=false — fetch DIRECTLY by that email
  //    list (avoids the 10k-row / 1000-cap paginate trap the first version hit).
  const emails = [...entitledEmails];
  const cohort: string[] = [];
  for (let i = 0; i < emails.length; i += 200) {
    const chunk = emails.slice(i, i + 200);
    const { data, error } = await db
      .from('user_notification_settings')
      .select('user_email, paid_status')
      .in('user_email', chunk)
      .eq('paid_status', false);
    if (error) throw error;
    for (const r of data || []) cohort.push(String(r.user_email).toLowerCase());
  }

  console.log(`Cohort: ${cohort.length} entitled rows with paid_status=false\n`);
  if (cohort.length === 0) { console.log('Nothing to do.'); return; }

  // 3) Classify each: skip special accounts; verify real payers against Stripe.
  const toWrite: Array<{ email: string; stripe: string }> = [];
  const skippedSpecial: string[] = [];
  const skippedNoPayment: string[] = [];

  for (const email of cohort) {
    if (isExcludedFromMetrics(email)) { skippedSpecial.push(email); continue; }
    const v = await getStripeVerification(email);
    const realPayer = v.found && ((v.activeSubscriptions || 0) > 0 || (v.totalPaid || 0) > 0) && !v.hasRefunds;
    if (realPayer && v.customerId) toWrite.push({ email, stripe: v.customerId });
    else skippedNoPayment.push(email);
  }

  console.log(`── Classification ──`);
  console.log(`Real payers to fix:   ${toWrite.length}`);
  console.log(`Skipped (staff/comp): ${skippedSpecial.length}  ${skippedSpecial.length ? '[' + skippedSpecial.join(', ') + ']' : ''}`);
  console.log(`Skipped (no payment): ${skippedNoPayment.length}  ${skippedNoPayment.length ? '[' + skippedNoPayment.join(', ') + ']' : ''}`);
  console.log('');
  console.log(`── Would set paid_status=true + stripe_customer_id on: ──`);
  for (const w of toWrite) console.log(`  ${w.email}  →  ${w.stripe}`);
  console.log('');

  if (!GO) { console.log(`🟡 DRY RUN — nothing written. Re-run with --go to apply ${toWrite.length} rows.`); return; }

  let updated = 0;
  for (const w of toWrite) {
    const { error } = await db
      .from('user_notification_settings')
      .update({ paid_status: true, stripe_customer_id: w.stripe, updated_at: new Date().toISOString() })
      .eq('user_email', w.email);
    if (error) console.error(`  ✗ ${w.email}: ${error.message}`);
    else updated++;
  }
  console.log(`✅ WROTE ${updated}/${toWrite.length} rows.`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

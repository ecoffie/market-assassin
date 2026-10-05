/**
 * Record a prepaid (off-Stripe) Pro credit schedule — mcp_prepaid_entitlements.
 * The monthly grant cron (/api/cron/grant-mcp-pro-credits) then pays each month in the
 * window under pro:<email>:<YYYY-MM>, and stops after the last one.
 *
 * DRY-RUN by default. Before --go it proves the schedule matches the RECORDED access end:
 * the live expiry of the KV briefings:<email> key (the Pro access gate) must fall on
 * --access-ends (America/New_York date). A mismatch refuses the write.
 *
 *   npx tsx scripts/add-prepaid-entitlement.ts <email> --access-starts 2026-10-05 \
 *     --access-ends 2027-04-05 --credits 1500 --source invoice --reference "Wave: $3K consulting" [--go]
 *
 * Writes nothing else: no credits are granted here (the cron does that), no email is sent.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { scheduleFromAccessWindow, validatePrepaidSchedule, monthsInWindow, monthlyGrantKey } from '../src/lib/mcp/prepaid-entitlements';

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const email = (argv[0] || '').toLowerCase().trim();
const accessStartsOn = flag('access-starts') ?? '';
const accessEndsOn = flag('access-ends') ?? '';
const monthlyCredits = Number(flag('credits') ?? '');
const source = flag('source') ?? '';
const reference = flag('reference') ?? null;
const go = argv.includes('--go');

const nyDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);

async function main() {
  if (!email.includes('@') || !/^\d{4}-\d{2}-\d{2}$/.test(accessStartsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(accessEndsOn)) {
    throw new Error('usage: <email> --access-starts YYYY-MM-DD --access-ends YYYY-MM-DD --credits N --source invoice|wire|bootcamp|bundle|other [--reference text] [--go]');
  }
  const { firstMonth, lastMonth } = scheduleFromAccessWindow(accessStartsOn, accessEndsOn);
  const errors = validatePrepaidSchedule({ firstMonth, lastMonth, accessStartsOn, accessEndsOn, monthlyCredits });
  if (!['invoice', 'wire', 'bootcamp', 'bundle', 'other'].includes(source)) errors.push(`bad --source ${source}`);

  // The recorded access end: when the Pro access key actually expires.
  const ttl = await kv.ttl(`briefings:${email}`);
  const kvExpiresOn = ttl > 0 ? nyDate(new Date(Date.now() + ttl * 1000)) : null;
  if (ttl === -2) errors.push(`briefings:${email} does not exist — grant Pro access first`);
  else if (ttl === -1) errors.push(`briefings:${email} never expires — set its expiry to ${accessEndsOn} first`);
  else if (kvExpiresOn !== accessEndsOn) errors.push(`access key expires ${kvExpiresOn}, schedule says ${accessEndsOn}`);

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const months = monthsInWindow(firstMonth, lastMonth);
  const { data: claims, error: claimErr } = await supabase
    .from('mcp_credit_topups').select('idempotency_key, credits')
    .in('idempotency_key', months.map((m) => monthlyGrantKey(email, m)));
  if (claimErr) throw new Error(`reading existing claims failed: ${claimErr.message}`);
  const claimed = new Set((claims ?? []).map((c) => c.idempotency_key));

  const plan = {
    email, monthlyCredits, firstMonth, lastMonth, accessStartsOn, accessEndsOn, kvExpiresOn, source, reference,
    months: months.map((m) => ({ month: m, key: monthlyGrantKey(email, m), alreadyGranted: claimed.has(monthlyGrantKey(email, m)) })),
    remainingGrants: months.filter((m) => !claimed.has(monthlyGrantKey(email, m))).length,
    remainingCredits: months.filter((m) => !claimed.has(monthlyGrantKey(email, m))).length * monthlyCredits,
  };
  console.log(JSON.stringify({ mode: go ? 'execute' : 'dry-run', errors, plan }, null, 2));
  if (errors.length) process.exit(1);
  if (!go) return;

  const { data, error } = await supabase.from('mcp_prepaid_entitlements').insert({
    user_email: email, monthly_credits: monthlyCredits,
    first_month: `${firstMonth}-01`, last_month: `${lastMonth}-01`,
    access_starts_on: accessStartsOn, access_ends_on: accessEndsOn,
    source, reference, created_by: 'scripts/add-prepaid-entitlement.ts',
  }).select('id, user_email, first_month, last_month, access_ends_on, status').single();
  if (error) throw new Error(`insert failed: ${error.message}`);
  console.log('inserted', data);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });

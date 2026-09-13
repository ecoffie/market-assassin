/**
 * Read-only reconciliation of access_briefings=true rows that lack an entitled
 * customer_classifications send-path grant.
 *
 * Prevention (Path A webhook) is a separate change. This script does NOT write.
 * It prints the exact repair set for a human go-ahead.
 *
 *   npx tsx --env-file=/tmp/ma-prod.clean.env scripts/reconcile-briefing-classification-gaps.ts
 */
import { createClient } from '@supabase/supabase-js';
import { briefingGrantForCustomer } from '@/lib/briefings/product-entitlement';

const ENTITLED = new Set(['lifetime', '1_year', '6_month', 'subscription', 'beta_preview']);

function isEntitled(row: { email?: string | null; briefings_access?: string | null; briefings_expiry?: string | null }): boolean {
  if (!ENTITLED.has(String(row.briefings_access || ''))) return false;
  if (row.briefings_expiry && new Date(row.briefings_expiry).getTime() <= Date.now()) return false;
  return true;
}

/** purchases.amount_paid is mixed dollars vs cents historically. */
function amountToCents(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1000 ? Math.round(n) : Math.round(n * 100);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing supabase env');
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

type Action =
  | 'upsert_subscription'
  | 'upsert_lifetime'
  | 'skip_excluded'
  | 'skip_expired'
  | 'skip_opted_out'
  | 'skip_no_qualifying_purchase'
  | 'skip_already_entitled';

async function pageAll<T>(load: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const to = from + 999;
    const { data, error } = await load(from, to);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const profiles = await pageAll((from, to) =>
    sb.from('user_profiles').select('email, access_briefings, tier').eq('access_briefings', true).range(from, to),
  );
  const classes = await pageAll((from, to) =>
    sb.from('customer_classifications').select('email, briefings_access, briefings_expiry, has_active_subscription, classification').range(from, to),
  );
  const classByEmail = new Map(
    classes.map((row) => [String(row.email || '').toLowerCase(), row]),
  );

  const gaps = profiles.filter((row) => {
    const email = String(row.email || '').toLowerCase();
    if (!email) return false;
    const cls = classByEmail.get(email);
    return !cls || !isEntitled({ email, briefings_access: cls.briefings_access, briefings_expiry: cls.briefings_expiry });
  });

  const emails = gaps.map((g) => String(g.email || '').toLowerCase()).filter(Boolean);
  const purchases = emails.length === 0 ? [] : await pageAll((from, to) =>
    sb.from('purchases').select('user_email, product_name, amount_paid, created_at').in('user_email', emails).range(from, to),
  );
  const settings = emails.length === 0 ? [] : await pageAll((from, to) =>
    sb.from('user_notification_settings')
      .select('user_email, briefings_enabled, is_active, alert_frequency, alerts_enabled, paid_status, treatment_type')
      .in('user_email', emails)
      .range(from, to),
  );

  const purchasesByEmail = new Map<string, typeof purchases>();
  for (const p of purchases) {
    const e = String(p.user_email || '').toLowerCase();
    const list = purchasesByEmail.get(e) || [];
    list.push(p);
    purchasesByEmail.set(e, list);
  }
  const settingsByEmail = new Map(settings.map((s) => [String(s.user_email || '').toLowerCase(), s]));

  const repairSet = gaps.map((g) => {
    const email = String(g.email || '').toLowerCase();
    const cls = classByEmail.get(email);
    const note = settingsByEmail.get(email);
    const bought = purchasesByEmail.get(email) || [];
    const grant = briefingGrantForCustomer(
      bought.map((p) => ({
        product_name: p.product_name,
        amount_paid: amountToCents(Number(p.amount_paid) || 0),
      })),
    );
    const optedOut = note?.is_active === false || note?.briefings_enabled === false;

    let action: Action = 'skip_no_qualifying_purchase';
    let reason = grant.earns ? grant.access : ('reason' in grant ? grant.reason : 'no qualifying purchase');
    if (cls && isEntitled({ email, briefings_access: cls.briefings_access, briefings_expiry: cls.briefings_expiry })) {
      action = 'skip_already_entitled';
      reason = `already ${cls.briefings_access}`;
    } else if (String(cls?.briefings_access || '') === 'excluded') {
      action = 'skip_excluded';
      reason = 'excluded wins';
    } else if (cls?.briefings_expiry && new Date(cls.briefings_expiry).getTime() <= Date.now()) {
      action = 'skip_expired';
      reason = `expired ${cls.briefings_expiry}`;
    } else if (optedOut) {
      action = 'skip_opted_out';
      reason = `is_active=${note?.is_active} briefings_enabled=${note?.briefings_enabled}`;
    } else if (grant.earns && grant.access === 'lifetime') {
      action = 'upsert_lifetime';
    } else if (grant.earns && grant.access === 'subscription') {
      action = 'upsert_subscription';
    } else {
      action = 'skip_no_qualifying_purchase';
    }

    return {
      email,
      profileTier: g.tier,
      classification: cls ? {
        briefings_access: cls.briefings_access,
        briefings_expiry: cls.briefings_expiry,
        has_active_subscription: cls.has_active_subscription,
      } : null,
      optOut: {
        is_active: note?.is_active ?? null,
        briefings_enabled: note?.briefings_enabled ?? null,
        alert_frequency: note?.alert_frequency ?? null,
        alerts_enabled: note?.alerts_enabled ?? null,
      },
      purchases: bought.map((p) => ({
        product: p.product_name,
        amount_paid: p.amount_paid,
        created_at: p.created_at,
      })),
      grant,
      action,
      reason,
    };
  });

  const counts = repairSet.reduce<Record<string, number>>((acc, row) => {
    acc[row.action] = (acc[row.action] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    asOf: new Date().toISOString(),
    gapCount: repairSet.length,
    counts,
    writesProposed: repairSet.filter((r) => r.action.startsWith('upsert_')),
    skipped: repairSet.filter((r) => r.action.startsWith('skip_')),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

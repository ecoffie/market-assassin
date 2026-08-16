/**
 * "Paid but never onboarded" — customers who bought and were never wired up to
 * receive anything.
 *
 * THE GAP THIS DETECTS
 * The row that makes a customer reachable — `user_notification_settings` — is
 * created in exactly ONE place: the Stripe checkout webhook
 * (api/stripe-webhook/route.ts, the AUTO-ENROLL block). Every send path reads
 * that table. No row means no alerts, no briefings, no email, ever.
 *
 * The credit-grant cron (grant-mcp-pro-credits) does NOT create it. So when the
 * checkout webhook misses — a payment link that skipped it, a failed delivery,
 * an out-of-band charge — the cron still notices the customer is Pro and tops up
 * their credits on schedule. The account then LOOKS provisioned (credits
 * granted, ledger entries, a tier) while being invisible to every send path.
 *
 * Measured 2026-08-15: 6 paying customers in this state, including a $2,997
 * buyer from 2026-06-27. All six had MCP credits from `pro_monthly` /
 * `app_tier_pro`, zero notification settings, zero alerts, zero briefings, and
 * ZERO emails ever sent — no tracking token, no alert_log row, nothing. Eight
 * weeks of silence that would only have surfaced as a refund request.
 *
 * WHY A SETTINGS ROW ALONE IS NOT THE FIX
 * None of the six has a single NAICS code. Creating the row makes them
 * reachable but produces a GENERIC briefing, which is worse than silence for a
 * paying customer (the same rule the briefing audience applies). So this
 * detector reports what each account is missing — the row, the targeting, or
 * both — instead of implying a one-click repair.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Below this, a charge is a test or a fee line, not a customer. */
const MIN_PAID_CENTS = 9900;

export interface UnonboardedPayer {
  email: string;
  /** Largest single real charge, in cents. Ranks the list by what is at stake. */
  paidCents: number;
  productName: string | null;
  purchasedAt: string | null;
  /** Days since purchase — how long they have been paying for silence. */
  daysSilent: number;
  hasProfile: boolean;
  hasSettings: boolean;
  targetingCount: number;
  /** Credits granted by the cron — the signal that made them LOOK provisioned. */
  creditBalance: number;
  /**
   * What actually has to happen. 'onboarding' = no settings row at all;
   * 'targeting' = reachable but nothing to match on; 'both' = neither.
   */
  needs: 'onboarding' | 'targeting' | 'both';
}

export interface UnonboardedResult {
  payers: UnonboardedPayer[];
  /** Paying customers checked. */
  checked: number;
  error?: string;
}

/** PostgREST caps a select at 1000 rows — page or silently lose the tail. */
async function all<T>(sb: SupabaseClient, table: string, sel: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(sel).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

export async function findUnonboardedPayers(sb: SupabaseClient): Promise<UnonboardedResult> {
  let purchases: Array<{ user_email: string; amount_paid: number | null; product_name: string | null; created_at: string; superseded_by: string | null }>;
  let settings: Array<{ user_email: string; naics_codes: unknown[] | null; keywords: unknown[] | null; agencies: unknown[] | null }>;
  let profiles: Array<{ email: string }>;
  let balances: Array<{ user_email: string; balance: number | null }>;
  try {
    // superseded_by: skip the duplicate rows the two webhooks wrote (see
    // 20260815_purchases_canonical_view.sql) or every customer counts twice.
    purchases = await all(sb, 'purchases', 'user_email, amount_paid, product_name, created_at, superseded_by');
    settings = await all(sb, 'user_notification_settings', 'user_email, naics_codes, keywords, agencies');
    profiles = await all(sb, 'user_profiles', 'email');
    balances = await all(sb, 'mcp_credit_balance', 'user_email, balance');
  } catch (err) {
    // Surface it. A failed read here reporting "nobody is stranded" is the exact
    // silent-failure this detector exists to end.
    console.error('[unonboarded-payers] read failed:', err);
    return { payers: [], checked: 0, error: err instanceof Error ? err.message : String(err) };
  }

  const settingsBy = new Map(settings.map((s) => [String(s.user_email).toLowerCase().trim(), s]));
  const profileSet = new Set(profiles.map((p) => String(p.email).toLowerCase().trim()));
  const balanceBy = new Map(balances.map((b) => [String(b.user_email).toLowerCase().trim(), Number(b.balance) || 0]));

  /**
   * Amounts are stored in BOTH dollars and cents by the two webhooks, so a raw
   * value is ambiguous: 1490 is both "$14.90 in cents" (a fee line) and "$1,490
   * in dollars" (a real Mindy sale). No per-value rule can separate those — a
   * first attempt blocklisted the fee amounts and wrongly dropped the genuine
   * $149 price.
   *
   * So do not try. Take the MAX charge per customer under BOTH readings and
   * apply the floor once, at the end. A fee line never wins a max against the
   * real charge it accompanies, and a lone real charge is never dropped.
   */
  const asCents = (v: number | null): number => {
    const n = Number(v) || 0;
    return n >= 1000 ? n : n * 100;
  };

  // Best real charge per customer, ignoring superseded duplicates.
  const best = new Map<string, { cents: number; product: string | null; at: string }>();
  for (const p of purchases) {
    if (p.superseded_by) continue;
    const email = String(p.user_email || '').toLowerCase().trim();
    if (!email) continue;
    const amt = asCents(p.amount_paid);
    const cur = best.get(email);
    if (!cur || amt > cur.cents) best.set(email, { cents: amt, product: p.product_name, at: p.created_at });
  }

  const now = Date.now();
  const payers: UnonboardedPayer[] = [];
  for (const [email, buy] of best) {
    // Floor applied ONCE, on the customer's best charge — see asCents().
    if (buy.cents < MIN_PAID_CENTS) continue;
    const s = settingsBy.get(email);
    const targeting = s
      ? (s.naics_codes?.length ?? 0) + (s.keywords?.length ?? 0) + (s.agencies?.length ?? 0)
      : 0;
    // Fully wired up — nothing to report.
    if (s && targeting > 0) continue;

    payers.push({
      email,
      paidCents: buy.cents,
      productName: buy.product,
      purchasedAt: buy.at ?? null,
      daysSilent: buy.at ? Math.floor((now - new Date(buy.at).getTime()) / 86400000) : 0,
      hasProfile: profileSet.has(email),
      hasSettings: Boolean(s),
      targetingCount: targeting,
      creditBalance: balanceBy.get(email) ?? 0,
      needs: !s ? 'both' : 'targeting',
    });
  }

  // Biggest spend first — that is the one to call.
  payers.sort((a, b) => b.paidCents - a.paidCents);
  return { payers, checked: best.size };
}

export function formatUnonboarded(payers: UnonboardedPayer[]): string {
  return payers
    .map((p) => {
      const fix = p.needs === 'both'
        ? 'no settings row AND no targeting — needs onboarding; a grant alone does nothing'
        : 'reachable but zero targeting — a briefing would be generic';
      return `${p.email} — $${(p.paidCents / 100).toLocaleString()} (${p.productName ?? 'unknown'}) · `
        + `${p.daysSilent}d since purchase · ${p.creditBalance} credits · ${fix}`;
    })
    .join('\n');
}

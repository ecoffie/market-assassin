/**
 * "Entitled but silent" — paying customers who can receive briefings and don't.
 *
 * THE GAP THIS DETECTS
 * THREE things have to agree for a briefing to go out, and nothing checks that
 * they do:
 *   user_profiles.access_briefings               = the ENTITLEMENT (what they bought)
 *   user_notification_settings.briefings_enabled = the DELIVERY PREFERENCE
 *   customer_classifications.briefings_access    = the GATE the sender enforces
 * The audience query filters on the preference (delivery/rollout.ts —
 * `.eq('briefings_enabled', true)`) and then hard-filters again on the
 * classification gate, so a customer can be fully paid, fully entitled, and
 * skipped every single day with zero rows in briefing_log and no error anywhere.
 *
 * WHY THE THIRD FLAG IS HERE (2026-08-14)
 * This monitor originally checked only the first two and told us to "set
 * briefings_enabled=true" on 18 accounts. Flipping all 18 would have delivered
 * EXACTLY ZERO briefings: 17 of them were blocked by the classification gate,
 * and the 1 that passed it had no targeting. The monitor was confidently
 * proposing a no-op — the same silent-failure shape it was built to catch. A
 * fix that names the wrong blocker is worse than no fix, because it gets
 * applied and then reported as done. Report the blocker that is ACTUALLY
 * stopping delivery, per account.
 *
 * Found 2026-07-31 the expensive way: Xcelligen raised it on a call after a
 * meeting. An audit then found 11 entitled-but-not-enabled accounts, 7 of them
 * PAYING — including the owner of a $6,000 Mindy Teams workspace who was using
 * daily alerts (45 delivered) but had never once received a briefing. Every one
 * of them would have surfaced only when the customer complained.
 *
 * WHY IT ONLY REPORTS PAYING, ACTIVE, TARGETED ACCOUNTS
 * The raw divergence is noisy and mostly benign. Three deliberate exclusions:
 *  • not paying      — a free user with the flag off is a preference, not a bug.
 *  • is_active=false — that reads as an opt-out. Re-enabling delivery for
 *                      someone who switched it off is a spam complaint.
 *  • no targeting    — a briefing with no NAICS and no keywords is a generic
 *                      email; sending it looks worse than sending nothing.
 * What survives is the actionable set: someone paid, wants it, would get a good
 * briefing, and is being skipped anyway.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isBriefingEntitled } from './delivery/rollout';

/**
 * What is actually stopping this account from receiving — the thing to fix.
 *  • 'delivery_pref'  → briefings_enabled=false; flipping it IS sufficient.
 *  • 'entitlement'    → classification gate; flipping the pref changes nothing.
 *  • 'both'           → needs the classification row AND the pref, in that order.
 */
export type BriefingBlocker = 'delivery_pref' | 'entitlement' | 'both';

export interface EntitlementGapRow {
  email: string;
  /** The gate to fix. Fixing anything else delivers nothing. */
  blocker: BriefingBlocker;
  /** Current briefings_access, or null when there is no classification row. */
  briefingsAccess: string | null;
  /** Largest single purchase in cents — ranks the list by what is at stake. */
  paidCents: number;
  productName: string | null;
  naicsCount: number;
  keywordCount: number;
  /** Alerts already delivered — proof the account is live, not dormant. */
  alertsSent: number;
}

export interface EntitlementGapResult {
  /** Paying + active + targeted, and still not receiving. The actionable list. */
  actionable: EntitlementGapRow[];
  /** Entitled-but-not-enabled overall, before the exclusions above. */
  totalDiverged: number;
  /** Excluded because is_active=false (reads as an opt-out). */
  optedOut: number;
  /** Excluded because there is nothing to target a briefing with. */
  untargeted: number;
  /**
   * Of `actionable`, how many need a classification row before the delivery
   * preference means anything. If this equals actionable.length, then the
   * "just set briefings_enabled=true" advice would deliver nothing at all.
   */
  blockedOnEntitlement: number;
}

/** A purchase this small is a $1.49 test charge, not a customer. */
const MIN_PAID_CENTS = 1000;

export async function findEntitlementGaps(
  supabase: SupabaseClient,
): Promise<EntitlementGapResult> {
  const empty: EntitlementGapResult = { actionable: [], totalDiverged: 0, optedOut: 0, untargeted: 0, blockedOnEntitlement: 0 };

  const { data: profiles, error: pErr } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('access_briefings', true);
  if (pErr) {
    console.error('[entitlement-gap] user_profiles read failed:', pErr.message);
    return empty;
  }
  if (!profiles?.length) return empty;

  const entitled = profiles.map((p) => String(p.email).toLowerCase()).filter(Boolean);

  const { data: settings, error: sErr } = await supabase
    .from('user_notification_settings')
    .select('user_email, briefings_enabled, is_active, naics_codes, keywords, total_alerts_sent')
    .in('user_email', entitled);
  if (sErr) {
    console.error('[entitlement-gap] notification settings read failed:', sErr.message);
    return empty;
  }
  if (!settings) return empty;

  const diverged = settings.filter((s) => s.briefings_enabled !== true);
  if (!diverged.length) return empty;

  // Surface { error }, never just { data }. A renamed/missing column makes
  // PostgREST fail the WHOLE query → data=null → this check reports ZERO gaps
  // while paying customers keep receiving nothing. A monitor that fails silent
  // is worse than no monitor, and that is the exact bug it exists to catch.
  const { data: purchases, error: buyErr } = await supabase
    .from('purchases')
    .select('user_email, amount_paid, product_name')
    .in('user_email', diverged.map((s) => s.user_email));
  if (buyErr) {
    console.error('[entitlement-gap] purchases read failed — cannot classify paying accounts:', buyErr.message);
    return { ...empty, totalDiverged: diverged.length };
  }

  // Keep the LARGEST purchase per email so the list ranks by what is at risk.
  const topPurchase = new Map<string, { amount_paid: number; product_name: string | null }>();
  for (const p of purchases || []) {
    const amt = Number(p.amount_paid) || 0;
    if (amt <= MIN_PAID_CENTS) continue;
    const cur = topPurchase.get(p.user_email);
    if (!cur || amt > cur.amount_paid) {
      topPurchase.set(p.user_email, { amount_paid: amt, product_name: p.product_name ?? null });
    }
  }

  // The gate the SENDER actually enforces. Without this join the monitor cannot
  // tell "flip a flag and it works" from "flipping the flag changes nothing".
  const { data: classifications, error: cErr } = await supabase
    .from('customer_classifications')
    .select('email, briefings_access, briefings_expiry')
    .in('email', diverged.map((s) => s.user_email));
  if (cErr) {
    // Surface { error }, never just { data } — see the note above. Guessing
    // "entitled" here is what produced the no-op advice in the first place.
    console.error('[entitlement-gap] classifications read failed — cannot tell which gate blocks delivery:', cErr.message);
    return { ...empty, totalDiverged: diverged.length };
  }

  const classByEmail = new Map<string, { briefings_access: string | null; briefings_expiry: string | null }>();
  for (const c of classifications || []) {
    const key = String(c.email).toLowerCase().trim();
    classByEmail.set(key, { briefings_access: c.briefings_access ?? null, briefings_expiry: c.briefings_expiry ?? null });
  }

  const actionable: EntitlementGapRow[] = [];
  let optedOut = 0;
  let untargeted = 0;
  let blockedOnEntitlement = 0;

  for (const s of diverged) {
    const paid = topPurchase.get(s.user_email);
    if (!paid) continue;                       // free user — a preference, not a bug
    if (s.is_active === false) { optedOut++; continue; }
    const naicsCount = Array.isArray(s.naics_codes) ? s.naics_codes.length : 0;
    const keywordCount = Array.isArray(s.keywords) ? s.keywords.length : 0;
    if (naicsCount === 0 && keywordCount === 0) { untargeted++; continue; }

    const key = String(s.user_email).toLowerCase().trim();
    const cls = classByEmail.get(key);
    // No row at all is a distinct, common case: it reads as "not entitled".
    const entitled = cls ? isBriefingEntitled({ email: key, ...cls }) : false;
    if (!entitled) blockedOnEntitlement++;

    actionable.push({
      email: s.user_email,
      blocker: entitled ? 'delivery_pref' : 'both',
      briefingsAccess: cls ? cls.briefings_access : null,
      paidCents: paid.amount_paid,
      productName: paid.product_name,
      naicsCount,
      keywordCount,
      alertsSent: Number(s.total_alerts_sent) || 0,
    });
  }

  actionable.sort((a, b) => b.paidCents - a.paidCents);
  return { actionable, totalDiverged: diverged.length, optedOut, untargeted, blockedOnEntitlement };
}

/** Human-readable one-liner per row, biggest spend first. */
export function formatEntitlementGap(rows: EntitlementGapRow[]): string {
  return rows
    .map((r) => {
      const fix =
        r.blocker === 'delivery_pref'
          ? 'set briefings_enabled=true'
          : `grant classification first (briefings_access=${r.briefingsAccess ?? 'NO ROW'}), THEN briefings_enabled=true`;
      return (
        `${r.email} — $${(r.paidCents / 100).toLocaleString()} (${r.productName ?? 'unknown'}) · ` +
        `${r.naicsCount} NAICS / ${r.keywordCount} keywords · ${r.alertsSent} alerts delivered · FIX: ${fix}`
      );
    })
    .join('\n');
}

/**
 * What `customer_classifications.briefings_access` MEANS.
 *
 * THE PROBLEM THIS RESOLVES
 * The column carried two different concepts under one name, and code read
 * whichever it assumed:
 *   • a PURCHASED entitlement — lifetime / 1_year / subscription, earned by
 *     paying, and the thing an expiry legitimately applies to;
 *   • a GRANTED entitlement — beta_preview, handed out in bulk to people who
 *     never bought anything.
 * They behave differently and must not be conflated, but nothing said so, so
 * every reader invented its own rule. That is what produced the 2026-08-14
 * "entitled but undelivered" alert and the 66%-of-payers gap behind it.
 *
 * MEASURED 2026-08-15 (1,750 rows) — the numbers that set these rules:
 *   1,652 of 1,750 rows have NO qualifying purchase. This table is mostly
 *         GRANTS, not receipts. Treating it as purchase truth would have cut
 *         off most of the audience — a plan the data rejected.
 *     478 beta_preview rows, and beta_preview covers 106 of the 135 accounts
 *         CURRENTLY receiving. The free grant is load-bearing, not legacy junk.
 *   1,599 rows have a NULL expiry, which the sender reads as "never expires".
 *     148 rows are expired, and ZERO of them are still receiving — so expiry is
 *         honoured in practice and is not the thing that is broken.
 *       3 rows carry a FUTURE expiry and are actively receiving. Those are the
 *         real trap: they lapse silently, mid-service, with no warning and no
 *         renewal path (2026-12-31, 2027-01-16, 2027-07-18).
 *
 * THE RULE
 * Expiry is meaningful ONLY on a purchased, genuinely time-boxed entitlement
 * (1_year). On everything else it is noise: a granted tier either applies or is
 * revoked, and a null expiry is the honest representation of that. Never write
 * an expiry onto a grant, and never let one lapse silently on an active user —
 * surface it before it fires.
 */

/** Access tiers earned by paying. An expiry may legitimately apply. */
export const PURCHASED_TIERS = new Set(['lifetime', '1_year', 'subscription', '6_month']);

/** Access tiers handed out. These must never carry an expiry. */
export const GRANTED_TIERS = new Set(['beta_preview']);

/** Explicit states that are not entitlements at all. */
export const NON_ENTITLING = new Set(['none', 'excluded']);

/** Every value the sender accepts as entitling. Superset of the two above. */
export const ENTITLING_TIERS = new Set([...PURCHASED_TIERS, ...GRANTED_TIERS]);

export type AccessKind = 'purchased' | 'granted' | 'none';

export function accessKind(briefingsAccess: string | null | undefined): AccessKind {
  const a = (briefingsAccess || '').trim();
  if (PURCHASED_TIERS.has(a)) return 'purchased';
  if (GRANTED_TIERS.has(a)) return 'granted';
  return 'none';
}

/**
 * Should this row carry an expiry at all?
 *
 * Only a genuinely time-boxed purchase should. `lifetime` and `subscription`
 * are open-ended (a subscription ends by going inactive in Stripe, not by a
 * date we stamped months ago), and a grant is revoked by changing the tier.
 */
export function expiryIsMeaningful(briefingsAccess: string | null | undefined): boolean {
  return (briefingsAccess || '').trim() === '1_year';
}

export interface RowHealth {
  /** An expiry on a row where the concept does not apply — silent-cutoff risk. */
  spuriousExpiry: boolean;
  /** Entitled today, but a stamped date will end it with no renewal path. */
  lapsesOn: string | null;
  /** Already lapsed. */
  expired: boolean;
}

/**
 * Classify one row's expiry health. Pure so the monitor and any repair script
 * share one definition instead of re-deriving it (the mistake that let two
 * monitors disagree about what "entitled" meant).
 */
export function rowHealth(
  row: { briefings_access?: string | null; briefings_expiry?: string | null },
  now: number = Date.now(),
): RowHealth {
  const exp = row.briefings_expiry ? new Date(row.briefings_expiry).getTime() : null;
  const expired = exp !== null && exp <= now;
  const entitling = ENTITLING_TIERS.has((row.briefings_access || '').trim());
  return {
    spuriousExpiry: exp !== null && !expiryIsMeaningful(row.briefings_access),
    lapsesOn: exp !== null && !expired && entitling ? new Date(exp).toISOString().slice(0, 10) : null,
    expired,
  };
}

/**
 * D1 — the FROZEN legacy grandfather cohort (approved 2026-10-04).
 *
 * Membership is decided ONCE, from the R2 offline snapshot of 2026-10-04, and never
 * re-derived: a legacy key written later does not join the cohort. The cohort keeps exactly
 * today's behavior (policy.ts GRANDFATHER_CAPS) — it adds nothing and removes nothing.
 *
 * The member list (emails) lives in the private snapshot and in
 * entitlement_source_observations, never in this public repo.
 */
export const D1_COHORT_ID = 'd1-legacy-2026-10-04';

/** Sources that already give an account Mindy Pro/Team — such accounts are NOT D1. */
const MINDY_SOURCES = new Set([
  'stripe_pro', 'stripe_team', 'lifetime_mindy', 'founder', 'membership', 'manual_grant',
  'pro_unattributed', 'trial', 'staff', 'advocate',
]);

export interface SnapshotAccount {
  email: string;
  verifyTier: string;
  sources: string[];
}

/**
 * D1 = accounts whose ONLY path to today's "pro" on the verifyMIAccess gates is a legacy
 * product key: verifyMIAccess said pro, they hold ≥1 legacy:* source, and no Mindy source.
 */
export function selectGrandfatherCohort(accounts: SnapshotAccount[]): string[] {
  return accounts
    // Cohort SELECTION from a frozen snapshot, not a gate: exactly 'pro' is the legacy-key result;
    // a 'team' account holds stripe_team and is excluded by MINDY_SOURCES anyway.
    .filter((a) => a.verifyTier === 'pro') // tier-display-ok: snapshot cohort selection, not a gate
    .filter((a) => a.sources.some((s) => s.startsWith('legacy:')))
    .filter((a) => !a.sources.some((s) => MINDY_SOURCES.has(s)))
    .map((a) => a.email.toLowerCase().trim())
    .filter(Boolean)
    .sort();
}

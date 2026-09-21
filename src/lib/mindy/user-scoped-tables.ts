/**
 * The single source of truth for "every table row keyed by user_email."
 *
 * Extracted from api/admin/delete-mindy-user so that every account-level
 * operation that must touch ALL of a user's rows — hard-delete, change-email
 * re-key, future merge — reads the SAME list. The 2026-07-05 vault audit found
 * delete-mindy-user had silently drifted from the vault tables, leaving a
 * deleted user's most sensitive PII behind; a second copied list is exactly how
 * that happens. Import this; never re-declare it.
 *
 * VAULT tables (5) + Storage are handled separately via the shared vault-data
 * lib (VAULT_TABLES / deleteAllVaultData / re-key), because they carry PII and
 * Storage objects the plain UPDATE/DELETE sweep can't reach.
 */

// NON-VAULT tables keyed by a `user_email` column. Add here when a new
// user-scoped table is introduced — then delete, change-email, and merge all
// pick it up for free.
export const USER_EMAIL_TABLES = [
  'user_notification_settings',
  'user_business_profiles',
  'user_pipeline',
  'user_teaming_partners',
  'user_referrals',
  'user_engagement',
  'user_engagement_scores',
  // Deliberately over-inclusive: both are dead (user_alert_settings dropped;
  // user_briefing_profile never existed). A per-table error is caught + skipped.
  // If either is ever recreated, orphaned rows still get swept.
  'user_alert_settings',
  'user_briefing_profile',
  'mi_beta_user_settings',
  'mi_beta_team_members',
  'mi_beta_activity',
  'alert_log',
  'briefing_log',
  'briefing_feedback',
  'signup_events',
  // opportunity_shares has NO `user_email` column (its email is `sharer_email`),
  // so a `.eq('user_email',…)` delete/sweep errors-and-skips it. Kept in the list
  // to preserve delete-mindy-user's exact original behavior; the re-key layer
  // handles its real column (`sharer_email`) via EMAIL_OWNERSHIP_REFS.
  'opportunity_shares',
  'purchases',
] as const;

export type UserEmailTable = (typeof USER_EMAIL_TABLES)[number];

// The 5 Vault tables are ALSO keyed by user_email and must be re-keyed on a
// change-email. The canonical list lives in vault-data.ts (VAULT_TABLES) so it
// stays with the vault PII logic; re-export it here so account-level ops import
// ONE module for the full email-keyed surface. (Delete uses VAULT_TABLES
// directly via the vault lib; re-key uses this re-export.)
export { VAULT_TABLES as VAULT_EMAIL_TABLES } from '@/lib/vault/vault-data';

/**
 * Email-bearing columns that are NOT the row's own `user_email`. A change-email
 * re-key MUST update these too, or a renamed user's pipeline items / invites /
 * shares point at a dead address. This includes tables (like opportunity_shares)
 * whose OWN email column isn't literally named `user_email`.
 *
 * Column names are VERIFIED against the live schema (2026-07-13) — an inferred
 * name that doesn't exist silently no-ops the re-key (the PostgREST
 * missing-column trap). Re-verify before adding a row here.
 *
 * NOTE: `collaborators` on user_pipeline is a JSONB array of emails, not a
 * scalar column — it needs array-aware handling, NOT a flat .eq()/.update().
 * Flagged separately so the re-key lib treats it correctly.
 */
export const EMAIL_OWNERSHIP_REFS: ReadonlyArray<{ table: string; columns: string[] }> = [
  // user_pipeline: owner + audit-trail emails (verified: owner_email, created_by,
  // updated_by, bid_decided_by all exist and hold emails).
  { table: 'user_pipeline', columns: ['owner_email', 'created_by', 'updated_by', 'bid_decided_by'] },
  // mi_beta_team_members: the invite pair.
  { table: 'mi_beta_team_members', columns: ['invited_email', 'invited_by'] },
  // opportunity_shares: its OWN email column is `sharer_email` (no user_email,
  // no recipient-email column — verified). So it's re-keyed here, not in the
  // USER_EMAIL_TABLES sweep.
  { table: 'opportunity_shares', columns: ['sharer_email'] },
];

/**
 * JSONB array-of-email columns — re-keyed element-wise, not with a flat UPDATE.
 * Verified: user_pipeline.collaborators is an array.
 */
export const EMAIL_ARRAY_REFS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'user_pipeline', column: 'collaborators' },
];

/**
 * ONE introductory credit grant per Mindy account, whichever door it came through (2026-11-14).
 *
 * Until now the existing grant (MCP_SIGNUP_CREDITS, default 100; production does not override it and the
 * ledger shows 299 grants of 100) fired only on the first authenticated MCP touch: OAuth token, key mint, or a
 * tool request. People who registered through the Opportunity Map or /app never received it.
 *
 * This module issues the SAME grant at registration, through the SAME database function
 * (mcp_grant_signup_credits). That function claims the grant by inserting a 'signup_grant' ledger row under a
 * partial unique index (one per account), so a registration grant and a later MCP grant can never both land:
 * whichever runs first wins, the other grants 0. Nothing else about credits changes.
 *
 * Eligibility, all required:
 *   - the feature is enabled: SIGNUP_GRANT_AT_REGISTRATION_SINCE is set to a valid ISO timestamp (unset = off,
 *     so deploying this changes nothing until the cutover is chosen),
 *   - a real email (never an anonymous device id),
 *   - the account was created AT OR AFTER that cutover (existing accounts are never granted retroactively:
 *     balances and historical grants stay exactly as they are; a backfill would be a separate approved job),
 *   - the account is still inside its registration window (REGISTRATION_GRANT_WINDOW_DAYS), so a session
 *     refresh months later never reaches the database for this.
 * An unknown creation time is treated as NOT eligible: never assume an account is new.
 *
 * Credits are not an entitlement: this grant gives no Pro access and does not touch trials or subscriptions.
 */
import { after } from 'next/server';
import { grantSignupCreditsIfFirst } from './credits';

export const REGISTRATION_GRANT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export type RegistrationGrantDecision =
  | 'eligible'
  | 'disabled'
  | 'invalid_email'
  | 'unknown_created_at'
  | 'existing_account'
  | 'outside_registration_window';

/** The cutover from the environment, or null when unset or unparseable (feature off). */
export function registrationGrantSince(env: Record<string, string | undefined> = process.env): Date | null {
  const raw = (env.SIGNUP_GRANT_AT_REGISTRATION_SINCE || '').trim();
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function registrationGrantDecision(
  email: string | null | undefined,
  accountCreatedAt: string | null | undefined,
  opts: { now?: Date; since?: Date | null } = {},
): RegistrationGrantDecision {
  const since = opts.since === undefined ? registrationGrantSince() : opts.since;
  if (!since) return 'disabled';
  const e = String(email || '').trim().toLowerCase();
  if (!e.includes('@') || e.startsWith('anon:')) return 'invalid_email';
  const created = Date.parse(String(accountCreatedAt || ''));
  if (!Number.isFinite(created)) return 'unknown_created_at';
  if (created < since.getTime()) return 'existing_account';
  const now = (opts.now ?? new Date()).getTime();
  if (now - created > REGISTRATION_GRANT_WINDOW_DAYS * DAY_MS) return 'outside_registration_window';
  return 'eligible';
}

/**
 * Grant the introductory credits if this account is eligible. Never throws (it runs beside sign-in) and
 * never sends the MCP welcome email. Returns the credits granted (0 when not eligible or already granted).
 */
export async function grantRegistrationCreditsIfEligible(
  email: string,
  accountCreatedAt: string | null | undefined,
): Promise<{ granted: number; decision: RegistrationGrantDecision }> {
  const decision = registrationGrantDecision(email, accountCreatedAt);
  if (decision !== 'eligible') return { granted: 0, decision };
  try {
    const granted = await grantSignupCreditsIfFirst(email, { sendWelcome: false });
    return { granted, decision };
  } catch (err) {
    console.error('[registration-grant] grant failed:', (err as Error)?.message);
    return { granted: 0, decision };
  }
}

/** Run the grant after the sign-in response is sent, like the attribution claim beside it. */
export function scheduleRegistrationGrant(email: string, accountCreatedAt: string | null | undefined): void {
  // Cheap decision first: most sign-ins are existing accounts and never schedule anything.
  if (registrationGrantDecision(email, accountCreatedAt) !== 'eligible') return;
  const task = () => grantRegistrationCreditsIfEligible(email, accountCreatedAt).then(() => undefined);
  try { after(task); } catch { void task(); }
}

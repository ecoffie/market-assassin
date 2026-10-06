/**
 * IS THIS PROFILE ACTUALLY TARGETED? — the one classification behind the "finish setup" notice.
 *
 * It mirrors the daily-alerts gate rather than inventing a new one. That cron skips a user when
 *   knownNaicsForMatch(naics_codes).length === 0 && keywords.length === 0
 * (src/app/api/cron/daily-alerts/route.ts, "NO TARGETING → SKIP"). PSC codes do NOT satisfy it,
 * so a PSC-only profile is reported as `none` here too: saying alerts have started when the cron
 * skips them would be the same false-completeness the provenance column exists to end.
 *
 * States:
 *   - `none`           — the daily cron skips this user. Personalized alerts have not started.
 *   - `starter_codes`  — the codes are exactly the 5-code placeholder and nobody confirmed them
 *                        (naics_source system_default, or NULL — the email-signup write). Alerts
 *                        run, but on generic IT/admin codes, not on this business.
 *   - `targeted`       — anything else that passes the cron gate. This deliberately INCLUDES
 *                        NULL provenance with a non-starter set: provenance was simply not
 *                        recorded for most saves before 2026-10-06 (122 users saved their own
 *                        codes after the backfill and still read NULL), and nagging them would
 *                        punish a recording gap, not a missing profile.
 */
import { knownNaicsForMatch } from '@/lib/codes/validate-market-codes';
import { isPlaceholderNaicsSet } from './naics-provenance';

export type TargetingState = 'none' | 'starter_codes' | 'targeted';

export interface TargetingInput {
  naics_codes?: readonly unknown[] | null;
  keywords?: readonly unknown[] | null;
  naics_source?: string | null;
}

export function targetingStateFrom(row: TargetingInput | null | undefined): TargetingState {
  if (!row) return 'none';
  const naics = knownNaicsForMatch((row.naics_codes || []).map(String));
  const keywords = (row.keywords || []).map((k) => String(k).trim()).filter(Boolean);
  if (naics.length === 0 && keywords.length === 0) return 'none';
  if (
    isPlaceholderNaicsSet(row.naics_codes)
    && row.naics_source !== 'user_confirmed'
    && row.naics_source !== 'derived_suggestion'
  ) {
    return 'starter_codes';
  }
  return 'targeted';
}

/** The sentence a surface may show. Null = say nothing (the profile is targeted). */
export function targetingNotice(state: TargetingState, alertsOn: boolean | null): string | null {
  if (state === 'none') {
    return alertsOn
      ? 'Your personalized alerts haven’t started yet. Mindy doesn’t know what your business does — add a short description or a few codes and your daily alerts begin with the next run.'
      : 'Mindy doesn’t know what your business does yet, so it can’t personalize your matches. Add a short description or a few codes.';
  }
  if (state === 'starter_codes') {
    return alertsOn
      ? 'Your alerts are using starter codes (general IT and admin services), not your business. Confirm or replace them so your alerts match what you actually do.'
      : 'Your profile has starter codes (general IT and admin services), not your business. Confirm or replace them.';
  }
  return null;
}

/** The direct path to finish setup. /app is not a valid post-setup destination (legacy surface). */
export const TARGETING_SETUP_PATH = '/welcome/company';

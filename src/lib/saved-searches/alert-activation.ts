/**
 * ONE rule for "may this saved search send email alerts?" (P0 release fix, 2026-11-14).
 *
 * The signed-in Save path (createSavedSearch) refused filters the alert engine cannot honor, but two other
 * ways a watch could start alerting did not apply the same checks:
 *   - claiming anonymous watches at sign-in (claimAnonWatch) checked only the horizons, so an anonymous row
 *     holding map-only keys (valueRange, office, …) or a whole-market scope became an ALERTING watch;
 *   - a verified-email save through /api/app/map-watch stored alerts on with only value-shape checks.
 *
 * Both now call this module. A watch alerts only if:
 *   1. its horizons can be emailed (alertableScope: recompete is never emailed),
 *   2. its filters pass the same validator the signed-in path uses (allowlist, value shapes, NAICS,
 *      strategy strands, at least one narrowing filter), and
 *   3. a profile-scoped watch has at least one NAICS code on the owner's profile.
 * Anything else is refused or kept with alerts OFF; it is never broadened to make it fit.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateSavedSearchFilters } from './validate-filters';
import { alertableScope, isProfileScopedFilters } from './alert-scope';
import type { SavedSearchMode } from './constants';
import type { SavedSearchFilters } from './types';

export type AlertActivationRefusal = {
  code: 'unsupported_alert_scope' | 'invalid_filters' | 'profile_scope_unavailable';
  /** invalid_filters only: the validator's reason (see ValidateFiltersFailureReason). */
  reason?: string;
  /** invalid_filters only: refused key NAMES, never values. */
  keys?: string[];
};

export type AlertActivationPlan =
  | { ok: true; kind: 'full' | 'partial'; filters: SavedSearchFilters; profileScoped: boolean }
  | { ok: false; refusal: AlertActivationRefusal };

/** Steps 1 and 2: pure, no I/O. `partial` = recompete was removed (the client disclosed this first). */
export function alertActivationPlan(mode: SavedSearchMode, filters: SavedSearchFilters | null): AlertActivationPlan {
  const scope = alertableScope(mode, filters || {});
  if (scope.kind === 'none' || !scope.filters) return { ok: false, refusal: { code: 'unsupported_alert_scope' } };
  const v = validateSavedSearchFilters(scope.filters);
  if (!v.ok) return { ok: false, refusal: { code: 'invalid_filters', reason: v.reason, keys: v.keys } };
  return { ok: true, kind: scope.kind, filters: v.filters, profileScoped: isProfileScopedFilters(v.filters) };
}

/**
 * Step 3. true = the owner's profile has at least one NAICS code; false = none; null = UNKNOWN (the read
 * failed). Callers must treat null as "cannot activate", never as yes (Bug Prevention Rule #11).
 */
export async function profileHasNaics(db: SupabaseClient, email: string): Promise<boolean | null> {
  const { data, error } = await db
    .from('user_notification_settings')
    .select('naics_codes')
    .eq('user_email', email.trim().toLowerCase())
    .maybeSingle();
  if (error) return null;
  const codes = (data as { naics_codes?: unknown } | null)?.naics_codes;
  return Array.isArray(codes) && codes.some((c) => typeof c === 'string' && c.trim() !== '');
}

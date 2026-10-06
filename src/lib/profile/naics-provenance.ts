/**
 * NAICS PROVENANCE ON A USER SAVE — what an explicit save says about where codes came from.
 *
 * ── WHY THIS EXISTS (Track 3, 2026-10-06) ──────────────────────────────────────────────
 * `naics_source` was added on 2026-08-26 and labelled ONCE, by `scripts/backfill-naics-source.mts`.
 * After that, no live write path set it except company setup. Measured on production:
 *   - every September–October signup carrying the 5-code placeholder came through the EMAIL
 *     signup path (`ensureMindyFreeProfile`) with `naics_source = NULL` — 64 of 64;
 *   - users who saved their OWN codes in onboarding / settings also landed with NULL, so a
 *     real choice and an untouched placeholder read identically.
 * Placeholder codes with NULL provenance are exactly the "false completeness" the column was
 * created to end: matching and analytics treat them as a real profile.
 *
 * The rule here is deliberately narrow:
 *   - an explicit save that CHANGES the code set is a statement by the user -> `user_confirmed`;
 *   - unless the new set is exactly the placeholder, which is never a statement -> `system_default`;
 *   - re-sending the UNCHANGED set (saving frequency, alerts, keywords…) says nothing new, so
 *     provenance is left as it was. Otherwise an unrelated settings save would promote a
 *     `derived_suggestion` (or a placeholder) to `user_confirmed`;
 *   - clearing the codes clears the claim -> NULL.
 */
import { DEFAULT_PROFILE_NAICS } from '@/lib/alerts/profile-setup';
import type { NaicsProvenance } from './company-setup-outcome';

const PLACEHOLDER_KEY = [...DEFAULT_PROFILE_NAICS].sort().join(',');

function setKey(codes: readonly unknown[] | null | undefined): string {
  return [...new Set((codes || []).map((c) => String(c).trim()).filter(Boolean))].sort().join(',');
}

/** True when the codes are exactly the 5-code placeholder (order and duplicates ignored). */
export function isPlaceholderNaicsSet(codes: readonly unknown[] | null | undefined): boolean {
  return setKey(codes) === PLACEHOLDER_KEY;
}

/**
 * Provenance to write alongside a user-initiated NAICS write.
 * `undefined` = leave `naics_source` untouched (the code set did not change).
 */
export function naicsSourceForUserWrite(
  next: readonly unknown[] | null | undefined,
  previous: readonly unknown[] | null | undefined,
): NaicsProvenance | null | undefined {
  const nextKey = setKey(next);
  if (nextKey === setKey(previous)) return undefined;
  if (!nextKey) return null;
  if (nextKey === PLACEHOLDER_KEY) return 'system_default';
  return 'user_confirmed';
}

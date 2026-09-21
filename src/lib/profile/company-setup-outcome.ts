/**
 * COMPANY SETUP — what each Screen-2 action writes, and what it must NOT.
 *
 * ── THE RULE (Eric, 2026-08-25) ────────────────────────────────────────────────────────
 * **Skip is not acceptance.** A derived suggestion must not enter the user's ACTIVE
 * profile just because Mindy generated it and the user walked away.
 *
 * Writing `derived_suggestion` on skip would recreate the exact defect this provenance
 * column was added to end, one level more sophisticated:
 *
 *     the old system said   "these five defaults exist, therefore this user has NAICS"
 *     the new one would say "Mindy suggested these, therefore this user has NAICS"
 *
 * Same category error. Measured cost of the first version: 7,928 of 9,778 users (81.1%)
 * carrying an identical placeholder that nobody chose, while every downstream reader
 * treated `naics_codes IS NOT NULL` as evidence of personalization.
 *
 * ── THE THREE OUTCOMES ─────────────────────────────────────────────────────────────────
 *   confirm    user reviewed and accepted (possibly after removing items)
 *              -> retained items become ACTIVE, provenance `user_confirmed`
 *   accept_all "use Mindy's suggestions for now" — populated, not individually reviewed
 *              -> retained items become ACTIVE, provenance `derived_suggestion`
 *   skip       -> NOTHING is written to the active profile. No provenance is claimed.
 *
 * The resulting trust hierarchy is real and downstream matching can weight it:
 *     user_confirmed  >  derived_suggestion  >  system_default
 *
 * ⚠️ `system_default` is LEGACY-ONLY. This flow must never create a new one — that value
 * exists to describe rows written before the user was ever asked.
 */

export type NaicsProvenance = 'user_confirmed' | 'derived_suggestion' | 'system_default';
export type SetupAction = 'confirm' | 'accept_all' | 'skip';

export interface SetupSelection {
  /** Codes still on screen after the user removed any that did not fit. */
  naicsCodes?: string[];
  keywords?: string[];
  pscCodes?: string[];
}

export interface SetupWrite {
  /** Fields to write to the ACTIVE profile. Empty object = write nothing. */
  profile: {
    naics_codes?: string[];
    keywords?: string[];
    psc_codes?: string[];
    naics_source?: NaicsProvenance;
  };
  /** True when the active profile must be left exactly as it was. */
  writesNothing: boolean;
  /** Plain-language account of the decision, for logging and for the caller to surface. */
  reason: string;
}

const clean = (xs: string[] | undefined): string[] =>
  [...new Set((xs || []).map((x) => String(x).trim()).filter(Boolean))];

/**
 * Decide what a Screen-2 action writes. Pure — no I/O, no defaults invented.
 *
 * Deliberately returns an EMPTY profile for skip rather than a partial one: a caller that
 * spreads `{...result.profile}` into an update must produce a no-op, not a silent write.
 */
export function resolveSetupWrite(action: SetupAction, selection: SetupSelection = {}): SetupWrite {
  const naics = clean(selection.naicsCodes);
  const keywords = clean(selection.keywords);
  const psc = clean(selection.pscCodes);

  // ── SKIP: we learned nothing, so the profile must say nothing. ──
  if (action === 'skip') {
    return {
      profile: {},
      writesNothing: true,
      reason: 'skipped — suggestions were not reviewed, so nothing enters the active profile',
    };
  }

  // Nothing retained is indistinguishable from a skip, whichever button was pressed:
  // confirming an empty list is not a statement about the company.
  if (!naics.length && !keywords.length && !psc.length) {
    return {
      profile: {},
      writesNothing: true,
      reason: 'no suggestions retained — nothing to write',
    };
  }

  const naics_source: NaicsProvenance = action === 'confirm' ? 'user_confirmed' : 'derived_suggestion';

  const profile: SetupWrite['profile'] = {};
  if (naics.length) { profile.naics_codes = naics; profile.naics_source = naics_source; }
  if (keywords.length) profile.keywords = keywords;
  if (psc.length) profile.psc_codes = psc;

  return {
    profile,
    writesNothing: false,
    reason: action === 'confirm'
      ? `user reviewed and accepted ${naics.length} NAICS / ${keywords.length} keyword(s)`
      : `user accepted Mindy's suggestions without individual review (${naics.length} NAICS)`,
  };
}

/**
 * Rank provenance for downstream matching. Higher = more trustworthy as a statement of
 * what the company actually does. Unknown provenance sorts BELOW a system default: at
 * least a default is a known-unknown, where null is unexamined.
 */
export function provenanceRank(p: NaicsProvenance | null | undefined): number {
  switch (p) {
    case 'user_confirmed': return 3;
    case 'derived_suggestion': return 2;
    case 'system_default': return 1;
    default: return 0;
  }
}

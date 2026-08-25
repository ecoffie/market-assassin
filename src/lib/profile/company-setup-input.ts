/**
 * COMPANY SETUP — Screen 1 inputs, and the small amount of meaning they carry.
 *
 * Kept out of the component so the semantics are testable without rendering, and so the
 * locked write-path logic in `company-setup-outcome.ts` stays the only thing deciding
 * what reaches the ACTIVE profile.
 */

/** SBA/SAM programs a user can declare on Screen 1. */
export const DECLARABLE_CERTIFICATIONS = ['8(a)', 'HUBZone', 'WOSB', 'SDVOSB', 'VOSB'] as const;
export type DeclarableCertification = (typeof DECLARABLE_CERTIFICATIONS)[number];

/**
 * Certifications are TRI-STATE, deliberately.
 *
 *   ['8(a)']  the user declared 8(a)
 *   []        the user declared NONE ("None of these") — a real negative
 *   null      the user did not answer
 *
 * ⚠️ `[]` and `null` are different answers, and collapsing them is the same mistake as
 * `count ?? 0`: an unanswered question would read as "this company holds no
 * certifications", which is a claim we cannot defend.
 *
 * ⚠️ These are USER-DECLARED, not authoritative. SAM holds the real 8(a)/HUBZone status
 * (see certification-dates.ts — 8(a) currency is measured there). We ask because we do not
 * have the user's UEI at signup; reconciliation against SAM happens later once we do, and
 * SAM wins on conflict.
 */
export type CertificationAnswer = DeclarableCertification[] | null;

export interface CompanySetupInput {
  companyName?: string | null;
  /** Plain-language description. The ONLY field that does real derivation work. */
  description?: string | null;
  certifications?: CertificationAnswer;
  /** null = nationwide (the default), [] is never meaningful here. */
  states?: string[] | null;
}

/** What Screen 1 writes. Every field is user-entered; none is derived. */
export interface CompanySetupWrite {
  company_name?: string;
  business_description?: string;
  set_aside_preferences?: string[];
  location_states?: string[];
  /** Recorded so a later SAM reconciliation knows this was a claim, not a lookup. */
  certifications_declared_at?: string;
}

const trim = (v: string | null | undefined) => String(v ?? '').trim();

/**
 * Build the Screen-1 write. Returns ONLY fields the user actually supplied — an untouched
 * input must not overwrite an existing profile value with a blank.
 */
export function resolveSetupInput(input: CompanySetupInput, now = new Date().toISOString()): CompanySetupWrite {
  const out: CompanySetupWrite = {};
  const name = trim(input.companyName);
  const desc = trim(input.description);
  if (name) out.company_name = name;
  if (desc) out.business_description = desc;

  // null = unanswered -> write nothing. [] = declared none -> write the empty array, which
  // is a real answer and must be distinguishable from never having been asked.
  if (Array.isArray(input.certifications)) {
    out.set_aside_preferences = [...input.certifications];
    out.certifications_declared_at = now;
  }

  // Nationwide is the absence of a state filter, so only a non-empty list is written.
  if (Array.isArray(input.states) && input.states.length) {
    out.location_states = [...new Set(input.states.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  }
  return out;
}

/** True when the user gave Mindy enough to derive a market from. */
export function canDeriveMarket(input: CompanySetupInput): boolean {
  return trim(input.description).length >= 8;
}

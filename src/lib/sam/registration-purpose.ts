/**
 * SAM registration PURPOSE — may this registration receive a federal CONTRACT?
 *
 * WHY THIS EXISTS (2026-11-23). Production lookup_sam_entity for an active 8(a) firm returned
 * purposeOfRegistration "Federal Assistance Awards", an empty CAGE and no NAICS. Nobody told the
 * customer the registration is assistance-only, and find_opportunities(uei) then read every
 * set-aside as UNKNOWN with a bare "size unavailable" reason.
 *
 * SAM's structured field is `entityRegistration.purposeOfRegistrationCode` (+ `...Desc`).
 * Measured on the SAM V2 extract (entity-extract-layout.ts, 120K lines): Z2 72.0% · Z1 28.0% ·
 * Z3 0.1% · Z4/Z5 ~0%. Z1 has NO NAICS in 99.86% of cases; Z2 has NAICS in 100%.
 *
 * TRUTH RULES
 *   - Only codes whose meaning is established in this repo's fixtures/measurements are decided by
 *     CODE: Z1 = "Federal Assistance Awards", Z2 = "All Awards". Any other code is decided only
 *     by SAM's own description text, or left unknown.
 *   - Field absent → `unknown`, never a warning. A missing purpose is not "assistance only".
 *   - The warning quotes SAM's field. The FAR sentence is FAR 4.1102(a) as published on
 *     acquisition.gov (FAC 2026-01, eff. 03/13/2026), verified 2026-11-23: "Offerors and quoters
 *     are required to be registered in SAM at the time an offer or quotation is submitted in order
 *     to comply with the annual representations and certifications requirements". FAR itself
 *     does not name SAM's "All Awards" purpose, so the warning does not claim it does.
 */

export type ContractAwardRegistration = 'registered' | 'not_registered' | 'unknown';

export interface RegistrationPurposeReadiness {
  /** SAM purposeOfRegistrationCode, verbatim (null = SAM did not send it). */
  purpose_code: string | null;
  /** SAM purposeOfRegistrationDesc, verbatim (null = SAM did not send it). */
  purpose_description: string | null;
  /** Whether SAM's purpose covers contract awards. `unknown` when the field is absent/unrecognized. */
  contract_awards: ContractAwardRegistration;
  /** Present only when SAM positively says the registration is not for contract awards. */
  warning?: string;
  /** Present only when contract_awards is unknown: says so, so silence is never read as "fine". */
  note?: string;
}

const CODE_MEANING: Record<string, ContractAwardRegistration> = {
  Z1: 'not_registered', // Federal Assistance Awards
  Z2: 'registered',     // All Awards
};

const clean = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
};

function fromDescription(desc: string | null): ContractAwardRegistration {
  if (!desc) return 'unknown';
  if (/\ball awards\b/i.test(desc)) return 'registered';
  if (/^federal assistance awards$/i.test(desc)) return 'not_registered';
  return 'unknown';
}

/** True when SAM positively lists the registration as not covering contract awards. */
export function isAssistanceOnly(r: Pick<RegistrationPurposeReadiness, 'contract_awards'> | null | undefined): boolean {
  return r?.contract_awards === 'not_registered';
}

/**
 * Classify SAM's purpose-of-registration fields. Code wins when it is one we have established;
 * otherwise SAM's own description decides; otherwise unknown.
 */
export function registrationPurposeReadiness(code: unknown, description: unknown): RegistrationPurposeReadiness {
  const purpose_code = clean(code)?.toUpperCase() ?? null;
  const purpose_description = clean(description);
  const byCode = purpose_code ? CODE_MEANING[purpose_code] : undefined;
  const contract_awards: ContractAwardRegistration = byCode ?? fromDescription(purpose_description);

  const base: RegistrationPurposeReadiness = { purpose_code, purpose_description, contract_awards };
  if (contract_awards === 'not_registered') {
    const label = purpose_description || 'Federal Assistance Awards';
    const field = purpose_code ? `purposeOfRegistrationCode ${purpose_code}` : 'purposeOfRegistrationDesc';
    base.warning =
      `SAM lists this registration's purpose as ${label} only (${field}): it is not registered for contract awards. `
      + 'FAR 4.1102(a) requires offerors to be registered in SAM, for the annual representations and certifications, '
      + 'at the time an offer is submitted; SAM\'s purpose that covers contracts is "All Awards", so competing for a '
      + 'federal contract would first need this registration updated to All Awards.';
  } else if (contract_awards === 'unknown') {
    base.note = purpose_code || purpose_description
      ? `SAM's registration purpose (${[purpose_code, purpose_description].filter(Boolean).join(' / ')}) is not one this check interprets, so whether it covers contract awards is unknown.`
      : 'SAM did not return a registration purpose for this record, so whether it is registered for contract awards is unknown.';
  }
  return base;
}

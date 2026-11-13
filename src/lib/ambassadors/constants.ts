/** Shared by the ambassadors form (client) and its validation (server). */

/** A SAM Unique Entity ID: 12 characters, letters and digits. Checked after upper-casing and
 *  removing spaces and dashes. */
export const UEI_RE = /^[A-Z0-9]{12}$/;

/** Normalize what an applicant typed into a UEI candidate ("abc1-2345 6789" → "ABC123456789"). */
export function normalizeUei(v: string): string {
  return v.toUpperCase().replace(/[\s-]/g, '');
}

/** The confirmation every applicant ticks (Section 9 of the Ambassador Program document). */
export const ATTESTATION = 'I meet all six requirements and will disclose on every post.';

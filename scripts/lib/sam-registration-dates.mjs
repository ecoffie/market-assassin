/**
 * Registration dates + purpose from one SAM public entity extract record.
 *
 * Pure, so it can be unit-tested without running the importer (which downloads the extract
 * and connects to Supabase at import time).
 *
 * Indices are ZERO-BASED against `line.split('|')` and match SAM_EXTRACT_FIELDS in
 * src/lib/sam/entity-extract-layout.ts (purposeOfRegistrationCode 6, registrationDate 7,
 * activationDate 10, initialRegistrationDate 24). Keep the two in step.
 *
 * Anything that is not a well-formed value comes back null (= unknown), never a guess.
 */

const IDX = { purpose: 6, registration: 7, activation: 10, initialRegistration: 24 };

/** 'YYYYMMDD' → 'YYYY-MM-DD', or null when absent or not a real calendar date. */
export function samDate(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d{8}$/.test(s)) return null;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** SAM purposeOfRegistration code (Z1..Z5), or null. */
export function samPurpose(raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  return /^Z[1-5]$/.test(s) ? s : null;
}

/** The columns this record contributes to a sam_entities row. */
export function registrationColumns(fields) {
  return {
    purpose_of_registration: samPurpose(fields[IDX.purpose]),
    sam_registration_date: samDate(fields[IDX.registration]),
    sam_activation_date: samDate(fields[IDX.activation]),
    initial_registration_date: samDate(fields[IDX.initialRegistration]),
  };
}

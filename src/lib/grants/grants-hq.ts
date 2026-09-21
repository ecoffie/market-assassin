/**
 * Grants have NO place of performance (they're national funding opportunities), so we plot each at
 * its AWARDING DEPARTMENT's real HQ city — clearly flagged "agency HQ · approximate" on the map, the
 * same honest treatment SBIR topics get (src/lib/sbir/sbir-map-pins.ts). Keyed on the agencyCode's
 * DEPARTMENT PREFIX (the part before the first '-': "DOS-BIH" → "DOS"), because the full agency name
 * is a granular sub-bureau. Most federal departments are DC-based; a few have a distinct HQ.
 *
 * Coords are resolved from these city/state pairs via the shared geocodeCity() (real, never guessed).
 * (Eric 2026-07-31 — "store the grants" as a first-class map source.)
 */
export const GRANTS_DEPT_HQ: Record<string, { city: string; state: string; label: string }> = {
  HHS:   { city: 'Washington', state: 'DC', label: 'Health & Human Services' },
  DOS:   { city: 'Washington', state: 'DC', label: 'State Department' },
  USDA:  { city: 'Washington', state: 'DC', label: 'Agriculture' },
  DOI:   { city: 'Washington', state: 'DC', label: 'Interior' },
  USDOJ: { city: 'Washington', state: 'DC', label: 'Justice' },
  DOJ:   { city: 'Washington', state: 'DC', label: 'Justice' },
  DOD:   { city: 'Arlington', state: 'VA', label: 'Defense (Pentagon)' },
  DOL:   { city: 'Washington', state: 'DC', label: 'Labor' },
  DOT:   { city: 'Washington', state: 'DC', label: 'Transportation' },
  DOE:   { city: 'Washington', state: 'DC', label: 'Energy' },
  ED:    { city: 'Washington', state: 'DC', label: 'Education' },
  DHS:   { city: 'Washington', state: 'DC', label: 'Homeland Security' },
  HUD:   { city: 'Washington', state: 'DC', label: 'Housing & Urban Development' },
  VA:    { city: 'Washington', state: 'DC', label: 'Veterans Affairs' },
  EPA:   { city: 'Washington', state: 'DC', label: 'Environmental Protection' },
  DOC:   { city: 'Washington', state: 'DC', label: 'Commerce' },
  TREAS: { city: 'Washington', state: 'DC', label: 'Treasury' },
  SBA:   { city: 'Washington', state: 'DC', label: 'Small Business Administration' },
  NASA:  { city: 'Washington', state: 'DC', label: 'NASA' },
  NSF:   { city: 'Alexandria', state: 'VA', label: 'National Science Foundation' },
  IMLS:  { city: 'Washington', state: 'DC', label: 'Institute of Museum & Library Services' },
  NEA:   { city: 'Washington', state: 'DC', label: 'National Endowment for the Arts' },
  NEH:   { city: 'Washington', state: 'DC', label: 'National Endowment for the Humanities' },
  IVV:   { city: 'Washington', state: 'DC', label: 'AmeriCorps' },     // Corporation for National & Community Service
  MCC:   { city: 'Washington', state: 'DC', label: 'Millennium Challenge Corporation' },
};

// The federal seat of government — where an unmapped department's grant honestly defaults (nearly
// every federal HQ is in the DC/NCR area, so this is a truthful fallback, not a fabrication).
export const GRANTS_DEFAULT_HQ = { city: 'Washington', state: 'DC', label: 'Federal agency' };

/** Resolve a grant's HQ city/state from its agencyCode (department prefix). */
export function grantsHqFor(agencyCode: string | null | undefined): { city: string; state: string; label: string } {
  const prefix = String(agencyCode || '').split('-')[0].trim().toUpperCase();
  return GRANTS_DEPT_HQ[prefix] || GRANTS_DEFAULT_HQ;
}

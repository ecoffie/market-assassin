/**
 * Display name for a raw agency / department string on the Opportunity Map.
 *
 * SAM Open + Recompete rows are full names ("DEPARTMENT OF JUSTICE" → "Justice").
 * Forecasts often store only the source_agency code ("DOJ", "DHS"). Running those
 * codes through the same title-caser produced "Doj" / "Dhs" on hover — not the
 * Open/Recompete convention (Eric 2026-08-13).
 *
 * Grounded: only rearranges / re-cases / expands a known abbrev of the row's own
 * value. Never invents an agency. Empty input returns ''.
 */
export const DEPT_ABBREV: Record<string, string> = {
  DOJ: 'Justice',
  DHS: 'Homeland Security',
  DOD: 'Defense',
  DOE: 'Energy',
  DOI: 'Interior',
  DOL: 'Labor',
  DOT: 'Transportation',
  DOS: 'State',
  VA: 'Veterans Affairs',
  HHS: 'Health And Human Services',
  USDA: 'Agriculture',
  HUD: 'Housing And Urban Development',
  USAF: 'Air Force',
};

const KEEP_ACRONYM =
  /^(?:NASA|GSA|EPA|FBI|CIA|IRS|FEMA|NOAA|NSF|NRC|SSA|SBA|OPM|USACE|ONR|NRL|DLA)$/;

export function shortAgencyName(dept: string): string {
  const d = (dept || '')
    .replace(/,?\s*DEPARTMENT OF( THE)?/i, '')
    .replace(/DEPARTMENT OF( THE)?\s*/i, '')
    .trim();
  if (!d) return dept || '';
  const key = d.replace(/\./g, '').toUpperCase();
  if (DEPT_ABBREV[key]) return DEPT_ABBREV[key];
  return (
    d.replace(/\b([A-Z])([A-Z0-9'&./-]*)/g, (m, a, b) => {
      if (/^(?:[A-Z]\.){2,}$/.test(m)) return m; // U.S. / U.S.C.
      if (KEEP_ACRONYM.test(m)) return m;
      return a + b.toLowerCase();
    }) || dept
  );
}

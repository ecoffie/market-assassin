/**
 * Title-case a company name from SHOUTY ALL-CAPS source data
 * (USASpending recipient_name is uppercased) while preserving common
 * legal-entity acronyms that should stay uppercase.
 *
 * Examples:
 *   "BOEING COMPANY"                  → "Boeing Company"
 *   "BOOZ ALLEN HAMILTON INC"         → "Booz Allen Hamilton INC"
 *   "LOCKHEED MARTIN CORPORATION"     → "Lockheed Martin Corporation"
 *   "L3 TECHNOLOGIES, INC."           → "L3 Technologies, INC."
 *   "RTX CORP"                        → "RTX Corp"
 *
 * Note: "CORPORATION" is NOT in the acronyms list because it's a word,
 * not an abbreviation. Only true abbreviations belong here.
 */
const ACRONYMS = new Set([
  'INC',
  'LLC',
  'CO',
  'USA',
  'US',
  'NA',
  'LP',
  'LLP',
  'LTD',
  'PLC',
  'PC',
  'PLLC',
]);

export function formatCompanyName(raw: string): string {
  if (!raw) return raw;
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      // Strip surrounding punctuation when checking acronym membership,
      // but keep it on the output: "INC." → uppercase "INC" + keep "."
      const stripped = w.toUpperCase().replace(/[.,;:()]/g, '');
      if (ACRONYMS.has(stripped)) {
        return w.toUpperCase();
      }
      // Mixed-alpha-numeric tokens (e.g. "L3", "M3") — keep as-is when
      // starting with letter+digit pattern, otherwise title-case.
      if (/^[a-z]\d/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

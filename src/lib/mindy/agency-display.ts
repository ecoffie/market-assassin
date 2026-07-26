export interface BuyerAgencyInput {
  agency?: string | null;
  department?: string | null;
  subTier?: string | null;
  sub_tier?: string | null;
  office?: string | null;
}

function cleanAgencyPart(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeAgencyPart(value?: string | null) {
  return cleanAgencyPart(value).toLowerCase();
}

function isDifferent(value?: string | null, compareTo?: string | null) {
  const normalizedValue = normalizeAgencyPart(value);
  const normalizedCompare = normalizeAgencyPart(compareTo);
  return Boolean(normalizedValue) && normalizedValue !== normalizedCompare;
}

export function getBuyerAgencyParts(input: BuyerAgencyInput) {
  const department = cleanAgencyPart(input.department || input.agency);
  const subTier = cleanAgencyPart(input.subTier || input.sub_tier);
  const office = cleanAgencyPart(input.office);
  const primary = subTier || office || department || 'Unknown agency';
  const secondary = isDifferent(office, primary) ? office : '';
  const parent = isDifferent(department, primary) ? department : '';

  return {
    primary,
    secondary,
    parent,
    full: [primary, secondary, parent].filter(Boolean).join(' • '),
  };
}

export function getBuyerAgencyLabel(input: BuyerAgencyInput) {
  return getBuyerAgencyParts(input).primary;
}

/**
 * Human-readable agency name for a raw `federal_contacts.department_ind_agency` value.
 *
 * SAM stores departments in an inverted, ALL-CAPS form: "STATE, DEPARTMENT OF",
 * "INTERIOR, DEPARTMENT OF THE", "TREASURY, DEPARTMENT OF THE". The opportunity-map's
 * client-side `clean()` stripped the ", DEPARTMENT OF" suffix and title-cased the rest —
 * which turns "STATE, DEPARTMENT OF" into the bare word "State", reading like a field
 * label rather than an agency ("Jenina Dosch · State · Seoul, DC"). This normalizes the
 * inverted form back to natural order — "STATE, DEPARTMENT OF" → "Department of State" —
 * and Title-Cases everything else, so the card/pin/drawer show a real agency name.
 *
 * Grounded: it only ever REARRANGES + re-cases the real stored string. It never invents
 * an agency, and an empty input returns '' (callers fall back to a neutral label).
 */
export function formatAgencyDisplay(raw?: string | null): string {
  const s = cleanAgencyPart(raw);
  if (!s) return '';

  // Inverted "<BODY>, DEPARTMENT OF [THE]" → "Department of [the] <BODY>".
  const inverted = s.match(/^(.*),\s*DEPARTMENT OF( THE)?\s*$/i);
  if (inverted) {
    const body = cleanAgencyPart(inverted[1]);
    const theThe = inverted[2] ? 'the ' : '';
    return `Department of ${theThe}${titleCaseAgency(body)}`;
  }

  return titleCaseAgency(s);
}

// Title-case an agency string while preserving well-known all-caps acronyms and the
// government's own lowercase joining words. "GENERAL SERVICES ADMINISTRATION" →
// "General Services Administration"; "EXPORT-IMPORT BANK OF THE US" → "Export-Import
// Bank of the US".
const AGENCY_ACRONYMS = new Set(['US', 'USA', 'DC', 'NASA', 'GSA', 'EPA', 'FBI', 'CIA', 'IRS', 'FEMA', 'NOAA', 'BBG', 'CHIP']);
const AGENCY_LOWER_WORDS = new Set(['of', 'the', 'and', 'for', 'to', 'from']);

function titleCaseAgency(s: string): string {
  const words = s.trim().split(/\s+/);
  return words
    .map((w, i) => {
      const upper = w.toUpperCase();
      const bare = upper.replace(/[^A-Z0-9]/g, '');
      if (AGENCY_ACRONYMS.has(bare)) return upper;
      const lower = w.toLowerCase();
      if (i > 0 && AGENCY_LOWER_WORDS.has(lower)) return lower;
      // Title-case each hyphen-separated segment (Export-Import).
      return lower.replace(/(^|[-/])([a-z0-9])/g, (_m, sep, ch) => sep + ch.toUpperCase());
    })
    .join(' ');
}

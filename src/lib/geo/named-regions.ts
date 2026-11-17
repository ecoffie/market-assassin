/**
 * Named US regions → explicit state lists (Agent 4 live S3, 2026-11-17).
 *
 * "...structured cabling in New England..." came back "results nationwide" (AR, MT): no layer turned the
 * region into states, so FIND searched every state. This table is the ONE place a region name becomes states.
 * It only scopes WHERE we search (the existing state filter); it never changes ranking.
 *
 * Definitions, chosen so a customer is not surprised:
 *   - New England, Northeast, Midwest, Mountain West, Pacific: U.S. Census Bureau regions/divisions.
 *   - Mid-Atlantic: Census Middle Atlantic (NY, NJ, PA) plus DE, MD, DC, the common federal-market usage.
 *   - DMV / National Capital Region / DC metro: DC, MD, VA (state level; there is no county filter).
 *   - Southeast: FEMA / GSA Region 4 (AL, FL, GA, KY, MS, NC, SC, TN).
 *   - Gulf Coast: the five Gulf states (TX, LA, MS, AL, FL).
 *   - Pacific Northwest: WA, OR, ID.  West Coast: CA, OR, WA.  Southwest: AZ, NM, TX, OK.
 *   - Great Lakes: the eight states bordering the Great Lakes.  Tri-State (NYC): NY, NJ, CT.
 * Compass regions (Northeast, Southeast, Southwest, Midwest) are NOT resolved when a capitalized place name
 * follows ("Southeast DC", "Northeast Ohio"): that is part of a place, not a multi-state region.
 * Ambiguous words that are also names (a bare "DMV" = motor vehicles; "NAVFAC Mid-Atlantic" = a Navy
 * command) are NOT resolved: DMV needs "the DMV" / "DMV area|region", and a region preceded by an
 * organization acronym (NAVFAC, USACE, GSA...) is treated as that organization's name.
 */
import { normalizeStateCode } from '@/lib/utils/us-states';

export type NamedRegion = { name: string; states: readonly string[] };

const R = (name: string, states: string[]): NamedRegion => ({ name, states });

/** Pattern → region. Order matters only for display; overlapping matches are unioned. */
export const NAMED_REGIONS: ReadonlyArray<{ re: RegExp; region: NamedRegion; compass?: boolean }> = [
  { re: /\bnew\s+england\b/i, region: R('New England', ['CT', 'ME', 'MA', 'NH', 'RI', 'VT']) },
  { re: /\bmid[\s-]?atlantic\b/i, region: R('Mid-Atlantic', ['NY', 'NJ', 'PA', 'DE', 'MD', 'DC']) },
  { re: /\b(?:the\s+DMV|DMV\s+(?:area|region)|national\s+capital\s+region|D\.?C\.?\s+metro(?:\s+area)?|DC[\s-]Maryland[\s-]Virginia)\b/i, region: R('DMV (DC, Maryland, Virginia)', ['DC', 'MD', 'VA']) },
  { re: /\bgulf\s+coast\b/i, region: R('Gulf Coast', ['TX', 'LA', 'MS', 'AL', 'FL']) },
  { re: /\bpacific\s+northwest\b|\bPNW\b/i, region: R('Pacific Northwest', ['WA', 'OR', 'ID']) },
  { re: /\bwest\s+coast\b/i, region: R('West Coast', ['CA', 'OR', 'WA']) },
  { re: /\bnorth[\s-]?east(?:ern)?\b/i, compass: true, region: R('Northeast', ['CT', 'ME', 'MA', 'NH', 'RI', 'VT', 'NJ', 'NY', 'PA']) },
  { re: /\bsouth[\s-]?east(?:ern)?\b/i, compass: true, region: R('Southeast', ['AL', 'FL', 'GA', 'KY', 'MS', 'NC', 'SC', 'TN']) },
  { re: /\bsouth[\s-]?west(?:ern)?\b/i, compass: true, region: R('Southwest', ['AZ', 'NM', 'TX', 'OK']) },
  { re: /\bmid[\s-]?west(?:ern)?\b/i, compass: true, region: R('Midwest', ['IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI']) },
  { re: /\bmountain\s+west\b|\brocky\s+mountain\s+(?:states|region)\b/i, region: R('Mountain West', ['AZ', 'CO', 'ID', 'MT', 'NV', 'NM', 'UT', 'WY']) },
  { re: /\bgreat\s+lakes\s+(?:states|region|area)\b/i, region: R('Great Lakes', ['IL', 'IN', 'MI', 'MN', 'NY', 'OH', 'PA', 'WI']) },
  { re: /\btri[\s-]?state\s+area\b/i, region: R('Tri-State (NY, NJ, CT)', ['NY', 'NJ', 'CT']) },
];

/** An organization acronym right before the region ("NAVFAC Mid-Atlantic", "USACE Southwest") names the org. */
const ORG_BEFORE = /\b(?:NAVFAC|NAVSUP|USACE|GSA|FEMA|EPA|HUD|DLA|VA|VISN|SPAWAR|NIWC|FLC|AFCEC|Region)\s*$/i;

/** Case-SENSITIVE: a capitalized place name right after a compass word ("Southeast DC", "Northeast Ohio"). */
const PLACE_AFTER = /^\s+(?!(?:Region|States|Area|US|U\.S\.|United)\b)[A-Z][A-Za-z]/;

/** Named regions in free text, in table order, de-duplicated. Pure. */
export function namedRegionsIn(text: string): NamedRegion[] {
  const src = String(text || '');
  const out: NamedRegion[] = [];
  for (const { re, region, compass } of NAMED_REGIONS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of src.matchAll(g)) {
      if (ORG_BEFORE.test(src.slice(0, m.index ?? 0))) continue;
      if (compass && PLACE_AFTER.test(src.slice((m.index ?? 0) + m[0].length))) continue;
      if (!out.includes(region)) out.push(region);
      break;
    }
  }
  return out;
}

/** The exact region for a whole token ("New England", "the DMV"), or null. Used by FIND's resolveRegion. */
export function regionForToken(token: string): NamedRegion | null {
  const t = String(token || '').trim();
  if (!t) return null;
  for (const { re, region } of NAMED_REGIONS) {
    const m = t.match(re);
    const core = t.replace(/^(?:the|in)\s+/i, '').replace(/\s+(?:states|region|area)$/i, '').trim();
    if (m && m[0].replace(/^the\s+/i, '').trim().length >= core.length - 1) return region;
  }
  return null;
}

/**
 * Location tokens → 2-letter state codes: a state name/code, or a named region expanded to its states.
 * Tokens that are neither are skipped. Pure; used by the chat intent layer to see what FIND already covers.
 */
export function resolveRegionStates(tokens: string[]): string[] {
  const out: string[] = [];
  for (const raw of tokens.flatMap((t) => String(t || '').split(/\s*[,;/|]\s*/))) {
    const t = raw.trim();
    if (!t) continue;
    const code = normalizeStateCode(t);
    const states = code ? [code] : (regionForToken(t)?.states ?? []);
    for (const st of states) if (!out.includes(st)) out.push(st);
  }
  return out;
}

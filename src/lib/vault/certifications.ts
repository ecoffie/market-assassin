/**
 * Vault certifications → federal set-aside eligibility codes.
 *
 * WHY THIS EXISTS
 * `user_identity_profile.certifications` is a free-text array the user types
 * into. Real values in prod (2026-07-31): "WOSB", but also "WOSB certified by
 * U.S. SBA", "SDVOSB;VOSB;WOSB" (three crammed into one entry), "SDVOSB.WOSB",
 * "SMALL BUSINESS", "M/WBE certified by SBA of NYC", and "NO" in the sibling
 * contract_vehicles field.
 *
 * That text is fine for a capability statement. It CANNOT be string-matched
 * against `recompete_opportunities.set_aside_type` ("8(a)", "SDVOSB", "WOSB",
 * "HUBZone", "SB-Total"…). "WOSB certified by U.S. SBA" would never equal
 * "WOSB", so an eligibility filter built on the raw field would silently hide
 * opportunities from people who ARE eligible — worse than no filter at all.
 *
 * So: normalize to the SAME controlled vocabulary the opportunity side uses,
 * keep the user's original text untouched, and treat anything unrecognized as
 * UNKNOWN rather than guessing.
 *
 * DELIBERATELY NOT MAPPED — these are real credentials but NOT federal
 * set-asides, and mapping them would claim eligibility a user does not have:
 *   • MBE / WBE / SBE / M/WBE  — state, city, or private programs
 *   • ISO 27001, SOC 2, CMMI   — quality/security attestations
 *   • FCL / facility clearance — a clearance, not a socio-economic set-aside
 * They stay in the raw list and are surfaced separately (see CREDENTIAL_TAGS),
 * because they DO matter for bidding — just not as set-aside eligibility.
 */

/** The controlled vocabulary — matches recompete_opportunities.set_aside_type. */
export type SetAsideCode =
  | 'SB-Total' | '8(a)' | 'SDVOSB' | 'VOSB' | 'WOSB' | 'EDWOSB'
  | 'HUBZone' | 'Indian-SB';

/**
 * Non-set-aside credentials worth keeping visible (clearances, quality marks).
 * These do not gate a set-aside but often gate a specific solicitation.
 */
export type CredentialTag = 'FCL' | 'ISO' | 'SOC2' | 'CMMI' | 'STATE-MWBE';

export interface NormalizedCertifications {
  /** Set-aside codes this company can claim, deduped. */
  setAsides: SetAsideCode[];
  /** Non-set-aside credentials found (clearances, ISO/SOC/CMMI, state programs). */
  credentials: CredentialTag[];
  /** Raw entries we could not classify — surfaced, never silently dropped. */
  unrecognized: string[];
}

/**
 * Ordered matchers. First match wins per token, so more specific patterns come
 * first: EDWOSB before WOSB (every EDWOSB contains "WOSB"), SDVOSB before VOSB.
 */
const SET_ASIDE_PATTERNS: Array<[RegExp, SetAsideCode]> = [
  [/\bedwosb\b|economically\s+disadvantaged\s+wom/i, 'EDWOSB'],
  [/\bsdvosb\b|service[-\s]?disabled/i, 'SDVOSB'],
  [/\bhub\s?zone\b/i, 'HUBZone'],
  // Tribal/ANC/Indian BEFORE plain 8(a): "SBA Tribal 8(a)" contains "8(a)", so
  // the generic pattern would win and the tribal lane would be lost. A tribal
  // 8(a) firm is BOTH — see the extra add below, which is why this one does not
  // simply break out of the loop.
  [/\btribal\b|\banc\b|alaska\s+native|indian\s+small/i, 'Indian-SB'],
  // 8(a) in its many typed forms: "8(a)", "8a", "SBA Tribal 8(a)".
  [/\b8\s*\(?\s*a\s*\)?\b/i, '8(a)'],
  [/\bwosb\b|\bwoman[-\s]?owned\b|\bwomen[-\s]?owned\b/i, 'WOSB'],
  [/\bvosb\b|veteran[-\s]?owned/i, 'VOSB'],
  // Small Business / SDB last — the broadest, and SDB is federally folded into
  // the 8(a)-adjacent small-disadvantaged bucket rather than its own set-aside.
  [/\bsdb\b|small\s+disadvantaged/i, 'SB-Total'],
  [/\bsmall\s+business\b|\bsbe\b/i, 'SB-Total'],
];

const CREDENTIAL_PATTERNS: Array<[RegExp, CredentialTag]> = [
  [/\bfcl\b|facility\s+clearance|secret\s+clearance/i, 'FCL'],
  [/\biso\s*\d{4,5}\b|\biso\b/i, 'ISO'],
  [/\bsoc\s*2\b/i, 'SOC2'],
  [/\bcmmi\b/i, 'CMMI'],
  // State/city minority + women programs — real, but not federal set-asides.
  [/\bm\/?wbe\b|\bmbe\b|\bwbe\b|minority[-\s]?owned/i, 'STATE-MWBE'],
];

/**
 * Users cram several certs into one entry: "SDVOSB;VOSB;WOSB", "SDVOSB.WOSB".
 * Split on separators BEFORE matching, or only the first is ever seen.
 * NOT split on "(" or ")" — that would shred "8(a)".
 */
function splitEntry(raw: string): string[] {
  return raw
    .split(/[;,/|]+|\s+and\s+|(?<=[a-z])\.(?=[A-Z])/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normalize a raw certifications array into set-aside codes + credentials.
 * Pure and side-effect free; safe to call on every read.
 */
export function normalizeCertifications(raw: unknown): NormalizedCertifications {
  const list = Array.isArray(raw) ? raw : [];
  const setAsides = new Set<SetAsideCode>();
  const credentials = new Set<CredentialTag>();
  const unrecognized: string[] = [];

  for (const entry of list) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    for (const part of splitEntry(entry)) {
      let hit = false;
      for (const [re, code] of SET_ASIDE_PATTERNS) {
        if (!re.test(part)) continue;
        setAsides.add(code);
        hit = true;
        // Indian-SB is ADDITIVE, not exclusive: "SBA Tribal 8(a)" is a tribally
        // owned firm holding 8(a) status, and it can bid BOTH lanes. Every other
        // code is mutually exclusive within one entry (EDWOSB is not also WOSB),
        // so those stop here.
        if (code !== 'Indian-SB') break;
      }
      for (const [re, tag] of CREDENTIAL_PATTERNS) {
        if (re.test(part)) { credentials.add(tag); hit = true; break; }
      }
      // Junk like "NO" or a state licence number: keep it visible rather than
      // pretending it parsed. Never guess an eligibility from it.
      if (!hit && part.length > 1) unrecognized.push(part);
    }
  }

  // An 8(a) / SDVOSB / WOSB / HUBZone firm is a small business by definition —
  // they qualify for SB-Total set-asides too. Adding it is a real widening of
  // eligibility, not an assumption.
  if (setAsides.size > 0) setAsides.add('SB-Total');

  return {
    setAsides: [...setAsides],
    credentials: [...credentials],
    unrecognized,
  };
}

/**
 * Set-aside codes a company with these certs may bid.
 * Always includes 'Full & Open' — every firm can bid unrestricted work; the
 * certs only ADD restricted lanes.
 */
export function eligibleSetAsides(raw: unknown): string[] {
  const { setAsides } = normalizeCertifications(raw);
  return ['Full & Open', ...setAsides];
}

/**
 * Derive a sub-agency / command for a federal contact when SAM doesn't store
 * one (sub_tier/office are 0% populated for the big agencies). Two signals,
 * email domain first (cleaner), then the solicitation-number prefix.
 *
 * This is what lets the Decision Makers tab narrow "DEPT OF DEFENSE" (24K+
 * contacts) into Air Force / Navy / Army / DLA / etc. — Eric 2026-06-05.
 */

// Email domain → sub-agency label. Longest-match wins (us.af.mil before af.mil).
const DOMAIN_MAP: Array<[RegExp, string]> = [
  [/(^|\.)af\.mil$/i, 'Air Force'],
  [/(^|\.)navy\.mil$/i, 'Navy'],
  [/(^|\.)usmc\.mil$/i, 'Marine Corps'],
  [/usace\.army\.mil$/i, 'Army Corps of Engineers'],
  [/(^|\.)army\.mil$/i, 'Army'],
  [/(^|\.)dla\.mil$/i, 'Defense Logistics Agency'],
  [/(^|\.)health\.mil$/i, 'Defense Health Agency'],
  [/(^|\.)dhs\.gov$/i, 'DHS HQ'],
  [/uscg\.mil$/i, 'Coast Guard'],
  [/cbp\.dhs\.gov$/i, 'Customs & Border Protection'],
  [/fema\.dhs\.gov$/i, 'FEMA'],
  [/ice\.dhs\.gov$/i, 'ICE'],
  [/tsa\.dhs\.gov$/i, 'TSA'],
  [/va\.gov$/i, 'Veterans Affairs'],
  [/nih\.gov$/i, 'NIH'],
  [/cdc\.gov$/i, 'CDC'],
  [/fda\.hhs\.gov$/i, 'FDA'],
  [/cms\.hhs\.gov$/i, 'CMS'],
];

// Solicitation-number prefix → sub-agency. DoD-heavy (the prefixes are codified
// in the DoD Activity Address Code system). Fallback when the email is generic.
const PREFIX_MAP: Array<[RegExp, string]> = [
  [/^FA/i, 'Air Force'],
  [/^F[BDQ]/i, 'Air Force'],
  [/^N0|^N4|^N6|^N3|^N5/i, 'Navy'],
  [/^M[0-9]/i, 'Marine Corps'],
  [/^W[0-9A-Z]/i, 'Army'],
  [/^SP/i, 'Defense Logistics Agency'],
  [/^HT/i, 'Defense Health Agency'],
  [/^HC|^HQ/i, 'DISA / DoD HQ'],
];

export function deriveSubAgency(email: string | null, solicitationNumber: string | null): string | null {
  const domain = (email || '').split('@')[1]?.toLowerCase().trim();
  if (domain) {
    for (const [re, label] of DOMAIN_MAP) {
      if (re.test(domain)) return label;
    }
  }
  const sol = (solicitationNumber || '').trim();
  if (sol) {
    for (const [re, label] of PREFIX_MAP) {
      if (re.test(sol)) return label;
    }
  }
  return null;
}

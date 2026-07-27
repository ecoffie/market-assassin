/**
 * SAP-friendly BUYER classification — the "How this buyer buys" signal as an OPEN-opp filter.
 *
 * GOS Invariant #11 (docs/strategy/MINDY-OPERATING-THESIS.md): every field is a small-business-fit
 * signal — reveal the pattern. On the AWARDED map we filter a single contract by its own
 * `contract_type` (exact). OPEN opportunities carry NO contract_type (measured 0% — it's an award
 * field), so the only honest SB-friendliness signal for an open opp is its BUYING AGENCY'S track
 * record: what share of that agency's awards are PURCHASE ORDERs (a simplified-acquisition buy a
 * small firm can win directly) vs DELIVERY ORDERs (task orders under a vehicle you must already hold).
 *
 * The bands below are PRECOMPUTED from real data, NOT guessed — measured 2026-07-27 from
 * `recompete_opportunities` (quality_flag IS NULL), PO-share = (PURCHASE ORDER + BPA CALL) / total,
 * over agencies with ≥200 award rows. This is a one-time classification stored as a constant so the
 * Open filter is a cheap agency-MEMBERSHIP check (normalizeAgencyKey(department) ∈ a set), never a
 * per-opp query. Re-derive with `scripts/build-sap-friendly-agencies.ts` when the award data shifts.
 *
 * Why THREE bands, not a toggle: the PO-share is a SPECTRUM (SSA 62% … GSA 17%), and a single
 * ">=20%" cutoff kept 18 of 21 agencies — useless. Three honest bands (≥33 / 20–32 / <20) actually
 * discriminate and stay truthful about the gradient. A "friendly" agency still issues gated buys,
 * so this filters by the agency's TENDENCY, surfaced honestly — it is not a per-opp guarantee.
 */
import { normalizeAgencyKey } from '@/lib/gov-contacts/agency-key';

export type SapBuyerTier = 'most' | 'somewhat' | 'vehicle';

/** Measured PO-share per normalized agency key (2026-07-27). The source of the bands below. */
export const AGENCY_PO_SHARE: Record<string, number> = {
  'SOCIAL SECURITY': 62,
  'ENERGY': 41,
  'COMMERCE': 38,
  'INTERIOR': 37,
  'JUSTICE': 34,
  'VETERANS AFFAIRS': 33,
  'HEALTH AND HUMAN SERVICES': 33,
  'TREASURY': 32,
  'SECURITIES AND EXCHANGE COMMISSION': 30,
  'AGRICULTURE': 28,
  'HOMELAND SECURITY': 27,
  'LABOR': 27,
  'SMITHSONIAN INSTITUTION': 25,
  'DEFENSE': 24,
  'AERONAUTICS AND SPACE': 23,
  'STATE': 22,
  'ENVIRONMENTAL PROTECTION': 22,
  'EDUCATION': 22,
  'NUCLEAR REGULATORY COMMISSION': 18,
  'GENERAL SERVICES': 17,
  'TRANSPORTATION': 16,
};

/** Band cutoffs (PO-share %). ≥33 = most SB-friendly, 20–32 = somewhat, <20 = vehicle-heavy. */
const MOST_MIN = 33;
const SOMEWHAT_MIN = 20;

function tierForShare(share: number): SapBuyerTier {
  if (share >= MOST_MIN) return 'most';
  if (share >= SOMEWHAT_MIN) return 'somewhat';
  return 'vehicle';
}

/**
 * The set of normalized agency keys in each tier (precomputed once from AGENCY_PO_SHARE).
 * The Open filter checks membership: normalizeAgencyKey(opp.department) ∈ SAP_BUYER_TIERS[tier].
 */
export const SAP_BUYER_TIERS: Record<SapBuyerTier, string[]> = {
  most: [], somewhat: [], vehicle: [],
};
for (const [key, share] of Object.entries(AGENCY_PO_SHARE)) {
  SAP_BUYER_TIERS[tierForShare(share)].push(key);
}

/** Resolve a raw agency name (either taxonomy) to its SAP buyer tier, or null if not classified. */
export function sapBuyerTier(agencyName: string | null | undefined): SapBuyerTier | null {
  if (!agencyName) return null;
  const key = normalizeAgencyKey(agencyName);
  if (!key || !(key in AGENCY_PO_SHARE)) return null;
  return tierForShare(AGENCY_PO_SHARE[key]);
}

/**
 * The RAW `sam_opportunities.department` strings for each tier — the query targets for the Open-map
 * filter (`.in('department', SAM_DEPARTMENT_TIERS[tier])`). We can't run normalizeAgencyKey inside a
 * Supabase query, so the SAM taxonomy names are precomputed here (measured 2026-07-27 from the
 * distinct active `department` set; 236/29,917 = ~1% of active opps have an agency not in the ≥200-row
 * award classification and are simply not matched by any tier — honest, never force-bucketed).
 * Re-derive with `scripts/build-sap-friendly-agencies.ts` if SAM adds/renames a department.
 */
export const SAM_DEPARTMENT_TIERS: Record<SapBuyerTier, string[]> = {
  most: [
    'VETERANS AFFAIRS, DEPARTMENT OF',
    'INTERIOR, DEPARTMENT OF THE',
    'HEALTH AND HUMAN SERVICES, DEPARTMENT OF',
    'COMMERCE, DEPARTMENT OF',
    'JUSTICE, DEPARTMENT OF',
    'ENERGY, DEPARTMENT OF',
    'SOCIAL SECURITY ADMINISTRATION',
  ],
  somewhat: [
    'DEPT OF DEFENSE',
    'HOMELAND SECURITY, DEPARTMENT OF',
    'AGRICULTURE, DEPARTMENT OF',
    'STATE, DEPARTMENT OF',
    'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION',
    'ENVIRONMENTAL PROTECTION AGENCY',
    'TREASURY, DEPARTMENT OF THE',
    'LABOR, DEPARTMENT OF',
    'SECURITIES AND EXCHANGE COMMISSION',
    'EDUCATION, DEPARTMENT OF',
    'SMITHSONIAN INSTITUTION',
  ],
  vehicle: [
    'GENERAL SERVICES ADMINISTRATION',
    'TRANSPORTATION, DEPARTMENT OF',
    'NUCLEAR REGULATORY COMMISSION',
  ],
};

/** Human labels for the three tiers (drawer + filter UI). */
export const SAP_TIER_LABELS: Record<SapBuyerTier, string> = {
  most: 'Most SB-friendly buyers',
  somewhat: 'Somewhat SB-friendly',
  vehicle: 'Vehicle-heavy buyers',
};

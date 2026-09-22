/**
 * Incumbent identification may not be presented as a fact without source
 * evidence. Title/PSC overlap can SUPPORT a likely prior award. NAICS match
 * or mismatch alone must never decide correctness — a specialty recompete
 * often sits in a different 6-digit code than a facility IDV, and the reverse
 * (same NAICS, different work) is how a giant unrelated award used to win.
 */

export type IncumbentCertainty = 'supported' | 'uncertain' | 'none';

export interface IncumbentEvidence {
  distinctiveHits: number;
  pscMatch: boolean;
  naicsMatch: boolean;
  matchConfidence: 'high' | 'medium' | 'low';
  /**
   * 2-digit NAICS sectors of the notice and the candidate award, when both are
   * known. A conflict (e.g. 23 construction vs 51 telecom) means the award is
   * for a different KIND of work, not merely a different code.
   */
  noticeSector?: string | null;
  awardSector?: string | null;
  /**
   * Independently verified identity evidence that makes the sector comparison
   * inapplicable — e.g. the notice names this award as its predecessor, or a
   * shared PIID/UEI ties them. ONLY such evidence may override a sector
   * conflict; title-token overlap may not.
   */
  verifiedIdentity?: boolean;
}

export interface IncumbentGrounding {
  grounded: boolean;
  certainty: IncumbentCertainty;
  reason: string;
}

export function groundIncumbent(ev: IncumbentEvidence | null | undefined): IncumbentGrounding {
  if (!ev) {
    return {
      grounded: false,
      certainty: 'none',
      reason: 'No prior-award candidate was scored.',
    };
  }
  // ── GUARDRAIL 1: no taxonomy agreement at all → never supported ──────────
  // RC-3 (2026-09-22). Two real incidents, both naicsMatch=false AND
  // pscMatch=false, both reported 'supported' on title-token overlap alone:
  //   36C24226Q0857 (demolition/asbestos, NAICS 236220 / PSC Z1DA)
  //     → AT&T "EAST ORANGE & LYONS NJ GUEST WIFI" (NAICS 517110)
  //     matched on the tokens East, Orange, Lyons — pure GEOGRAPHY.
  //   SPE60525R0222 (fuel, NAICS 324110 / PSC 9130)
  //     → Lockheed PAC-3 "...FOR THE UNITED STATES (US) AND FOREIGN MILITARY
  //     SALES" (NAICS 336414) matched on United, States — GOVERNMENT GEOGRAPHY.
  // Distinctive-token overlap is the WEAKEST signal we have; without either
  // taxonomy axis agreeing it cannot carry a high-confidence identification.
  if (!ev.naicsMatch && !ev.pscMatch) {
    return {
      grounded: false,
      certainty: 'uncertain',
      reason:
        'Neither NAICS nor PSC matches the notice, so nothing but title-token overlap links this ' +
        'award to the requirement — not enough to identify an incumbent. Shown as a prior award only.',
    };
  }

  // ── GUARDRAIL 2: a 2-digit sector conflict hard-rejects ──────────────────
  // A different sector is a different KIND of work (23 construction vs 51
  // telecom; 32 petroleum vs 33 aerospace). Only INDEPENDENTLY VERIFIED
  // identity — not token overlap — makes the comparison inapplicable.
  const sectorConflict =
    !!ev.noticeSector && !!ev.awardSector && ev.noticeSector !== ev.awardSector;
  if (sectorConflict && !ev.verifiedIdentity) {
    return {
      grounded: false,
      certainty: 'none',
      reason:
        `Rejected: the award is in NAICS sector ${ev.awardSector} while the notice is in sector ` +
        `${ev.noticeSector} — a different kind of work. Only verified identity evidence (a named ` +
        'predecessor or a shared contract identifier) could override this.',
    };
  }

  const workEvidence = ev.distinctiveHits >= 2 || ev.pscMatch;
  // NAICS is recorded, never a gate on its own: a match does not make it
  // grounded. The guardrails above bound the DOWNSIDE; this bounds the upside.
  if (ev.matchConfidence === 'high' && workEvidence) {
    return {
      grounded: true,
      certainty: 'supported',
      reason: ev.pscMatch
        ? 'High confidence with a matching PSC (same product/service class).'
        : `High confidence with ${ev.distinctiveHits} distinctive title tokens on the award.`,
    };
  }
  return {
    grounded: false,
    certainty: 'uncertain',
    reason:
      'Inferred from keyword/agency search — not a certified predecessor on the notice. ' +
      'Do not identify an incumbent from this match. NAICS agreement or disagreement is not evidence.',
  };
}

export type MatchConfidence = 'high' | 'medium' | 'low';
export type ConfidenceConstraint = 'sector_conflict' | 'no_taxonomy_agreement';

const CONF_RANK: Record<MatchConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * `matchConfidence` describes the CANDIDATE's evidence — not the textual score
 * before contradictory evidence was considered. (Poteto: Incumbent Evidence
 * Truth, 2026-09-22.) Production still shipped AT&T "GUEST WIFI" beside a
 * demolition notice as `matchConfidence:"high"` with `naicsMatch:false`,
 * `pscMatch:false`, sector 23 vs 51 — the selection guard refused to NAME it,
 * but the candidate still claimed high confidence, and `find_predecessor_award`
 * (which never runs the guard) presented it as "Likely incumbent … [match: high]".
 *
 * Structured procurement evidence constrains textual confidence:
 *   - a valid 2-digit sector conflict → `low` (different KIND of work);
 *   - neither NAICS nor PSC agrees → at most `medium`.
 * Only verified identity (never token overlap) lifts the sector constraint,
 * mirroring groundIncumbent. This never RAISES confidence.
 */
export function reconcileMatchConfidence(
  textual: MatchConfidence,
  ev: Pick<IncumbentEvidence, 'naicsMatch' | 'pscMatch' | 'noticeSector' | 'awardSector' | 'verifiedIdentity'>,
): { matchConfidence: MatchConfidence; constraint: ConfidenceConstraint | null } {
  const sectorConflict =
    !!ev.noticeSector && !!ev.awardSector && ev.noticeSector !== ev.awardSector && !ev.verifiedIdentity;
  if (sectorConflict) return { matchConfidence: 'low', constraint: 'sector_conflict' };
  if (!ev.naicsMatch && !ev.pscMatch) {
    return {
      matchConfidence: CONF_RANK[textual] > CONF_RANK.medium ? 'medium' : textual,
      constraint: 'no_taxonomy_agreement',
    };
  }
  return { matchConfidence: textual, constraint: null };
}

/** Name an incumbent only when grounding says so. Uncertain candidates stay in prior_awards. */
export function namedIncumbent<T>(grounding: IncumbentGrounding, candidate: T | null | undefined): T | null {
  return grounding.grounded && candidate ? candidate : null;
}

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
  const workEvidence = ev.distinctiveHits >= 2 || ev.pscMatch;
  // NAICS is recorded, never a gate: match does not make it grounded; mismatch
  // does not make it ungrounded.
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

/** Name an incumbent only when grounding says so. Uncertain candidates stay in prior_awards. */
export function namedIncumbent<T>(grounding: IncumbentGrounding, candidate: T | null | undefined): T | null {
  return grounding.grounded && candidate ? candidate : null;
}

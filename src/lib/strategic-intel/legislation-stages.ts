/**
 * Legislative stage model for get_legislation_status — derived ONLY from Congress's
 * version codes, never from titles or from the bill-level "became law" fact.
 *
 * ⚠️ THIS TABLE IS DELIBERATELY SMALL. It covers exactly the version codes present in
 * the production corpus on 2026-09-25 (IH IS RH RS EH ES CPS EAH ENR PUBLIC-LAW). A code
 * that is not here is reported as `OTHER` with Congress's own label and is NEVER promoted
 * — a calendar placement, a conference text or a received-in-other-chamber print must not
 * be guessed into "passed". Add a row only when that code is actually held.
 *
 * Invariants (pinned by legislation-status.unit.test.ts):
 *   REPORTED is not PASSED · PASSED (one chamber, or both in differing forms) is not LAW ·
 *   ENROLLED is not the authority — the PUBLIC LAW record is.
 */

export type LegislationStage =
  | 'INTRODUCED'
  | 'REPORTED_IN_HOUSE'
  | 'REPORTED_IN_SENATE'
  | 'HOUSE_PASSED'
  | 'SENATE_PASSED'
  | 'HOUSE_PASSED_WITH_AMENDMENT'
  | 'ENROLLED'
  | 'PUBLIC_LAW'
  | 'OTHER';

export type StageChamber = 'House' | 'Senate' | 'both' | null;

export interface StageInfo {
  stage: LegislationStage;
  chamber: StageChamber;
  /** Ordering for "most advanced ESTABLISHED stage". OTHER is 0 so it never wins. */
  rank: number;
  display: string;
}

const TABLE: Record<string, StageInfo> = {
  IH: { stage: 'INTRODUCED', chamber: 'House', rank: 1, display: 'Introduced in the House' },
  IS: { stage: 'INTRODUCED', chamber: 'Senate', rank: 1, display: 'Introduced in the Senate' },
  RH: { stage: 'REPORTED_IN_HOUSE', chamber: 'House', rank: 2, display: 'Reported by House committee (not passed)' },
  RS: { stage: 'REPORTED_IN_SENATE', chamber: 'Senate', rank: 2, display: 'Reported by Senate committee (not passed)' },
  EH: { stage: 'HOUSE_PASSED', chamber: 'House', rank: 3, display: 'Passed the House' },
  ES: { stage: 'SENATE_PASSED', chamber: 'Senate', rank: 3, display: 'Passed the Senate' },
  CPS: { stage: 'SENATE_PASSED', chamber: 'Senate', rank: 3, display: 'Considered and passed the Senate' },
  EAH: {
    stage: 'HOUSE_PASSED_WITH_AMENDMENT', chamber: 'House', rank: 4,
    display: 'House passed this Senate bill with an amendment (chambers not yet agreed)',
  },
  ENR: { stage: 'ENROLLED', chamber: 'both', rank: 5, display: 'Enrolled — passed both chambers in identical form' },
  'PUBLIC-LAW': { stage: 'PUBLIC_LAW', chamber: null, rank: 6, display: 'Public Law — the enacted authority' },
};

export function stageForCode(code: string | null | undefined, rawLabel?: string | null): StageInfo {
  const hit = code ? TABLE[code.toUpperCase()] : undefined;
  if (hit) return hit;
  return { stage: 'OTHER', chamber: null, rank: 0, display: rawLabel?.trim() || code || 'Unrecognised version' };
}

/** The version codes this model understands (for tests and audits). */
export const KNOWN_VERSION_CODES = Object.freeze(Object.keys(TABLE));

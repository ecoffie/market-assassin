/**
 * Bid / No-Bid decision — Step 1 of Eric's real proposal workflow, BEFORE the
 * compliance matrix (Eric: "there are go/no-go decisions that completely
 * eliminate you from bidding — do you meet past performance, do you have the
 * licenses — that's where I start, prior to a matrix").
 *
 * Two parts, in order:
 *  1. GATES — binary eliminators. Any NO = No-Bid, stop. (set-aside, license,
 *     past-perf minimum, bonding, deadline feasibility.)
 *  2. SCORECARD — Eric's 10-factor weighted self-assessment (the "bid no bid
 *     framework.pdf"): rate each 0-10 → overall % → pursue / watch / skip.
 *
 * This file is the data model + scoring; the UI collects the answers.
 */

// ---- Part 1: Hard gates (binary) ----
export interface BidGate {
  id: string;
  question: string;
  help: string;        // why this eliminates you
}

// The universal eliminators. A NO on any of these = No-Bid regardless of fit.
export const BID_GATES: BidGate[] = [
  { id: 'set_aside', question: 'Are you eligible for this set-aside / size standard?', help: "If it's an 8(a)/SDVOSB/WOSB/HUBZone set-aside you don't qualify for — or you exceed the size standard — you legally cannot win." },
  { id: 'license', question: 'Do you hold (or can you get) every required license / certification?', help: 'Missing a required state license, clearance, or certification at submission is an automatic disqualification.' },
  { id: 'past_perf', question: 'Do you meet the minimum past-performance requirement?', help: 'If it requires N similar contracts of $X and you (or your team) lack them, your proposal is non-responsive.' },
  { id: 'bonding', question: 'Can you secure the required bonding / insurance?', help: 'Construction and many service contracts require payment/performance bonds you must be able to obtain.' },
  { id: 'deadline', question: 'Can you realistically complete a quality response by the deadline?', help: "A rushed, incomplete proposal loses. If there isn't enough time, no-bid is the honest call." },
];

// ---- Part 2: Eric's 10-factor scorecard ----
export interface BidFactor {
  id: string;
  label: string;
  positive: string;   // 7-10
  neutral: string;    // 3-6
  negative: string;   // 0-2
}

// Verbatim from Eric's bid-no-bid framework PDF.
export const BID_FACTORS: BidFactor[] = [
  { id: 'ability', label: 'Ability to respond', positive: 'Can meet/exceed every requirement, including past performance.', neutral: 'Understand the problem and can respond; average past performance.', negative: "Don't know; limited past performance." },
  { id: 'experience', label: 'Background experience & technical capability', positive: 'Strong in-house experience and/or technically superior.', neutral: 'Average experience in-house or can be acquired; technically capable.', negative: 'Weak experience or new area, or not technically qualified.' },
  { id: 'team', label: 'Proposed team & personnel (subs an option)', positive: 'Best available (may enhance offering).', neutral: 'Best available (no impact).', negative: 'Second best; diluting our scope of work.' },
  { id: 'price', label: 'Price strategy', positive: 'We know the price to win; honest, credible bid within known price structure.', neutral: 'Good idea of price to win; reasonable, competitive price structure.', negative: 'Guess the price to win; must cut corners or margins.' },
  { id: 'customer', label: 'Customer knowledge & rapport', positive: "Good working relationships; we know the customer's needs.", neutral: 'We are known but relationships not cultivated; we understand the customer.', negative: "Unknown to the customer and we don't know their needs." },
  { id: 'competition', label: 'Competition', positive: 'Sole source or customer knows and prefers us.', neutral: 'Open/neutral customer and we know how to beat the competition.', negative: 'Unknown competition; may be wired.' },
  { id: 'market', label: 'Market intelligence', positive: 'Inside track, good work-up.', neutral: 'Generally up-to-date on market developments.', negative: 'Surprised by RFP issuance or requirements.' },
  { id: 'resources', label: 'Company resources (proposal + execution)', positive: 'Resources easily available to develop the proposal to win and execute.', neutral: 'Available.', negative: 'Not available.' },
  { id: 'facilities', label: 'Facilities', positive: 'Available and favorably located.', neutral: 'No facility required, or we can get one quickly.', negative: 'Facility required but not yet available.' },
  { id: 'strategic', label: "Program's potential strategic advantage", positive: 'High', neutral: 'Average', negative: 'Low' },
];

export interface BidScorecardInput {
  gates: Record<string, boolean>;     // gateId → passed?
  ratings: Record<string, number>;    // factorId → 0-10
}

export interface BidDecisionResult {
  blocked: boolean;                   // a gate failed → No-Bid
  failedGates: string[];
  score: number;                      // 0-100 (% of max 100)
  rated: number;                      // how many factors were rated
  recommendation: 'pursue' | 'watch' | 'skip' | 'no-bid';
}

/** Score the framework. Gates are checked first; a failure short-circuits. */
export function evaluateBidDecision(input: BidScorecardInput): BidDecisionResult {
  const failedGates = BID_GATES.filter(g => input.gates[g.id] === false).map(g => g.id);
  if (failedGates.length > 0) {
    return { blocked: true, failedGates, score: 0, rated: 0, recommendation: 'no-bid' };
  }
  const ratings = BID_FACTORS.map(f => input.ratings[f.id]).filter(v => typeof v === 'number');
  const total = ratings.reduce((a, b) => a + b, 0);
  // Max is 100 (10 factors × 10). Score as a % of the rated factors' max so a
  // partially-filled card still gives a meaningful read.
  const maxForRated = ratings.length * 10;
  const score = maxForRated > 0 ? Math.round((total / maxForRated) * 100) : 0;
  // Thresholds mirror the existing analyst: pursue 70+, watch 40-69, skip <40.
  const recommendation: BidDecisionResult['recommendation'] = score >= 70 ? 'pursue' : score >= 40 ? 'watch' : 'skip';
  return { blocked: false, failedGates: [], score, rated: ratings.length, recommendation };
}

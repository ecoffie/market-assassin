/**
 * Briefing content lenses — Content Reaper pattern #5 ported.
 *
 * Each briefing run picks 2 random framings from the lens list and
 * injects them into the AI prompt. Same NAICS profile + same data,
 * but the framing rotates day-to-day, giving the briefing personality
 * and preventing the "same 5 sections in different order" feeling.
 *
 * Compounds with the anti-repetition memory (angle-history.ts):
 *   - anti-repetition stops the AI from repeating ANGLES (specific
 *     opportunities / themes already covered)
 *   - lenses give the AI a different LENS to look through (framing /
 *     mental model the briefing is built from)
 *
 * Together: the briefing is both fresh (no repeat angles) and varied
 * (different perspective each edition).
 */

export interface BriefingLens {
  id: string;
  framing: string;
}

export const BRIEFING_LENSES: BriefingLens[] = [
  {
    id: 'fiscal-year-end-urgency',
    framing:
      'Lead with use-it-or-lose-it FY-end spending pressure. Highlight contracts where agencies must obligate funds soon.',
  },
  {
    id: 'recompete-timing',
    framing:
      'Lead with recompete windows — incumbents whose contracts expire in 6-18 months. Position the user to capture displacement opportunities.',
  },
  {
    id: 'agency-budget-shift',
    framing:
      'Lead with where agency budgets are growing or shrinking (FY25 → FY26 trends). Frame opportunities through the lens of agency funding momentum.',
  },
  {
    id: 'small-business-shortfalls',
    framing:
      'Lead with agencies missing their small-business goals. Position the user as a high-fit small business that helps the agency hit its targets.',
  },
  {
    id: 'capture-strategy',
    framing:
      'Frame everything as capture moves the user should be making THIS week — not opportunities to research, but actions to take.',
  },
  {
    id: 'incumbent-vulnerability',
    framing:
      'Lead with weak incumbents — single-bid contracts, low past-performance scores, news of incumbent struggles. Frame the user as the upgrade.',
  },
  {
    id: 'set-aside-opportunity',
    framing:
      'Lead with set-aside-restricted opportunities the user qualifies for (SDVOSB, 8a, WOSB, HUBZone). Frame around their cert advantage.',
  },
  {
    id: 'sources-sought-window',
    framing:
      'Lead with Sources Sought + RFI activity — early-stage market research the user should be shaping right now to influence the eventual RFP.',
  },
  {
    id: 'agency-pain-point-match',
    framing:
      'Lead by naming the most acute current pain point at the relevant agency, then frame each opportunity as a direct response to that pain.',
  },
  {
    id: 'teaming-leverage',
    framing:
      "Frame opportunities through teaming math: what's the right prime/sub split, who to partner with, how to use the user's profile as a multiplier.",
  },
  {
    id: 'recompete-bridge-risk',
    framing:
      'Lead with bridge / extension activity from incumbents — signals of agency dissatisfaction the user can capitalize on at recompete.',
  },
  {
    id: 'naics-cluster-momentum',
    framing:
      "Frame the briefing around clusters of activity in the user's NAICS — what's the federal market doing in their lane this week, not just individual contracts.",
  },
];

// Fisher-Yates shuffle — same pattern Content Reaper uses
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick N random lenses for this briefing. Default 2 — enough to give
 * the AI a distinct framing, not enough to muddle the output.
 *
 * Optional `seed` makes it deterministic for testing / A-B (the seed
 * is the briefing date or profile hash, depending on caller).
 */
export function pickBriefingLenses(count = 2, seed?: number): BriefingLens[] {
  if (seed === undefined) {
    return shuffle(BRIEFING_LENSES).slice(0, count);
  }
  // Deterministic: rotate based on seed so the same seed picks the same lenses
  const start = seed % BRIEFING_LENSES.length;
  return Array.from({ length: count }, (_, i) => BRIEFING_LENSES[(start + i * 3) % BRIEFING_LENSES.length]);
}

/**
 * Format picked lenses for the AI prompt. Returns '' if empty so the
 * caller can do `${formatLensesForPrompt(lenses)}` safely.
 */
export function formatLensesForPrompt(lenses: BriefingLens[]): string {
  if (lenses.length === 0) return '';
  const lines = lenses.map((l, i) => `  ${i + 1}. ${l.framing}`).join('\n');
  return `BRIEFING LENSES for this edition (frame the briefing through these — pick 1 or weave both):
${lines}
`;
}

/**
 * Hash a string to a positive integer for deterministic seeding.
 * Used when caller wants the same profile to get the same lens rotation
 * within a single day but different across days.
 */
export function seedFromString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

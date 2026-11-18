/**
 * Bounded second planner tool round for Ask Mindy (multi-hop research).
 *
 * Round 1 often resolves a notice / prior award but cannot also call the hop
 * (competitors, contacts, capable contractors) in the same planner turn. A second
 * round is offered only when round 1 already returned a successful seed tool —
 * never as a blank-slate retry, never a third round.
 *
 * Policy, write caps, confirmations, timeouts and billing stay with the executor;
 * this module only decides whether to ask the planner again.
 */

/**
 * Tools whose success can unlock a useful follow-on hop in the same customer turn
 * (competitors after an incumbent, contacts after a notice). Open/expiring *list*
 * tools are deliberately excluded — they usually finish the turn as a rendered list
 * and must not spend a second planner pass by default.
 */
export const SECOND_ROUND_SEED_TOOLS: ReadonlySet<string> = new Set([
  'lookup_solicitation',
  'get_solicitation_incumbent',
  'search_past_contracts',
]);

export interface SecondRoundSeed {
  tool: string;
  status: string;
}

/**
 * True when round 1 produced at least one successful seed tool and the turn is
 * still open for more work. Read-only decision — never forces a specific hop.
 */
export function shouldOfferSecondToolRound(
  round1: ReadonlyArray<SecondRoundSeed>,
  opts: { turnTimedOut?: boolean; plannerUnavailable?: boolean } = {},
): boolean {
  if (opts.turnTimedOut || opts.plannerUnavailable) return false;
  if (!round1.length) return false;
  return round1.some((r) => r.status === 'success' && SECOND_ROUND_SEED_TOOLS.has(r.tool));
}

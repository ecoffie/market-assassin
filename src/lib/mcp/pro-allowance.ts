/**
 * Team supersedes Pro for the monthly MCP allowance (Eric, 2026-09-30).
 *
 * A person whose MCP calls are billed to a TEAM pool can never spend personal credits
 * (the pool pays, and an empty pool refuses rather than falling back). So a Pro
 * subscription's monthly personal allowance, granted to someone in an active team, is
 * credit they cannot use: 1,500 a month piling up with no way to spend it. Found on the
 * first migrated Team customer, who also pays for Pro.
 *
 * The rule, like "no stacking": when the Pro allowance's recipient is in a team billing
 * context, it is NOT granted. Nothing in Stripe changes; the Pro subscription itself is an
 * account conversation. The moment the person leaves the team (or the team subscription
 * ends), `resolvePayer` returns 'personal' again and the next run (the daily self-heal
 * inside the same month) grants it normally.
 *
 * Scope: ONLY the Pro app-tier allowance. Team, MCP-plan, internal, advocate and
 * sponsored grants are untouched.
 */
import { resolvePayer } from './payer';

export type ProAllowanceDecision =
  | { grant: true }
  | { grant: false; reason: 'team_pool_supersedes_pro'; orgId: string | null; detail: string }
  /** The billing context could not be established: grant nothing THIS run; the daily self-heal retries. */
  | { grant: false; reason: 'payer_unresolved'; orgId: null; detail: string };

export async function proAllowanceDecision(email: string): Promise<ProAllowanceDecision> {
  const payer = await resolvePayer(email);
  switch (payer.kind) {
    case 'personal':
      return { grant: true };
    case 'pool':
      return { grant: false, reason: 'team_pool_supersedes_pro', orgId: payer.orgId ?? null, detail: `billed to team pool ${payer.poolId}` };
    // Both are paid team contexts where no call bills personally (see payer.ts step 4).
    case 'pool_unavailable':
    case 'selection_required':
      return { grant: false, reason: 'team_pool_supersedes_pro', orgId: payer.orgId ?? null, detail: `team context (${payer.kind})` };
    default:
      return { grant: false, reason: 'payer_unresolved', orgId: null, detail: payer.reason ?? payer.kind };
  }
}

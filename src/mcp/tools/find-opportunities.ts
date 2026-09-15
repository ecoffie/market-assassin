/**
 * MCP tool: find_opportunities — unified Opportunity Map FIND.
 *
 * Customer action: "Find opportunities" across Open now / Coming back / Coming soon.
 * Credits: 10 (one composed debit). Does not debit per horizon.
 */
import {
  findOpportunities,
  type FindOpportunitiesInput,
  type FindOpportunitiesResult,
} from '@/lib/opportunities/find-opportunities';

export type { FindOpportunitiesInput, FindOpportunitiesResult };

export async function findOpportunitiesTool(
  input: FindOpportunitiesInput,
): Promise<FindOpportunitiesResult> {
  return findOpportunities(input);
}

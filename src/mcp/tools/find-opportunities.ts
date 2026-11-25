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
import { lookupSamEntity } from '@/mcp/tools/sam-entity';

export type { FindOpportunitiesInput, FindOpportunitiesResult };

/**
 * `samCacheOnly` (Ask Mindy research mode only; MCP transports never set it): the company anchor for a `uei` resolves
 * from Mindy's SAM cache, never live SAM. Every other FIND read is already the database.
 */
export async function findOpportunitiesTool(
  input: FindOpportunitiesInput,
  opts: { samCacheOnly?: boolean } = {},
): Promise<FindOpportunitiesResult> {
  if (opts.samCacheOnly) return findOpportunities(input, { entityLookup: (i) => lookupSamEntity(i, { cacheOnly: true }) });
  return findOpportunities(input);
}

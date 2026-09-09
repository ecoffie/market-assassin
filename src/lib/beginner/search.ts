/**
 * Beginner search seam — resolveBusiness + search_sam_opportunities +
 * translateOpportunity. Fix #2 consumes this. No landing page, no ranking change.
 *
 * search_sam_opportunities does NOT use `_meta.grounded`. Map honestly:
 *   ok:true + items.length > 0  → grounded results
 *   ok:true + items.length === 0 → genuine empty (not an outage)
 *   ok:false error sam_unavailable → upstream unavailable
 * Missing `items` on a success payload is unavailable, never `?? []`.
 */

import { makeTier1Tools, type Tier1Db } from '@/lib/chat/tier1-tools';
import { resolveBusiness, type ResolveBusinessDeps, type ResolveBusinessInput } from './resolve-business';
import { translateOpportunities } from './translate-opportunity';
import {
  EMPTY_MATCH_MESSAGE,
  UNAVAILABLE_MESSAGE,
  CLASSIFY_UNAVAILABLE_MESSAGE,
  FOLLOW_UP_PROMPT,
  type BeginnerSearchResult,
  type EligibilityEvidence,
  type SamSearchItem,
  type SamSearchResult,
} from './types';

export interface SearchBeginnerDeps extends Partial<ResolveBusinessDeps> {
  searchSam?: (args: { keyword: string; limit?: number }) => Promise<SamSearchResult>;
}

export interface SearchBeginnerInput extends ResolveBusinessInput {
  limit?: number;
  nowMs?: number;
  eligibility?: EligibilityEvidence;
}

async function defaultSearchSam(args: { keyword: string; limit?: number }): Promise<SamSearchResult> {
  const { getWriteClient } = await import('@/lib/supabase/server-clients');
  const tools = makeTier1Tools(getWriteClient() as unknown as Tier1Db);
  const result = await tools.execute('search_sam_opportunities', args);
  return result as SamSearchResult;
}

function asItems(result: SamSearchResult): SamSearchItem[] | null {
  if (!('items' in result) || !Array.isArray(result.items)) return null;
  return result.items as SamSearchItem[];
}

export async function searchBeginnerOpportunities(
  input: SearchBeginnerInput,
  deps: SearchBeginnerDeps = {},
): Promise<BeginnerSearchResult> {
  const resolution = await resolveBusiness(input, deps);

  if (resolution.state === 'unavailable') {
    return {
      resolution,
      outcome: { kind: 'unavailable', message: CLASSIFY_UNAVAILABLE_MESSAGE },
    };
  }

  if (resolution.state === 'need_followup') {
    return {
      resolution,
      outcome: { kind: 'need_followup', message: resolution.followUpPrompt || FOLLOW_UP_PROMPT },
    };
  }

  const keyword = (resolution.searchKeyword || '').trim();
  if (!keyword) {
    return {
      resolution,
      outcome: { kind: 'need_followup', message: FOLLOW_UP_PROMPT },
    };
  }

  const searchSam = deps.searchSam ?? defaultSearchSam;
  let result: SamSearchResult;
  try {
    result = await searchSam({ keyword, limit: input.limit ?? 12 });
  } catch {
    return {
      resolution,
      outcome: { kind: 'unavailable', message: UNAVAILABLE_MESSAGE },
    };
  }

  if (!result.ok) {
    return {
      resolution,
      outcome: { kind: 'unavailable', message: UNAVAILABLE_MESSAGE },
    };
  }

  const items = asItems(result);
  if (items === null) {
    return {
      resolution,
      outcome: { kind: 'unavailable', message: UNAVAILABLE_MESSAGE },
    };
  }

  if (items.length === 0) {
    return {
      resolution,
      outcome: { kind: 'empty', message: EMPTY_MATCH_MESSAGE },
    };
  }

  const cards = translateOpportunities(items, {
    nowMs: input.nowMs,
    eligibility: input.eligibility ?? { established: false },
    searchContext: resolution.contextLabel,
  });

  return {
    resolution,
    outcome: { kind: 'results', count: items.length, cards, rawItems: items },
  };
}

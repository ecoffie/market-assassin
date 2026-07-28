/**
 * MCP tool: capability_match — semantic contractor / teaming-partner discovery.
 *
 * "Who does work like THIS?" in the buyer's own words, rather than by code. search_contractors
 * finds firms filed under a NAICS/PSC you already thought of; this finds firms whose capability
 * MEANS the same thing — "drone maintenance for the Navy" surfaces the right firms whether they
 * file under 336411, 541330 or 811310. The two are complements, not substitutes.
 *
 * Backed by contractor_capability_profiles.capability_embedding (OpenAI text-embedding-3-small,
 * batch-built — see scripts/embed-capability-profiles.ts). Reads Supabase only; no BigQuery on
 * this path, so there is no per-call scan cost (the June-2026 $2,075 spike is why).
 *
 * MODES
 *   query   → semantic search over all profiles
 *   uei     → "who complements this firm" — neighbours in a similarity BAND, close enough to team
 *             with but far enough not to be the same business. The band is the feature.
 *
 * GROUNDING: every returned field comes from award history (PRD Phases 1-2). Set-aside is
 * reported as work WON, never as a held certification — SAM (recipient_certifications) is the
 * source of truth for certs. `_meta.grounded=false` when nothing matched; do NOT invent firms.
 */
import { searchContractorsBySemantic, findComplementaryPartners, type SemanticMatch } from '@/lib/capability/semantic-search';
import { mcpFlags } from '@/lib/mcp/flags';

export interface CapabilityMatchInput {
  /** Free-text capability, e.g. "wildland firefighting crews with helicopters". */
  query?: string;
  /** Rollup UEI to find COMPLEMENTARY partners for (teaming mode). Mutually exclusive with query. */
  uei?: string;
  /** Optional 2-letter state filter, e.g. "VA". */
  state?: string;
  /** Only return firms at this concentration level. */
  tier?: 'specialist' | 'focused' | 'diversified';
  /** Require at least this many federal awards (filters out one-off winners). */
  min_awards?: number;
  /** Max rows (default 15, max 100). */
  limit?: number;
}

export interface CapabilityMatchResult {
  queried: { mode: 'search' | 'partners'; query?: string; uei?: string; anchor?: string | null; state?: string; tier?: string };
  matches: SemanticMatch[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; count: number; scanned: number };
}

export async function capabilityMatch(input: CapabilityMatchInput): Promise<CapabilityMatchResult> {
  const query = String(input.query ?? '').trim();
  const uei = String(input.uei ?? '').trim();
  const state = String(input.state ?? '').trim().toUpperCase() || undefined;
  const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 100);

  if (!query && !uei) {
    return {
      queried: { mode: 'search' },
      matches: [],
      _meta: { grounded: false, degraded: true, count: 0, scanned: 0 },
    };
  }

  if (uei) {
    const { anchor, matches, scanned } = await findComplementaryPartners({ rollupUei: uei, state, limit });
    const res: CapabilityMatchResult = {
      queried: { mode: 'partners', uei, anchor, state },
      matches,
      _meta: { grounded: matches.length > 0, degraded: scanned === 0, count: matches.length, scanned },
    };
    if (mcpFlags.aiHint) {
      res._ai_hint = {
        summary: anchor
          ? `${matches.length} contractors whose federal work COMPLEMENTS ${anchor} — adjacent capability, not the same business.`
          : 'No profile found for that UEI.',
        how_to_use: 'These are teaming candidates: similar enough to work the same opportunities, different enough to fill a gap rather than compete. Similarity is shown per row — treat it as adjacency, not a fit score.',
        key_caveats: [
          'Derived from award history, not self-reported capability statements.',
          'Excludes near-identical firms on purpose — those are competitors, not partners.',
          'Set-aside fields reflect work WON, not certifications held. Verify certs in SAM.',
        ],
      };
    }
    return res;
  }

  const { matches, scanned } = await searchContractorsBySemantic({
    query, state, specialtyTier: input.tier, minAwards: input.min_awards, limit,
  });
  const res: CapabilityMatchResult = {
    queried: { mode: 'search', query, state, tier: input.tier },
    matches,
    _meta: { grounded: matches.length > 0, degraded: scanned === 0, count: matches.length, scanned },
  };
  if (mcpFlags.aiHint) {
    res._ai_hint = {
      summary: `${matches.length} contractors whose federal award history means "${query}".`,
      how_to_use: 'Semantic match — finds firms doing this work regardless of which NAICS/PSC they file under. Pair with search_contractors (code-based) for the firms that literally won the code.',
      key_caveats: [
        'Similarity is cosine over capability embeddings; ~0.5+ is a strong match for this corpus, not 0.9+.',
        'Ranked by meaning, not by dollars — check award_count/total_obligated for scale.',
        'Set-aside fields reflect work WON, not certifications held.',
      ],
    };
  }
  return res;
}

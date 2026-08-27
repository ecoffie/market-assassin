/**
 * Mindy Chat v2 — Tier-2 (BigQuery contractor/award intel) chat tools.
 *
 * Tier 2 = the heaviest Data Core layer (PRD-mindy-chat-data-core.md §5a, §6):
 * competitive intel over the 317K-recipient BigQuery corpus + award history.
 * Public data (no per-user scoping) — but UNLIKE Tier 1 (cheap Postgres), these
 * hit BigQuery, so they carry real scan cost.
 *
 * COST DISCIPLINE (the reason this is its own tier — the June-2026 $2,075 spike,
 * tasks/bigquery-cost-spike-2026-06.md):
 *   - The BQ cache defaults cacheOnly:true so crawler traffic can NEVER cold-scan.
 *     A chat tool that respected that default would return [] for any company not
 *     already warm — useless. So these tools opt INTO live BQ (liveBq:true), which
 *     the cache header explicitly sanctions for "authenticated Mindy paths".
 *   - To keep that opt-in from becoming a scan storm, EVERY live-BQ tool call is
 *     gated by a PER-USER rate limit (checkRateLimit). A user gets a bounded
 *     number of cold contractor lookups per window; over it, the tool returns a
 *     friendly "slow down" note instead of another scan. Warm-cache hits are free
 *     and NOT counted against the limit (we only meter the cost-bearing path via
 *     a two-pass: cache-only first, live+meter only on a miss).
 *
 * Same no-fabrication contract: empty => explicit count:0 + honest note.
 */

import {
  getRollupOrSingleBySlug,
  resolveCanonicalSlug,
  getRecentAwardsForRecipient,
  getTopAgenciesForRecipient,
  findCapableSmallBusinesses,
  recipientSlug,
  type RollupProfile,
} from '@/lib/bigquery/recipients';
import {
  allowColdBqLookup,
  type ColdBqTurnState,
} from '@/lib/bigquery/cold-budget';

/** Clamp a caller-supplied result limit to [1, max], defaulting when absent/invalid. */
function resolveLimit(raw: unknown, def: number, max: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

export const TIER2_TOOL_DEFS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_contractor_profile',
      description:
        "Look up a specific federal contractor by company name and return who they are, their total federal awards, top buying agencies, and recent contracts. Call this when the user asks about a specific company — an incumbent, a competitor, or a potential teaming partner ('who is X', 'what has X won', 'who's the incumbent').",
      parameters: {
        type: 'object',
        properties: {
          company_name: { type: 'string', description: 'The contractor company name, e.g. "Leidos", "Booz Allen Hamilton".' },
        },
        required: ['company_name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_capable_contractors',
      description:
        'Find federal contractors who have won work in a given NAICS or PSC (product/service) code — useful for finding teaming partners, subcontractors, or scouting the competition in a market. Call this when the user asks who does a kind of work, who to team with, or who the players are in a NAICS/PSC.',
      parameters: {
        type: 'object',
        properties: {
          naics: { type: 'string', description: 'A 6-digit NAICS code, e.g. "541512".' },
          psc: { type: 'string', description: 'Optional Product/Service Code for a sharper match, e.g. "D307".' },
          small_business_only: { type: 'boolean', description: 'Optional: only return firms that have won set-aside work.' },
          state: { type: 'string', description: 'Optional 2-letter state to scope to firms HQ\'d there, e.g. "FL".' },
          limit: { type: 'number', description: 'Optional max number of contractors to return (1–200, default 50). Results come from a cached BigQuery rollup, so returning more has no per-call cost.' },
        },
        required: ['naics'],
        additionalProperties: false,
      },
    },
  },
];

export const TIER2_TOOL_NAMES = new Set(TIER2_TOOL_DEFS.map((t) => t.function.name));

const OVER_LIMIT_NOTE =
  'You have run a lot of contractor lookups recently — give it a few minutes before the next one so we can keep this fast for everyone.';

/**
 * Tier-2 toolset. `email` is used ONLY to meter the cost-bearing BQ path per
 * user (rate-limit key) — NOT for data scoping (this is public data). A
 * per-request `coldLookups` counter caps how many cold BQ scans a SINGLE chat
 * turn can trigger, so one message can't fan out into many scans.
 */
export function makeTier2Tools(email: string) {
  // Shared cold-BQ budget with MCP getContractorHistoryByUei (same chat-bq: key).
  const turn: ColdBqTurnState = { count: 0 };

  /** Gate a cost-bearing (cold) BQ call: per-turn cap + per-user hourly limit. */
  async function allowColdLookup(): Promise<boolean> {
    return allowColdBqLookup(email, turn);
  }

  /**
   * Resolve a company NAME → its BQ rollup profile, shared by every by-name
   * Tier-2 tool. Two-pass: cache-only sweep across suffix variants (free), then
   * ONE budget-gated cold sweep. `rateLimited` = the cold path was needed but
   * the per-user/per-turn budget is spent (caller returns the slow-down note).
   */
  async function resolveProfileByName(
    name: string,
  ): Promise<{ profile: RollupProfile | null; resolvedCold: boolean; rateLimited: boolean }> {
    // Companies are stored WITH legal suffixes ("LEIDOS, INC." → slug leidos-inc),
    // so a bare-name slug ("leidos") misses. Try the bare slug plus common
    // suffix variants; dedupe. getRollupOrSingleBySlug also falls back to the
    // single-recipient table when a company isn't in the merged rollups.
    const base = recipientSlug(name);
    const slugVariants = Array.from(new Set([
      base, `${base}-inc`, `${base}-llc`, `${base}-corporation`, `${base}-corp`, `${base}-company`,
    ]));

    // Pass 1: cache-only (free) across variants — zero cost, no rate-limit hit.
    let profile: RollupProfile | null = null;
    for (const s of slugVariants) {
      const canonical = await resolveCanonicalSlug(s).catch(() => null);
      profile = await getRollupOrSingleBySlug(canonical || s, false).catch(() => null);
      if (profile) break;
    }

    // Pass 2: cold. Only if every warm variant missed AND the user is under
    // budget. One cold budget unit covers the whole variant sweep.
    let resolvedCold = false;
    if (!profile) {
      if (!(await allowColdLookup())) return { profile: null, resolvedCold: false, rateLimited: true };
      resolvedCold = true;
      for (const s of slugVariants) {
        const canonical = await resolveCanonicalSlug(s).catch(() => null);
        profile = await getRollupOrSingleBySlug(canonical || s, true /* liveBq */).catch(() => null);
        if (profile) break;
      }
    }
    return { profile, resolvedCold, rateLimited: false };
  }

  async function getContractorProfile(args: { company_name?: unknown }): Promise<Record<string, unknown>> {
    const name = typeof args?.company_name === 'string' ? args.company_name.trim() : '';
    if (!name) return { ok: false, error: 'company_name_required' };

    const { profile, resolvedCold, rateLimited } = await resolveProfileByName(name);
    if (rateLimited) return { ok: false, error: 'rate_limited', note: OVER_LIMIT_NOTE };
    if (!profile) {
      return { ok: true, found: false, note: `I couldn't find a federal contractor matching "${name}".` };
    }

    // Enrich with recent awards + top agencies (rolled up across child UEIs,
    // cache-keyed by rollup_uei).
    //
    // P0-2 (2026-08-23): these previously passed `resolvedCold` as liveBq. That flag is
    // true only when the PROFILE lookup went cold, so on the common warm-profile path both
    // enrichment calls ran cacheOnly — and a cacheOnly miss returns [] BY DESIGN
    // (lib/bigquery/cache.ts), without scanning or throwing. Their cache keys are separate
    // from the profile's and were never warmed, and cacheOnly never writes the cache, so a
    // cold key stayed cold forever. Result: FLUIDYNE (1,278 awards) and LOCKHEED MARTIN
    // ($221B, 4,850 awards) both returned found:true with empty top_agencies AND
    // recent_awards. The tool was telling users "no recent awards" when it meant
    // "I didn't look".
    //
    // The cacheOnly default is correct and stays — it is SEO-SAFE-BY-DEFAULT from the June
    // 2026 BQ cost spike, protecting the public long-tail from crawler-driven cold-miss cost
    // storms. Its own comment names the intended split: authenticated Mindy paths opt INTO
    // live BQ. This authenticated, metered tool simply never did.
    //
    // Three states, kept distinct. An empty array is a FACTUAL CLAIM ("this company has no
    // recent awards"); budget exhaustion is an OPERATIONAL LIMIT. Collapsing them is what
    // made the defect invisible.
    //   1. warm cache          -> use it (free)
    //   2. cold + budget ok    -> one live BQ scan, result cached for everyone after
    //   3. cold + budget spent -> profile + explicit partial/degraded state, never false-empty
    const childUeis = profile.child_ueis?.length ? profile.child_ueis : [profile.rollup_uei];

    // Pass 1 — warm only. Free, and the overwhelmingly common case once a company is warm.
    let [awards, agencies] = await Promise.all([
      getRecentAwardsForRecipient(childUeis, profile.rollup_uei, 5, false).catch(() => []),
      getTopAgenciesForRecipient(childUeis, profile.rollup_uei, 5, false).catch(() => []),
    ]);

    // Pass 2 — only if warm missed AND the company actually HAS awards (award_count comes
    // from the free recipients row, so a genuinely award-less company never costs a scan).
    // Budget is consumed only here, on a real miss — allowColdLookup() increments a counter,
    // so it must never be called speculatively.
    let enrichmentStatus: 'complete' | 'budget_limited' = 'complete';
    const enrichmentMissed = awards.length === 0 && agencies.length === 0;
    const hasAwards = (profile.award_count ?? 0) > 0;
    if (enrichmentMissed && hasAwards) {
      if (resolvedCold || (await allowColdLookup())) {
        // resolvedCold: we already spent a unit resolving THIS company this turn — the
        // enrichment is the same company, so no extra unit is consumed.
        [awards, agencies] = await Promise.all([
          getRecentAwardsForRecipient(childUeis, profile.rollup_uei, 5, true).catch(() => []),
          getTopAgenciesForRecipient(childUeis, profile.rollup_uei, 5, true).catch(() => []),
        ]);
      } else {
        // Budget denied. We did NOT look, so we must not claim there is nothing to find.
        enrichmentStatus = 'budget_limited';
        // Measured, not guessed: if authenticated users hit this often, allowColdLookup()
        // limits are too tight for a metered tool's promise and should be tuned SEPARATELY.
        // Do not "fix" a high rate here by bypassing the guard — that reopens the June 2026
        // BQ cost incident.
        console.warn('[p0-2] enrichment budget_limited', JSON.stringify({
          tool: 'get_contractor_profile', rollup_uei: profile.rollup_uei,
          award_count: profile.award_count,
        }));
      }
    }

    return {
      ok: true,
      found: true,
      company: {
        name: profile.rollup_name,
        uei: profile.rollup_uei,
        location: [profile.city, profile.state].filter(Boolean).join(', ') || null,
        total_obligated: profile.total_obligated,
        award_count: profile.award_count,
        agencies_served: profile.distinct_agency_count,
        first_award: profile.first_action_date,
        last_award: profile.last_action_date,
      },
      top_agencies: agencies,
      recent_awards: awards,
      // P0-2 invariant: when award_count > 0 and enrichment was not actually queried,
      // empty arrays must NEVER be presented as complete data.
      enrichment_status: enrichmentStatus,
      ...(enrichmentStatus === 'budget_limited'
        ? {
            partial: true,
            note:
              `This profile is INCOMPLETE: the award/agency detail for ${profile.rollup_name} ` +
              `was not fetched because the live-lookup budget for this session is spent. ` +
              `The empty top_agencies/recent_awards below mean "not retrieved", NOT "none exist" ` +
              `— this company has ${profile.award_count} awards on record. Retry shortly.`,
          }
        : {}),
    };
  }

  async function findCapable(args: { naics?: unknown; psc?: unknown; small_business_only?: unknown; state?: unknown; limit?: unknown }): Promise<Record<string, unknown>> {
    const naics = typeof args?.naics === 'string' ? args.naics.trim() : '';
    const psc = typeof args?.psc === 'string' ? args.psc.trim() : '';
    if (!naics && !psc) return { ok: false, error: 'naics_or_psc_required', count: 0, items: [] };
    const setAsideOnly = args?.small_business_only === true;
    const state = typeof args?.state === 'string' ? args.state.trim().toUpperCase() : '';
    const inState = state ? ` in ${state}` : '';
    // Reads a CACHED BigQuery rollup, not a live cold scan (the cold pass is
    // budget-gated separately by COLD_BQ_LIMIT). So the result count costs
    // nothing — the old hardcoded 8 threw away 84% of the lib's own 50 default.
    const limit = resolveLimit(args?.limit, 50, 200);

    // Pass 1: cache-only. Pass 2: cold only if under budget.
    let res = await findCapableSmallBusinesses({ naics, psc, setAsideOnly, state, limit, liveBq: false });
    if (res.rows.length === 0) {
      if (!(await allowColdLookup())) {
        return { ok: false, error: 'rate_limited', note: OVER_LIMIT_NOTE, count: 0, items: [] };
      }
      res = await findCapableSmallBusinesses({ naics, psc, setAsideOnly, state, limit, liveBq: true });
    }
    if (res.rows.length === 0) {
      return { ok: true, count: 0, items: [], note: `No contractors found for ${psc ? `PSC ${psc}` : `NAICS ${naics}`}${setAsideOnly ? ' (set-aside only)' : ''}${inState}.` };
    }
    return {
      ok: true,
      count: res.rows.length,
      total: res.total,
      items: res.rows.map((r) => ({
        name: r.recipient_name,
        uei: r.recipient_uei,
        state: r.recipient_state ?? null,
        total_obligated: r.total_obligated,
        award_count: r.award_count,
        wins_set_asides: r.won_set_aside,
        why: r.match_reason,
      })),
    };
  }

  return {
    async execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      switch (name) {
        case 'get_contractor_profile':
          return getContractorProfile(args || {});
        case 'find_capable_contractors':
          return findCapable(args || {});
        default:
          return { ok: false, error: `unknown_tool:${name}` };
      }
    },
  };
}

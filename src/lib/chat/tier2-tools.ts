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
  getYearlyTotalsForRecipient,
  getSetAsideHistoryForRecipient,
  getRecipientByUei,
  findCapableSmallBusinesses,
  recipientSlug,
  type RollupProfile,
  type RecipientProfile,
} from '@/lib/bigquery/recipients';
import { resolveAwardCorpusByName } from '@/lib/contractor/name-resolution';
import {
  allowColdBqLookup,
  type ColdBqTurnState,
} from '@/lib/bigquery/cold-budget';
import { bqUnavailable } from '@/lib/bigquery/cache';
import {
  assessDateRange,
  buildCountingBases,
  classifyModNumber,
  dateRangeValidFlag,
  deriveActivityFromSeries,
  describeCoverageTimestamp,
  isModificationAction,
  SHORT_TOTALS_NOTE,
  summarizeHistoricalSetAsides,
} from '@/lib/contractor/award-history-shape';
import { loadAwardsWarehouseCoverage } from '@/lib/awards-ingest/read-warehouse-coverage';

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
        "Look up one federal contractor by company name. A unique award-warehouse match returns that firm's rollup totals, top agencies, and recent awards. Several matches return resolution=ambiguous and candidates — this tool does not pick one, and that is not 'no contractor found'. Zero rows in the award index is resolution=none_in_award_corpus (this dataset only, not proof of no federal awards and not a certification finding). A failed lookup is resolution=lookup_failed, distinct from both.",
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

  function rollupFromRecipient(recipient: RecipientProfile): RollupProfile {
    return {
      rollup_uei: recipient.recipient_uei,
      rollup_name: recipient.recipient_name,
      canonical_slug: recipientSlug(recipient.recipient_name),
      child_ueis: [recipient.recipient_uei],
      child_count: 1,
      cage_code: recipient.cage_code,
      address: recipient.address,
      city: recipient.city,
      state: recipient.state,
      zip: recipient.zip,
      country: recipient.country,
      total_obligated: Number(recipient.total_obligated || 0),
      award_count: Number(recipient.award_count || 0),
      transaction_count: Number(recipient.transaction_count || 0),
      first_action_date: recipient.first_action_date,
      last_action_date: recipient.last_action_date,
      distinct_agency_count: Number(recipient.distinct_agency_count || 0),
      distinct_naics_count: Number(recipient.distinct_naics_count || 0),
    };
  }

  async function getContractorProfile(args: { company_name?: unknown }): Promise<Record<string, unknown>> {
    const name = typeof args?.company_name === 'string' ? args.company_name.trim() : '';
    if (!name) return { ok: false, error: 'company_name_required' };

    let { profile, resolvedCold, rateLimited } = await resolveProfileByName(name);
    let totalsScope: 'parent_rollup' | 'single_uei' = 'parent_rollup';
    if (!profile) {
      // A spent cold budget is a failed lookup, not an empty corpus.
      if (rateLimited) {
        return { ok: false, found: false, resolution: 'lookup_failed', error: 'rate_limited', note: OVER_LIMIT_NOTE };
      }
      const named = await resolveAwardCorpusByName(name);
      if (named.status === 'degraded') {
        return {
          ok: false,
          found: false,
          resolution: 'lookup_failed',
          error: 'lookup_failed',
          note: 'The award-warehouse name search failed. Do not treat this as a miss and do not claim the contractor has no federal presence.',
        };
      }
      if (named.status === 'ambiguous') {
        return {
          ok: true,
          found: false,
          resolution: 'ambiguous',
          match_count: named.match_count,
          source: 'recipients',
          candidates: named.candidates,
          note: named.note,
        };
      }
      if (named.status === 'unique') {
        const recipient = await getRecipientByUei(named.uei, true).catch(() => null);
        if (recipient) {
          profile = rollupFromRecipient(recipient);
          totalsScope = 'single_uei';
          resolvedCold = true;
        } else {
          return {
            ok: true,
            found: true,
            resolution: 'unique',
            source: 'recipients',
            coverage: {
              dataset: 'recipients',
              measure: 'total_obligated',
              scope: 'single_uei',
              as_of: null,
              not_equivalent_to: 'recipients_rollup.total_obligated',
            },
            company: {
              name: named.name,
              uei: named.uei,
              total_obligated: named.total_obligated,
              award_count: named.award_count,
            },
            top_agencies: [],
            recent_awards: [],
            enrichment_status: 'budget_limited',
            partial: true,
            note: 'One award-warehouse recipient matched. Detail rows were not loaded. Empty top_agencies/recent_awards means not retrieved, not none exist.',
          };
        }
      } else {
        return {
          ok: true,
          found: false,
          resolution: 'none_in_award_corpus',
          source: 'recipients',
          note:
            `No award-holding recipient in the warehouse name index matches "${name}". ` +
            'That is this dataset only — it does not prove the firm has no federal awards, and it says nothing about SAM registration or certifications. ' +
            'Use lookup_sam_entity for registration. A missing has8a flag is not a finding that the firm is uncertified.',
        };
      }
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
    const TOP_AGENCIES_LIMIT = 5;
    const RECENT_LIMIT = 5;
    const awardsCacheKey = `rollup:${profile.rollup_uei}:recent-awards:${RECENT_LIMIT}:v4-m`;
    const agenciesCacheKey = `rollup:${profile.rollup_uei}:top-agencies:${TOP_AGENCIES_LIMIT}:v4-m`;
    const yearlyCacheKey = `rollup:${profile.rollup_uei}:yearly-totals:v3-m`;
    const setAsideCacheKey = `rollup:${profile.rollup_uei}:set-aside-history:v4-m`;

    // Pass 1 — warm only. Free, and the overwhelmingly common case once a company is warm.
    let [awards, agencies, yearly, setAsideHist, warehouseCoverage] = await Promise.all([
      getRecentAwardsForRecipient(childUeis, profile.rollup_uei, RECENT_LIMIT, false).catch(() => []),
      getTopAgenciesForRecipient(childUeis, profile.rollup_uei, TOP_AGENCIES_LIMIT, false).catch(() => []),
      getYearlyTotalsForRecipient(childUeis, profile.rollup_uei, false).catch(() => []),
      getSetAsideHistoryForRecipient(childUeis, profile.rollup_uei, false).catch(() => []),
      loadAwardsWarehouseCoverage().catch(() => null),
    ]);

    // Pass 2 — per-surface cold fill only when the cache marks a MISS/FAILURE.
    // A successfully cached empty [] is confirmed emptiness (bqResultState='empty')
    // and must NOT consume cold budget or become budget_limited when permission is denied.
    // Cyrus: warm agencies + unavailable recent-awards:5 still fills awards alone.
    let enrichmentStatus: 'complete' | 'budget_limited' = 'complete';
    const hasAwards = (profile.award_count ?? 0) > 0;
    const needAwards = hasAwards && bqUnavailable(awardsCacheKey, awards.length);
    const needAgencies = hasAwards && bqUnavailable(agenciesCacheKey, agencies.length);
    const needYearly = hasAwards && bqUnavailable(yearlyCacheKey, yearly.length);
    const needSetAside = hasAwards && bqUnavailable(setAsideCacheKey, setAsideHist.length);
    if (needAwards || needAgencies || needYearly || needSetAside) {
      if (resolvedCold || (await allowColdLookup())) {
        const [a2, g2, y2, s2] = await Promise.all([
          needAwards
            ? getRecentAwardsForRecipient(childUeis, profile.rollup_uei, RECENT_LIMIT, true).catch(() => [])
            : Promise.resolve(awards),
          needAgencies
            ? getTopAgenciesForRecipient(childUeis, profile.rollup_uei, TOP_AGENCIES_LIMIT, true).catch(() => [])
            : Promise.resolve(agencies),
          needYearly
            ? getYearlyTotalsForRecipient(childUeis, profile.rollup_uei, true).catch(() => [])
            : Promise.resolve(yearly),
          needSetAside
            ? getSetAsideHistoryForRecipient(childUeis, profile.rollup_uei, true).catch(() => [])
            : Promise.resolve(setAsideHist),
        ]);
        awards = a2;
        agencies = g2;
        yearly = y2;
        setAsideHist = s2;
      } else {
        enrichmentStatus = 'budget_limited';
        console.warn('[p0-2] enrichment budget_limited', JSON.stringify({
          tool: 'get_contractor_profile', rollup_uei: profile.rollup_uei,
          award_count: profile.award_count,
          need: { awards: needAwards, agencies: needAgencies, yearly: needYearly, setAside: needSetAside },
        }));
      }
    }

    // Still-unavailable after attempt → not a genuine zero.
    if (
      hasAwards &&
      (bqUnavailable(awardsCacheKey, awards.length) ||
        bqUnavailable(agenciesCacheKey, agencies.length) ||
        bqUnavailable(yearlyCacheKey, yearly.length) ||
        bqUnavailable(setAsideCacheKey, setAsideHist.length))
    ) {
      enrichmentStatus = 'budget_limited';
    }

    const setAsideUnavailable =
      hasAwards && bqUnavailable(setAsideCacheKey, setAsideHist.length);

    const series = yearly.map((y) => ({
      fiscalYear: y.fiscal_year,
      totalObligations: Number(y.total_obligated || 0),
      // Pass through only when present — never invent from net.
      positiveObligations:
        y.positive_obligations == null ? undefined : Number(y.positive_obligations),
      deobligations: y.deobligations == null ? undefined : Number(y.deobligations),
      awardCount: Number(y.award_count || 0),
    }));
    const activity = deriveActivityFromSeries(series);
    const counting = buildCountingBases({
      uniqueAwards: profile.award_count ?? 0,
      series,
      recentActions: awards.map((a) => ({ awardId: a.award_id })),
    });
    const coverageTs = describeCoverageTimestamp({
      lastRecipientActionDate: profile.last_action_date ?? null,
      warehouseMaxActionDate: warehouseCoverage?.clocks?.sourceActionMax ?? null,
      ingest: warehouseCoverage
        ? {
            last_built: warehouseCoverage.lastBuilt,
            acquired_at: warehouseCoverage.clocks?.acquiredAt ?? null,
            merged_at: warehouseCoverage.clocks?.mergedAt ?? null,
            recipients_rebuilt_at: warehouseCoverage.clocks?.recipientsRebuiltAt ?? null,
            freshness: warehouseCoverage.freshness,
          }
        : null,
    });
    const agenciesServed = profile.distinct_agency_count ?? agencies.length;
    // Reuse warehouse set-aside aggregation (same query as award-history drawer).
    // Do NOT invent "complete" from a capped recent-action sample.
    const historicalSetAsides = summarizeHistoricalSetAsides(
      setAsideUnavailable
        ? []
        : setAsideHist.map((r) => ({
            setAside: r.set_aside,
            lastActionFy: r.last_action_fy == null ? null : Number(r.last_action_fy),
            firstObservedPositiveActionFy:
              r.first_observed_positive_action_fy == null
                ? null
                : Number(r.first_observed_positive_action_fy),
            contributingUeis: r.contributing_ueis ?? childUeis,
            supportingActions: (r.supporting_actions ?? []).map((a) => ({
              uei: a?.uei ?? null,
              award_id: a?.award_id ?? null,
              fiscal_year: a?.fiscal_year == null ? null : Number(a.fiscal_year),
              obligation_amount:
                a?.obligation_amount == null ? null : Number(a.obligation_amount),
              action_date: a?.action_date ?? null,
            })),
          })),
      {
        coverage: setAsideUnavailable ? 'unavailable' : 'complete',
        scope: { kind: 'profile_rollup', uei_count: childUeis.length },
        scopeNote:
          childUeis.length > 1
            ? `Aggregated across warehouse award actions for this profile's UEI set (${childUeis.length} UEIs on the rollup; not derived from the capped recent_awards sample). Award origin is not established by this query.`
            : `Aggregated across warehouse award actions for this profile's UEI set (not derived from the capped recent_awards sample). Award origin is not established by this query.`,
      },
    );

    const shapedAgencies = agencies.map((a) => ({
      awarding_agency: a.awarding_agency,
      total_amount: a.total_amount,
      pct_of_total: a.pct_of_total,
      // Never fabricate zero award counts when the query does not return them.
      count: null as number | null,
      count_unavailable: true,
    }));

    const shapedAwards = awards.map((r) => {
      const range = assessDateRange(r.pop_start_date, r.pop_end_date);
      const modNumber = r.mod_number ?? null;
      return {
        award_id: r.award_id,
        piid: r.piid,
        mod_number: modNumber,
        mod_classification: classifyModNumber(modNumber),
        is_modification: isModificationAction(modNumber),
        awarding_agency: r.awarding_agency,
        awarding_office: r.awarding_office,
        naics_code: r.naics_code,
        naics_description: r.naics_description,
        description: r.description,
        obligation_amount: r.obligation_amount,
        action_date: r.action_date,
        pop_start_date: r.pop_start_date,
        pop_end_date: r.pop_end_date,
        date_range_assessment: range.assessment,
        date_range_valid: dateRangeValidFlag(r.pop_start_date, r.pop_end_date),
        date_range_issue: range.issue,
        pop_state: r.pop_state,
        set_aside: r.set_aside,
        grain: 'obligation_action' as const,
      };
    });

    return {
      ok: true,
      found: true,
      resolution: 'unique',
      match_status: 'unique',
      source: totalsScope === 'single_uei' ? 'recipients' : 'recipients_rollup',
      coverage: {
        dataset: totalsScope === 'single_uei' ? 'recipients' : 'recipients_rollup',
        measure: 'total_obligated',
        scope: totalsScope,
        // Recipient last action — NOT warehouse max and NOT ingest freshness.
        as_of: profile.last_action_date ?? null,
        as_of_meaning: coverageTs.last_recipient_action_meaning,
        warehouse_max_action_date: coverageTs.warehouse_max_action_date,
        ingest: coverageTs.ingest,
        coverage_complete_established: coverageTs.coverage_complete_established,
        freshness_note: coverageTs.freshness_note,
        coverage_timestamp: coverageTs,
        not_equivalent_to: totalsScope === 'single_uei'
          ? 'recipients_rollup.total_obligated'
          : 'recipients.total_obligated',
      },
      company: {
        name: profile.rollup_name,
        uei: profile.rollup_uei,
        location: [profile.city, profile.state].filter(Boolean).join(', ') || null,
        total_obligated: profile.total_obligated,
        award_count: profile.award_count,
        agencies_served: agenciesServed,
        first_award: profile.first_action_date,
        last_award: profile.last_action_date,
        last_positive_obligation_fy: activity.last_positive_obligation_fy,
        activity_status: activity.activity_status,
        activity_note: activity.activity_note,
        activity_observation_period: activity.observation_period,
        obligations_are_not_revenue: true,
      },
      counting_bases: counting,
      top_agencies: shapedAgencies,
      top_agencies_returned: shapedAgencies.length,
      top_agencies_limit: TOP_AGENCIES_LIMIT,
      top_agencies_capped: agenciesServed > shapedAgencies.length,
      top_agencies_note:
        agenciesServed > shapedAgencies.length
          ? `Showing top ${shapedAgencies.length} of ${agenciesServed} agencies by net obligations (includes $0/negative nets). Cap is explicit.`
          : 'Agency list includes $0 and negative net totals when present.',
      recent_awards: shapedAwards,
      recent_awards_note:
        'recent_awards are dollar-bearing obligation actions (often modifications). See counting_bases for unique awards in this sample.',
      historical_set_asides: historicalSetAsides,
      // P0-2 invariant: when award_count > 0 and enrichment was not actually queried,
      // empty arrays must NEVER be presented as complete data.
      enrichment_status: enrichmentStatus,
      totals_note: SHORT_TOTALS_NOTE,
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

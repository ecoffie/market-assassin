/**
 * MCP tool: rank_offices_by_early_signal — WHICH BUYING OFFICES TELEGRAPH WORK
 * before they solicit it, for a given NAICS set.
 *
 * The capture question this answers is "where do I spend relationship time?",
 * which a flat opportunity list cannot. Department-level numbers actively
 * mislead: DoD as a whole is ~17% early-stage, but that average is made of
 * offices at 0% (DLA parts desks, everything posts as a short-fuse solicitation)
 * and offices at 75-85% (NAVAIR, NAVFAC Pacific, AFRL — program shops that shape
 * requirements in the open). Ranking by office separates them.
 *
 * Wraps src/lib/opportunities/office-early-signal.ts (Supabase reads + DoDAAC
 * decode, no LLM). tier: metered, credits: 5. `_meta` always ships;
 * `_ai_hint` OFF by default.
 */
import { createClient } from '@supabase/supabase-js';
import { rankOfficesByEarlySignal, type OfficeSignalRow } from '@/lib/opportunities/office-early-signal';
import { mcpFlags } from '@/lib/mcp/flags';

export interface OfficeEarlySignalInput {
  naics?: string;
  department?: string;
  min_opportunities?: number;
  limit?: number;
}

export interface OfficeEarlySignalResult {
  queried: Record<string, string | number>;
  offices: OfficeSignalRow[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    count: number;
    totalOpportunities: number;
    totalEarlyStage: number;
    distinctOffices: number;
  };
}

export async function officeEarlySignal(
  input: OfficeEarlySignalInput,
): Promise<OfficeEarlySignalResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const naicsCodes = (input.naics || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const res = await rankOfficesByEarlySignal(supabase, {
    naicsCodes,
    department: input.department,
    minOpportunities: input.min_opportunities,
    limit: input.limit,
  });

  const queried: Record<string, string | number> = {};
  if (input.naics) queried.naics = input.naics;
  if (input.department) queried.department = input.department;
  if (input.min_opportunities) queried.min_opportunities = input.min_opportunities;

  const grounded = res.offices.length > 0;
  const result: OfficeEarlySignalResult = {
    queried,
    offices: res.offices,
    _meta: {
      grounded,
      degraded: res.degraded,
      count: res.offices.length,
      totalOpportunities: res.totals.opportunities,
      totalEarlyStage: res.totals.earlyStage,
      distinctOffices: res.totals.distinctOffices,
    },
  };

  if (mcpFlags.aiHint) {
    const top = res.offices[0];
    result._ai_hint = {
      summary: res.degraded
        ? 'Office ranking errored — retry; do not state that an office has no early signal.'
        : grounded
        ? `${res.offices.length} office(s) ranked from ${res.totals.opportunities} active opportunities across ${res.totals.distinctOffices} buying offices. Top: ${top.officeName ?? top.dodaac} — ${top.earlyStage} early-stage of ${top.opportunities} (${top.pctEarly}%).`
        : 'No offices met the threshold. Widen the NAICS set or lower min_opportunities.',
      how_to_use: grounded
        ? 'earlyStage = Sources Sought + Presolicitation postings, i.e. work announced BEFORE a solicitation exists — the window where a requirement can still be shaped. '
          + 'Rank is by COUNT of early postings, then rate: a 1-of-1 office is 100% but is not a target. '
          + 'pctEarly is the behavioural tell — a low-percentage office buys off short-fuse solicitations (bid it when it posts), a high-percentage office talks to industry first (go meet them). '
          + 'lifetimeAwards/lifetimeObligated say whether the office is actually busy, so a high rate on a dormant office is not mistaken for opportunity. '
          + 'Recommend RELATIONSHIP action for high-pctEarly offices (capability briefing, respond to the sources-sought) and BID action for low ones.'
        : 'No grounded offices; say none matched rather than naming an office.',
      key_caveats: [
        'Anchored on the 6-char DoDAAC prefixing a solicitation number — DoD/DLA/Navy/Army/Air Force are office-precise; most civilian agencies do not use this convention and will be absent.',
        'Counts are ACTIVE opportunities only — a snapshot, not a trailing average. A quiet week can reorder small offices.',
        'An office missing from dodaac_directory keeps its DoDAAC but has a null officeName. That is a decode gap, not a fake office.',
      ],
    };
  }

  return result;
}

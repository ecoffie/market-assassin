/**
 * C2 evidence groups — the pure pieces (Agent 3, 2026-11-14). No dependency on find-opportunities.ts, so both
 * find_opportunities and evidence-groups.ts can import it without a circular import.
 *
 * The groups map Agent 1's released Open evidence classes; nothing here classifies a record.
 */
import { interpretMarket, type MarketInterpretation } from './market-interpretation';
import type { OpenRelevanceClass } from './open-relevance';
import type { DiscoveryPlan } from '@/lib/discovery';

export type EvidenceGroup = 'direct' | 'related' | 'other';

/** The only mapping. A related-market notice is never "direct"; anything not DIRECT or RELATED is "other". */
export function evidenceGroupOf(cls: OpenRelevanceClass): EvidenceGroup {
  if (cls === 'DIRECT_MATCH') return 'direct';
  if (cls === 'RELATED_MARKET_CANDIDATE') return 'related';
  return 'other';
}

/**
 * The capability the Open labeller needs for a plan: the plan's keyword residual plus the primary buyer. This is the
 * ONE derivation; find_opportunities (interpretQuery) and evidence-groups.ts both call it.
 */
export function evidenceCapability(plan: DiscoveryPlan, agency?: string | null): MarketInterpretation['capability'] {
  return evidenceMarket(plan, agency).capability;
}
export function evidenceMarket(plan: DiscoveryPlan, agency?: string | null): MarketInterpretation {
  const keywordText = plan.intent.residualKind === 'keyword' ? plan.intent.residual.replace(/^"|"$/g, '') : '';
  const primaryAgency = String(agency || '').trim() || plan.buyers[0]?.requested || null;
  return interpretMarket(keywordText, primaryAgency);
}

export interface EvidenceCountsScope {
  unit: 'rows';
  /** Rows the labeller actually classified (the candidate window). */
  rows_classified: number;
  /** The window's row limit. */
  window_limit: number;
  order: 'response_deadline';
  /** Classes evidence_counts reports (it does not count "other"). */
  classes: Array<'DIRECT_MATCH' | 'RELATED_MARKET_CANDIDATE'>;
  /** true only when the window holds every matched row (then evidence_totals is complete). */
  covers_full_result: boolean;
}

export type EvidenceTotals =
  | { complete: true; unit: 'rows'; total: number; direct: number; related: number; other: number }
  | {
      complete: false; unit: 'rows'; total: number | null; direct: null; related: null; other: null;
      reason: 'not_computed_over_window' | 'total_unknown' | 'company_union';
    };

/**
 * Full-result group totals for an Open horizon, computed ONLY from rows already classified (no extra query):
 * complete when the classified window IS the whole matched result. A window is the whole result only when the exact
 * matched total is known, equals the rows classified, and the rows are not a union with a second (company) plan.
 * Every other case reports null groups with a reason; unknown is never 0.
 */
export function openEvidenceSummary(args: {
  classes: OpenRelevanceClass[];
  matchedCount: number | null;
  windowLimit: number;
  companyUnion: boolean;
}): { scope: EvidenceCountsScope; totals: EvidenceTotals } {
  const rows = args.classes.length;
  const full = !args.companyUnion && args.matchedCount != null && args.matchedCount === rows;
  const scope: EvidenceCountsScope = {
    unit: 'rows', rows_classified: rows, window_limit: args.windowLimit, order: 'response_deadline',
    classes: ['DIRECT_MATCH', 'RELATED_MARKET_CANDIDATE'], covers_full_result: full,
  };
  if (!full) {
    const reason = args.companyUnion ? 'company_union' : args.matchedCount == null ? 'total_unknown' : 'not_computed_over_window';
    return { scope, totals: { complete: false, unit: 'rows', total: args.matchedCount, direct: null, related: null, other: null, reason } };
  }
  const t = { direct: 0, related: 0, other: 0 };
  for (const c of args.classes) t[evidenceGroupOf(c)] += 1;
  return { scope, totals: { complete: true, unit: 'rows', total: rows, ...t } };
}

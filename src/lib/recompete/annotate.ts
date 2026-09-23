/**
 * annotateRecompeteRow — the ONE place a stored recompete row becomes a row a customer sees.
 *
 * Every surface that reads `recompete_opportunities` for display runs through this, so the three
 * IMI corrections (2026-09-22) cannot land on one surface and miss another:
 *
 *   B1 timing   — `estimated_recompete_date` is never a past date for a contract that has not
 *                 ended; the PoP − 12mo capture date is kept as `capture_start_date`.
 *   B2 lineage  — an order under a vehicle is labelled as one (`award_kind`, parent vehicle) and
 *                 carries no standalone recompete date.
 *   B3 location — `place_of_performance_state` is the canonical PoP column or NULL; a value the
 *                 record's own description contradicts is withdrawn (`contested`), never replaced.
 *
 * Consumers: queryExpiringContracts (MCP get_expiring_contracts, briefings, market report,
 * capability match, recompete map), coming-back-to-market alerts, /api/recompete (panel), and
 * find_opportunities' Coming back horizon.
 */
import { overlayRecompeteTiming, type RecompeteDateStatus } from './timing';
import { parseAwardLineage, type AwardKind } from './award-lineage';
import { resolvePlaceOfPerformance, type PopStateSource, type PopStateStatus } from './pop-integrity';

export interface RecompeteRowAnnotations {
  estimated_recompete_date: string | null;
  capture_start_date: string | null;
  recompete_date_status: RecompeteDateStatus | null;
  recompete_date_basis: 'pop_end_minus_12_months' | null;
  lead_time_months: number | null;
  award_kind: AwardKind;
  parent_vehicle_piid: string | null;
  parent_vehicle_id: string | null;
  place_of_performance_state: string | null;
  place_of_performance_state_source: PopStateSource | null;
  place_of_performance_state_status: PopStateStatus;
  place_of_performance_state_reported: string | null;
  place_of_performance_contest: { named_installations: string[]; installation_state: string } | null;
}

type AnnotatableRow = {
  contract_id?: string | null;
  contract_type?: string | null;
  description?: string | null;
  place_of_performance_state?: string | null;
  period_of_performance_current_end?: string | null;
  estimated_recompete_date?: string | null;
  lead_time_months?: number | null;
};

export function recompeteRowAnnotations(row: AnnotatableRow, now: Date = new Date()): RecompeteRowAnnotations {
  const timing = overlayRecompeteTiming(row.period_of_performance_current_end, now);
  const lineage = parseAwardLineage(row);
  const pop = resolvePlaceOfPerformance(row);
  const isOrder = lineage.award_kind === 'order_under_vehicle';
  return {
    // An order's own PoP end is not a recompete event; the date is withheld, not moved.
    estimated_recompete_date: isOrder ? null : timing?.estimated_recompete_date ?? null,
    capture_start_date: timing?.capture_start_date ?? null,
    recompete_date_status: isOrder ? 'order_under_vehicle' : timing?.recompete_date_status ?? null,
    recompete_date_basis: timing?.recompete_date_basis ?? null,
    lead_time_months: timing?.lead_time_months ?? row.lead_time_months ?? null,
    award_kind: lineage.award_kind,
    parent_vehicle_piid: lineage.parent_vehicle_piid,
    parent_vehicle_id: lineage.parent_vehicle_id,
    place_of_performance_state: pop.state,
    place_of_performance_state_source: pop.source,
    place_of_performance_state_status: pop.status,
    place_of_performance_state_reported: pop.reported_state,
    place_of_performance_contest: pop.contest,
  };
}

/** Row + annotations, annotations winning (they are the corrected view of the same fields). */
export function annotateRecompeteRow<T extends AnnotatableRow>(row: T, now: Date = new Date()): T & RecompeteRowAnnotations {
  return { ...row, ...recompeteRowAnnotations(row, now) };
}

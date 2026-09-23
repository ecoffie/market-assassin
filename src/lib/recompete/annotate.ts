/**
 * annotateRecompeteRow — the ONE place a stored recompete row becomes a row a customer sees.
 *
 * Every surface that reads `recompete_opportunities` for display runs through this, so the IMI
 * corrections (2026-09-22) cannot land on one surface and miss another:
 *
 *   timing   — `capture_start_date` (PoP end − 12mo, a SUGGESTED capture start) with its stated
 *              `capture_start_basis`. `estimated_recompete_date` is always NULL: nothing we store
 *              independently establishes a recompete date, and the capture start is not one.
 *              (The DB trigger column is overridden here, at read time.)
 *   lineage  — an order under a vehicle is labelled as one (`award_kind`, parent vehicle) and
 *              carries no standalone recompete date.
 *   location — `place_of_performance_state` is USASpending's reported place of performance,
 *              exposed AS REPORTED (Eric, 2026-09-22: no free-text override, no alternate PoP
 *              authority). The source note says exactly that.
 *
 * Consumers: queryExpiringContracts (MCP get_expiring_contracts, briefings, market report,
 * capability match, recompete map), coming-back-to-market alerts, /api/recompete (panel), and
 * find_opportunities' Coming back horizon.
 */
import { overlayRecompeteTiming, CAPTURE_START_BASIS } from './timing';
import { parseAwardLineage, type AwardKind } from './award-lineage';

export const POP_SOURCE_NOTE = 'Place of performance as reported by USASpending.' as const;

export interface RecompeteRowAnnotations {
  /** Always null — see timing.ts. Never a copy of capture_start_date or PoP end. */
  estimated_recompete_date: null;
  capture_start_date: string | null;
  capture_start_basis: typeof CAPTURE_START_BASIS | null;
  capture_start_passed: boolean | null;
  lead_time_months: number | null;
  award_kind: AwardKind;
  parent_vehicle_piid: string | null;
  parent_vehicle_id: string | null;
  /** The provenance of place_of_performance_state (the value itself is untouched). */
  place_of_performance_source_note: typeof POP_SOURCE_NOTE;
}

type AnnotatableRow = {
  contract_id?: string | null;
  contract_type?: string | null;
  place_of_performance_state?: string | null;
  period_of_performance_current_end?: string | null;
  estimated_recompete_date?: string | null;
  lead_time_months?: number | null;
};

export function recompeteRowAnnotations(row: AnnotatableRow, now: Date = new Date()): RecompeteRowAnnotations {
  const timing = overlayRecompeteTiming(row.period_of_performance_current_end, now);
  const lineage = parseAwardLineage(row);
  return {
    estimated_recompete_date: null,
    capture_start_date: timing?.capture_start_date ?? null,
    capture_start_basis: timing?.capture_start_basis ?? null,
    capture_start_passed: timing?.capture_start_passed ?? null,
    lead_time_months: timing?.lead_time_months ?? row.lead_time_months ?? null,
    award_kind: lineage.award_kind,
    parent_vehicle_piid: lineage.parent_vehicle_piid,
    parent_vehicle_id: lineage.parent_vehicle_id,
    place_of_performance_source_note: POP_SOURCE_NOTE,
  };
}

/** Row + annotations. place_of_performance_state is passed through exactly as stored. */
export function annotateRecompeteRow<T extends AnnotatableRow>(row: T, now: Date = new Date()): T & RecompeteRowAnnotations {
  return { ...row, ...recompeteRowAnnotations(row, now) };
}

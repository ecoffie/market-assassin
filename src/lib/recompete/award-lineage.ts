/**
 * Award lineage — is this recompete row a standalone contract, or an ORDER under a vehicle?
 *
 * IMI test (2026-09-22): 15 of the 25 rows get_expiring_contracts returned for NAICS 2382 / GA
 * were task/delivery orders. Four were RCA Contracting orders under Robins Mech-Elec II
 * (FA8501-24-D-0005), a vehicle open for orders until 2029-04-23. An order is not competed again
 * on its own; the next order is placed under the same vehicle. Listing each order as a
 * "recompete" told the client four things were coming back to market when none were.
 *
 * No new source. The lineage is already in the row:
 *   - `contract_id` is USASpending's generated_internal_id, which for a contract award is
 *     `CONT_AWD_<piid>_<agency>_<parent IDV piid>_<parent agency>` — the parent is `-NONE-`
 *     for a definitive contract / purchase order. Verified against the award detail endpoint
 *     (`parent_award.generated_unique_award_id` = `CONT_IDV_FA850124D0005_9700` for
 *     CONT_AWD_FA850126F0034_9700_FA850124D0005_9700).
 *   - `contract_type` ("DELIVERY ORDER", "BPA CALL", "DEFINITIVE CONTRACT", "PURCHASE ORDER") is
 *     the fallback for older rows whose contract_id is a raw PIID.
 *
 * Pure — no I/O.
 */

export type AwardKind = 'order_under_vehicle' | 'standalone_contract' | 'unknown';

export interface AwardLineage {
  award_kind: AwardKind;
  /** The parent IDV / BPA PIID when the row is an order and the parent is recorded. */
  parent_vehicle_piid: string | null;
  /** USASpending id of the parent (`CONT_IDV_<piid>_<agency>`) — the key the award API takes. */
  parent_vehicle_id: string | null;
  /** Which stored field established the kind. null = nothing did (unknown). */
  lineage_source: 'contract_id' | 'contract_type' | null;
}

const GENERATED_AWARD_ID = /^CONT_AWD_(.+)_([0-9A-Z]{4})_(.+)_([0-9A-Z]{4}|-NONE-)$/i;

const ORDER_TYPES = new Set(['DELIVERY ORDER', 'BPA CALL', 'TASK ORDER']);
const STANDALONE_TYPES = new Set(['DEFINITIVE CONTRACT', 'PURCHASE ORDER']);

export function parseAwardLineage(row: {
  contract_id?: string | null;
  contract_type?: string | null;
}): AwardLineage {
  const id = String(row.contract_id || '').trim();
  const m = GENERATED_AWARD_ID.exec(id);
  if (m) {
    const parentPiid = m[3].toUpperCase();
    const parentAgency = m[4].toUpperCase();
    if (parentPiid === '-NONE-') {
      return { award_kind: 'standalone_contract', parent_vehicle_piid: null, parent_vehicle_id: null, lineage_source: 'contract_id' };
    }
    return {
      award_kind: 'order_under_vehicle',
      parent_vehicle_piid: parentPiid,
      parent_vehicle_id: parentAgency === '-NONE-' ? null : `CONT_IDV_${parentPiid}_${parentAgency}`,
      lineage_source: 'contract_id',
    };
  }
  const type = String(row.contract_type || '').trim().toUpperCase();
  if (ORDER_TYPES.has(type)) {
    // An order whose parent is not recorded: it is still NOT a standalone recompete, but the
    // vehicle is unknown — never invented from the PIID.
    return { award_kind: 'order_under_vehicle', parent_vehicle_piid: null, parent_vehicle_id: null, lineage_source: 'contract_type' };
  }
  if (STANDALONE_TYPES.has(type)) {
    return { award_kind: 'standalone_contract', parent_vehicle_piid: null, parent_vehicle_id: null, lineage_source: 'contract_type' };
  }
  return { award_kind: 'unknown', parent_vehicle_piid: null, parent_vehicle_id: null, lineage_source: null };
}

/**
 * PostgREST `.or()` expression selecting rows parseAwardLineage would NOT call an order:
 * a generated award id whose parent slot is `-NONE-` (standalone), or a non-generated id whose
 * stored award type is not an order type (standalone or unknown). Applied INSIDE a fetch so a
 * row cap is spent on standalone contracts, not on orders that are then thrown away.
 * Kept beside parseAwardLineage so the two definitions cannot drift apart unnoticed
 * (award-lineage.unit.test.ts pins both).
 */
export const NOT_ORDER_UNDER_VEHICLE_OR =
  'contract_id.like.%-NONE-_-NONE-,' +
  'and(contract_id.not.like.CONT_AWD_%,or(contract_type.is.null,contract_type.not.in.("DELIVERY ORDER","BPA CALL","TASK ORDER")))';

/**
 * Recompete task-order spend — the ACTUAL money flowing under a contract vehicle,
 * not the parent ceiling. See docs/strategy/PRD-recompete-task-order-spend.md.
 *
 * ⚠️ THE JOIN-KEY TRAP (measured, 2026-07-26): a raw `piid = X OR parent_piid = X`
 * match against BigQuery `awards` is NOT safe — PIIDs are not globally unique.
 * Measured live: recompete PIID "0002" (Peraton Government Communications) naively
 * matches 64,016 transactions / $28.7B / 11,207 distinct recipient_uei — an
 * over-match sweeping every unrelated award anywhere that happens to reuse that
 * short PIID string (mod numbers / degenerate 4-char PIIDs are the risk class).
 * Adding `recipient_uei = incumbent_uei` as a co-filter collapses the SAME query to
 * 66 txns / $35.5M / 1 city — the real task-order stream. Verified against a dozen
 * more PIIDs spanning $2M-$196M contracts: every one returns TENS of task orders
 * (never thousands) once scoped by UEI. The awards table is clustered on
 * (recipient_uei, recipient_name), so this filter is also what keeps the BigQuery
 * scan cheap (~460MB measured, not the 63M-row full table).
 *
 * So the query is ALWAYS: `recipient_uei = @uei AND (piid = @piid OR parent_piid = @piid)`.
 * A recompete row with no incumbent_uei (the pre-Jul-16 grouped/synthetic rows, or a
 * PIID carrying the "(+N more)" collapsed-vehicle suffix) cannot be safely scoped —
 * getTaskOrders() refuses those inputs rather than guess, and the caller degrades to
 * showing the ceiling only (see `TaskOrderResult.reason`).
 */
import { bqQuery } from '@/lib/bigquery/client';
import { withCache } from '@/lib/mcp/external-cache';
import { geocodeCity, stableSeed } from '@/lib/geo/city-geocode';
import { normalizeStateCode } from '@/lib/utils/us-states';

const BQ_AWARDS = '`market-assasin.usaspending.awards`';
const CACHE_API_TYPE = 'recompete:task-orders';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days — task-order streams change slowly; a
// stale week costs nothing (this is directional "is this vehicle paying out" intel, not a
// live ledger), and it keeps the BQ scan to once/week per contract instead of once/click.

export interface TaskOrderTxn {
  obligation: number;
  actionDate: string | null; // YYYY-MM-DD
  popCity: string | null;
  popState: string | null;
  lat: number | null;
  lng: number | null;
  locPrecision: 'city' | 'state' | null; // null = state itself unrecognized, no pin possible
  recipientUei: string;
}

export interface TaskOrderResult {
  /** True when a real BigQuery lookup ran (scoped join succeeded) — false means
   *  degrade-to-ceiling, `reason` explains why. */
  grounded: boolean;
  reason?: 'no_incumbent_uei' | 'collapsed_vehicle_piid' | 'no_piid' | 'query_error' | 'no_task_orders';
  txns: TaskOrderTxn[];
  totalActual: number;
  distinctCities: number;
  fromCache: boolean;
}

/** A PIID carrying the "(+N more)" suffix is a collapsed multiple-award-vehicle
 *  representative (src/app/api/recompete/route.ts GROUP_FETCH_CAP rollup) — it does
 *  NOT correspond to one real USASpending PIID, so a task-order join against it would
 *  either miss entirely or (worse) silently match the wrong single winner. */
function isCollapsedVehiclePiid(piid: string): boolean {
  return /\(\+\d+\s*more\)\s*$/i.test(piid);
}

/**
 * Fetch the real task-order transaction stream for one recompete contract, scoped
 * by the PROVEN safe join key (recipient_uei + piid/parent_piid lineage). Cached
 * 7 days in `mcp_external_cache` (keyed by piid+uei) so repeat drawer opens for the
 * same contract are free. Bounded: a contract-scoped query returns tens of rows,
 * never a global scan.
 *
 * Never throws — a BQ error or missing input returns `grounded:false` with a
 * `reason`, and the caller shows the ceiling only (graceful degrade).
 */
export async function getTaskOrders(input: {
  piid: string | null | undefined;
  incumbentUei: string | null | undefined;
}): Promise<TaskOrderResult> {
  const piid = (input.piid || '').trim();
  const uei = (input.incumbentUei || '').trim();

  const empty = (reason: TaskOrderResult['reason']): TaskOrderResult => ({
    grounded: false, reason, txns: [], totalActual: 0, distinctCities: 0, fromCache: false,
  });

  if (!piid) return empty('no_piid');
  if (isCollapsedVehiclePiid(piid)) return empty('collapsed_vehicle_piid');
  if (!uei) return empty('no_incumbent_uei');

  try {
    const { value: rows, fromCache } = await withCache<RawTxnRow[]>(
      CACHE_API_TYPE,
      { piid, uei },
      CACHE_TTL_SECONDS,
      () => fetchTaskOrderRows(piid, uei),
    );

    if (!rows.length) return { ...empty('no_task_orders'), fromCache };

    const txns: TaskOrderTxn[] = rows.map((r) => {
      const state = normalizeStateCode(r.pop_state || '');
      const city = (r.pop_city || '').trim();
      const geo = (city || state) ? geocodeCity(city, state, stableSeed(`${piid}:${r.action_date}:${r.obligation_amount}`)) : null;
      return {
        obligation: Number(r.obligation_amount) || 0,
        actionDate: r.action_date || null,
        popCity: city || null,
        popState: state,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        locPrecision: geo?.precision ?? null,
        recipientUei: r.recipient_uei,
      };
    });

    const totalActual = txns.reduce((sum, t) => sum + t.obligation, 0);
    const distinctCities = new Set(
      txns.map((t) => (t.popCity ? `${t.popCity}|${t.popState}` : t.popState || '')).filter(Boolean),
    ).size;

    return { grounded: true, txns, totalActual, distinctCities, fromCache };
  } catch (err) {
    console.error('[recompete/task-orders] BigQuery lookup failed (degrading to ceiling):', err);
    return empty('query_error');
  }
}

interface RawTxnRow {
  obligation_amount: number;
  action_date: string | null;
  pop_city: string | null;
  pop_state: string | null;
  recipient_uei: string;
}

/**
 * The proven-safe query: scoped by BOTH the PIID lineage (piid OR parent_piid) AND
 * recipient_uei. Clustered-column filter keeps the scan cheap (~460MB measured on
 * N0003921F3007, vs a multi-GB unscoped scan of the 63M-row table). Ordered newest
 * first (dated obligation stream reads top-down like a ledger). Capped at 500 rows
 * as a defensive ceiling — every measured real contract returns tens, never
 * hundreds; 500 protects against an unforeseen edge case without truncating any
 * real contract silently.
 */
async function fetchTaskOrderRows(piid: string, uei: string): Promise<RawTxnRow[]> {
  return bqQuery<RawTxnRow>({
    query: `
      SELECT
        obligation_amount,
        CAST(action_date AS STRING) AS action_date,
        pop_city,
        pop_state,
        recipient_uei
      FROM ${BQ_AWARDS}
      WHERE recipient_uei = @uei
        AND (piid = @piid OR parent_piid = @piid)
      ORDER BY action_date DESC
      LIMIT 500
    `,
    params: { piid, uei },
    // Clustered on (recipient_uei, recipient_name) — a scoped lookup measures well
    // under 1GB; this cap is a hard ceiling against a pathological case, not the
    // expected cost (~$0.003/query at 460MB).
    maximumBytesBilled: String(2 * 1024 * 1024 * 1024),
  });
}

/** Compact money for the drawer stream: $Nk / $N.NM / $N.NB — mirrors the map's
 *  pin-tag formatter (opportunity-map/route.ts mCompact) so figures read the same
 *  everywhere on the surface. */
export function compactMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(n / 1e9 >= 100 ? 0 : 1).replace(/\.0$/, '')}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(n / 1e6 >= 100 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

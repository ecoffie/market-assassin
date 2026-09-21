/**
 * resolve-uei — turn a UEI into exactly ONE canonical company.
 *
 * THE PROBLEM THIS EXISTS FOR
 * ---------------------------
 * A UEI is not unique in `recipients_rollup_merged`. It can appear as a
 * `rollup_uei` (the company IS the rollup parent) and/or inside another
 * rollup's `child_ueis` array (the company was merged under a parent).
 *
 * Measured 2026-08-07 across the whole table:
 *   336,364 distinct UEIs
 *    55,922 unambiguous            (17%)
 *   280,442 AMBIGUOUS              (83%)  ← the default case, not the edge case
 *   273,594 of those have exactly one self-match (rollup_uei = uei)
 *     6,848 have NO self-match at all (child of 2+ different rollups)
 *         0 have more than one self-match
 *   worst case: 9 rows for a single UEI
 *
 * So a naive `JOIN ... ON rollup_uei = uei OR uei IN UNNEST(child_ueis)`
 * duplicates rows for FIVE OUT OF SIX lookups, and picks an arbitrary name.
 * That is how "USA WASTE OF CALIFORNIA INC" ends up rendered as **Zippy Shell**
 * instead of Waste Management — a company its own customers would not recognize.
 *
 * THE TIE-BREAK
 * -------------
 *   1. is_self DESC        — the row where rollup_uei = uei wins. The company's
 *                            own canonical record beats any parent that absorbed it.
 *   2. total_obligated DESC— no self-match (6,848 UEIs): the larger federal
 *                            footprint is the real operating entity. This is what
 *                            picks Waste Management ($137.5M) over Zippy Shell
 *                            ($115.6M) for LVYXJGXKBQG3.
 *   3. award_count DESC    — tiny obligated totals can tie; activity breaks it.
 *   4. rollup_uei ASC      — final deterministic backstop. NEVER leave the order
 *                            partially specified: an unstable sort makes the same
 *                            page render a different company between deploys.
 *
 * Verified against the known-hard cases (all resolve to the recognizable name):
 *   XXNJCWMAKNH8 → BL HARBERT INTERNATIONAL LLC   (self-match beats holdings co)
 *   QQBXQR679KM9 → CLARK CONSTRUCTION LLC          (no self; larger footprint)
 *   LVYXJGXKBQG3 → WASTE MANAGEMENT, INC.          (no self; beats Zippy Shell)
 *   MT9AATHS7ZB5 → TUTOR PERINI CORPORATION        (self-match, identical dupe)
 *   XFJMYSYFJEK4 → LOCKHEED MARTIN CORP            (single row)
 *
 * WHERE TO USE IT
 * ---------------
 * Anything joining `sam_opportunities.awardee_uei` to the contractor rollup:
 * contractor pages, incumbent lookups, recompete matching, MCP tools.
 * Never hand-roll the OR-join again — call this.
 */

/** Fully-qualified rollup table. Kept here so callers don't hardcode the dataset. */
const ROLLUP_TABLE = '`market-assasin.usaspending.recipients_rollup_merged`';

/**
 * The canonical company behind a UEI.
 * `matchedAsChild` is true when the UEI was absorbed into a parent rollup —
 * surface it in the UI ("part of X") rather than silently swapping the name.
 */
export interface ResolvedContractor {
  uei: string;
  rollupUei: string;
  rollupName: string;
  state: string | null;
  city: string | null;
  cageCode: string | null;
  totalObligated: number;
  awardCount: number;
  distinctAgencyCount: number;
  distinctNaicsCount: number;
  childCount: number;
  firstActionDate: string | null;
  lastActionDate: string | null;
  /** true when rollup_uei !== uei, i.e. this UEI sits under a different parent. */
  matchedAsChild: boolean;
  /** How many candidate rows the tie-break had to choose between (1 = clean). */
  candidateCount: number;
}

/**
 * The ranking CTE. Exported so complex queries can inline the same logic instead
 * of re-deriving it — there must be exactly ONE definition of "which row wins".
 *
 * Expects a preceding CTE named `input_ueis(uei STRING)`.
 * Yields one row per input UEI, already deduped.
 */
export const RESOLVE_UEI_CTE = `
  candidates AS (
    -- The UEI is its own rollup parent.
    SELECT i.uei, r.*, TRUE AS is_self
    FROM input_ueis i
    JOIN ${ROLLUP_TABLE} r ON r.rollup_uei = i.uei
    UNION ALL
    -- The UEI was merged under someone else's rollup.
    SELECT i.uei, r.*, FALSE AS is_self
    FROM input_ueis i
    JOIN ${ROLLUP_TABLE} r ON i.uei IN UNNEST(r.child_ueis)
  ),
  ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY uei
        ORDER BY is_self DESC, total_obligated DESC, award_count DESC, rollup_uei ASC
      ) AS rn,
      COUNT(*) OVER (PARTITION BY uei) AS candidate_count
    FROM candidates
  )
`;

/** Columns every resolver query selects, in a stable order. */
const SELECT_COLS = `
    uei,
    rollup_uei,
    rollup_name,
    state,
    city,
    cage_code,
    total_obligated,
    award_count,
    distinct_agency_count,
    distinct_naics_count,
    child_count,
    first_action_date,
    last_action_date,
    NOT is_self AS matched_as_child,
    candidate_count`;

/**
 * BigQuery SQL resolving many UEIs at once, one row each.
 *
 * Batch rather than looping — a per-UEI query pays the full table scan every
 * time. Pass the UEI list as a query PARAMETER (`@ueis`), never string-built,
 * so it stays injection-safe.
 */
export function buildResolveUeisQuery(): string {
  return `
WITH input_ueis AS (
  SELECT DISTINCT uei FROM UNNEST(@ueis) AS uei WHERE uei IS NOT NULL AND uei != ''
),
${RESOLVE_UEI_CTE}
SELECT${SELECT_COLS}
FROM ranked
WHERE rn = 1`;
}

/** Row shape BigQuery returns for the query above. */
interface ResolveRow {
  uei: string;
  rollup_uei: string;
  rollup_name: string;
  state: string | null;
  city: string | null;
  cage_code: string | null;
  total_obligated: number | null;
  award_count: number | null;
  distinct_agency_count: number | null;
  distinct_naics_count: number | null;
  child_count: number | null;
  // BigQuery DATE columns arrive as {value: 'YYYY-MM-DD'} through the client.
  first_action_date: string | { value: string } | null;
  last_action_date: string | { value: string } | null;
  matched_as_child: boolean;
  candidate_count: number;
}

/** BigQuery hands DATE back as {value}, not a string. Normalize both shapes. */
function toDateString(v: string | { value: string } | null): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.value ?? null;
}

/** Map a raw BigQuery row to the public type. */
export function mapResolveRow(row: ResolveRow): ResolvedContractor {
  return {
    uei: row.uei,
    rollupUei: row.rollup_uei,
    rollupName: row.rollup_name,
    state: row.state ?? null,
    city: row.city ?? null,
    cageCode: row.cage_code ?? null,
    totalObligated: Number(row.total_obligated ?? 0),
    awardCount: Number(row.award_count ?? 0),
    distinctAgencyCount: Number(row.distinct_agency_count ?? 0),
    distinctNaicsCount: Number(row.distinct_naics_count ?? 0),
    childCount: Number(row.child_count ?? 0),
    firstActionDate: toDateString(row.first_action_date),
    lastActionDate: toDateString(row.last_action_date),
    matchedAsChild: Boolean(row.matched_as_child),
    candidateCount: Number(row.candidate_count ?? 1),
  };
}

/**
 * Resolve a batch of UEIs to canonical companies.
 *
 * `runQuery` is injected so this module stays free of a BigQuery client import
 * (and is unit-testable without credentials). Pass whatever the caller already
 * uses to query BigQuery.
 *
 * Returns a Map keyed by the INPUT uei. A UEI absent from the map matched
 * nothing in the rollup — that is a normal outcome (roughly 1 in 6 SAM awardees
 * carries no UEI at all, and some UEIs are too new to appear). Callers must
 * handle a miss by falling back to `sam_opportunities.awardee_name`, NOT by
 * hiding the award.
 */
export async function resolveUeis(
  ueis: string[],
  runQuery: (sql: string, params: Record<string, unknown>) => Promise<ResolveRow[]>
): Promise<Map<string, ResolvedContractor>> {
  const clean = Array.from(
    new Set(ueis.map((u) => (u ?? '').trim()).filter((u) => u.length > 0))
  );
  if (clean.length === 0) return new Map();

  const rows = await runQuery(buildResolveUeisQuery(), { ueis: clean });

  const out = new Map<string, ResolvedContractor>();
  for (const row of rows) out.set(row.uei, mapResolveRow(row));
  return out;
}

/** Single-UEI convenience. Prefer resolveUeis() for lists — one scan, not N. */
export async function resolveUei(
  uei: string,
  runQuery: (sql: string, params: Record<string, unknown>) => Promise<ResolveRow[]>
): Promise<ResolvedContractor | null> {
  const map = await resolveUeis([uei], runQuery);
  return map.get(uei.trim()) ?? null;
}

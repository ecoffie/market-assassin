/**
 * Pure helpers for POST /api/app/auto-setup ("Set up my Mindy", Auto mode).
 *
 * The route owns the I/O (auth, profile read, find-agencies fan-out, Supabase
 * insert). The data transforms + branch decisions live here so they are unit
 * tested without a server, auth, or network — the same pattern as
 * keyword-sanitize / keyword-geo-filter.test.ts.
 *
 * These encode the three rules that have actually bitten:
 *   - merge keeps the HIGHEST set-aside-spend duplicate, sorted spend-desc;
 *   - the row clamps a billions spend so a bigint/int column can't reject the
 *     row and silently fail the whole batch;
 *   - an empty result distinguishes "every scan errored" (502) from "genuinely
 *     no buyers" (200) — the silent-failure fix.
 */

/** How many of the top buying agencies Auto seeds into the Target List. */
export const MAX_AGENCIES = 8;

/**
 * Largest set_aside_spending we will persist. Real federal set-aside spend can
 * be billions; clamp so an int/bigint column can't reject the row.
 */
export const SET_ASIDE_SPEND_CLAMP = 9_000_000_000;

export interface ScanAgency {
  name: string;
  contractingOffice?: string;
  subAgency?: string;
  parentAgency?: string;
  agencyCode?: string;
  subAgencyCode?: string;
  officeId?: string;
  location?: string;
  setAsideSpending?: number;
  contractCount?: number;
}

/** Stable dedup key — same agency + same contracting office collapse to one. */
function agencyKey(a: ScanAgency): string {
  return `${(a.name || '').toLowerCase()}|${(a.contractingOffice || '').toLowerCase()}`;
}

/**
 * Merge the per-NAICS-code agency lists into one deduped list, keeping the
 * duplicate with the highest set-aside spend, sorted highest-spend first.
 */
export function mergeScanAgencies(agencyLists: ScanAgency[][]): ScanAgency[] {
  const byKey = new Map<string, ScanAgency>();
  for (const list of agencyLists) {
    for (const a of Array.isArray(list) ? list : []) {
      if (!a || !a.name) continue;
      const key = agencyKey(a);
      const prev = byKey.get(key);
      if (!prev || (a.setAsideSpending || 0) > (prev.setAsideSpending || 0)) {
        byKey.set(key, a);
      }
    }
  }
  return Array.from(byKey.values()).sort(
    (x, y) => (y.setAsideSpending || 0) - (x.setAsideSpending || 0),
  );
}

export interface TargetRowContext {
  rowEmail: string;
  asClient: boolean;
  workspaceId: string | null;
  /** Comma-joined source NAICS, or null. */
  sourceNaics: string | null;
}

export interface TargetRow {
  user_email: string;
  workspace_id: string | null;
  agency_code: string | null;
  agency_name: string;
  sub_agency_code: string | null;
  sub_agency_name: string | null;
  office_code: string | null;
  office_name: string;
  location: string | null;
  source_naics: string | null;
  set_aside_spending: number;
  contract_count: number;
  status: string;
  priority: string;
  added_from: string;
}

/** Build the ADD-ONLY user_target_list row for one scanned agency. */
export function buildTargetRow(a: ScanAgency, ctx: TargetRowContext): TargetRow {
  return {
    user_email: ctx.rowEmail,
    workspace_id: ctx.asClient ? ctx.workspaceId : null,
    agency_code: a.agencyCode || null,
    agency_name: a.name,
    sub_agency_code: a.subAgencyCode || null,
    sub_agency_name: a.subAgency || null,
    office_code: a.officeId || null,
    office_name: a.contractingOffice || a.name,
    location: a.location || null,
    source_naics: ctx.sourceNaics,
    set_aside_spending: Math.min(
      Math.round(a.setAsideSpending || 0),
      SET_ASIDE_SPEND_CLAMP,
    ),
    contract_count: Math.round(a.contractCount || 0),
    status: 'targeting',
    priority: 'medium',
    added_from: 'auto_setup',
  };
}

/**
 * Decide the response when the merged scan is empty. If EVERY code's scan
 * errored, that is a real failure (502) and we surface the first error; if the
 * scans ran clean but matched nothing, it's a genuine empty result (200).
 */
export function summarizeEmptyScan(
  scanErrors: string[],
  codesScannedCount: number,
): { success: false; error: string; scanErrors: string[]; status: number } {
  const allFailed = scanErrors.length > 0 && scanErrors.length === codesScannedCount;
  return {
    success: false,
    error: allFailed
      ? `Market scan failed: ${scanErrors[0]}`
      : 'No matching buying agencies found for your codes.',
    scanErrors: scanErrors.slice(0, 3),
    status: allFailed ? 502 : 200,
  };
}

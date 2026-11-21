/**
 * C2 — direct / related-market / other result groups (Agent 3, 2026-11-14).
 * Plan: tasks/c2-evidence-groups-plan-2026-11-14.md.
 *
 * ONE classifier: every group comes from Agent 1's released `labelOpenRow` (find-opportunities.ts), unmodified. This
 * module only (a) maps its class to a group and (b) counts the groups over the FULL matched set, so that
 *   direct + related + other === total
 * holds for the same plan on every surface that uses it. No SQL re-implementation of the evidence rules (two
 * classifiers drift; the #245 Spending-by-Agency failure).
 *
 * Release control: callers gate on `evidenceGroupsEnabled()` (OPEN_EVIDENCE_GROUPS, literal 'true' only). Nothing here
 * changes retrieval, ranking, NAICS/PSC data or alert sending.
 */
import { labelOpenRow } from './find-opportunities';
import type { CompanyAnchor } from './company-anchor';
import type { MarketInterpretation } from './market-interpretation';
import type { DiscoveryPlan } from '@/lib/discovery';

import { evidenceGroupOf, type EvidenceGroup } from './evidence-group-map';
export { evidenceGroupOf, evidenceCapability, evidenceMarket, openEvidenceSummary, evidenceGroupsEnabled, type EvidenceGroup } from './evidence-group-map';

/** Columns `labelOpenRow` reads for an Open row. */
export const EVIDENCE_COLS = 'notice_id,title,description,naics_code,psc_code,department,sub_tier,solicitation_number,response_deadline';

export interface EvidenceGroupCounts { direct: number; related: number; other: number }

export function groupOpenRows(
  rows: Array<Record<string, unknown>>,
  plan: DiscoveryPlan,
  cap: MarketInterpretation['capability'],
  anchor?: CompanyAnchor | null,
): { counts: EvidenceGroupCounts; groups: EvidenceGroup[] } {
  const counts: EvidenceGroupCounts = { direct: 0, related: 0, other: 0 };
  const groups = rows.map((r) => {
    const g = evidenceGroupOf(labelOpenRow(r, plan, cap, anchor).cls);
    counts[g] += 1;
    return g;
  });
  return { counts, groups };
}

/**
 * Above this many matches the full breakdown is NOT computed (measured: 1.2–2.8 s and up to 8.8 MB for 151–1,224
 * matches; a whole-market ~9,200-row result would be ~60 MB). The answer is then "unavailable", never a window sample
 * presented as a total and never 0.
 */
export const EVIDENCE_TOTALS_MAX = 3000;

export type EvidenceSetTotals =
  | ({ complete: true; total: number } & EvidenceGroupCounts)
  | { complete: false; total: number | null; direct: null; related: null; other: null; reason: string };

type QueryLike = {
  order: (col: string, opts?: { ascending?: boolean }) => QueryLike;
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

/**
 * Group counts over the FULL matched set of one plan.
 *   count(): the exact matched total for the plan (head count, same adapter)
 *   page(): a fresh query selecting EVIDENCE_COLS through the same adapter (callers pass applyMapsOpenFilters /
 *           applyOpenPlan so retrieval is never re-expressed here)
 * Invariant enforced: direct + related + other must equal the total; any mismatch (e.g. rows changed between the count
 * and the read) returns complete:false rather than a sum that disagrees with the total.
 */
export async function openEvidenceTotals(args: {
  count: () => PromiseLike<{ count: number | null; error: { message: string } | null }>;
  page: () => QueryLike;
  plan: DiscoveryPlan;
  cap: MarketInterpretation['capability'];
  anchor?: CompanyAnchor | null;
  max?: number;
}): Promise<EvidenceSetTotals> {
  const max = args.max ?? EVIDENCE_TOTALS_MAX;
  const head = await args.count();
  if (head.error || head.count == null) {
    return { complete: false, total: null, direct: null, related: null, other: null, reason: `total unknown: ${head.error?.message ?? 'count unavailable'}` };
  }
  const total = head.count;
  if (total > max) {
    return { complete: false, total, direct: null, related: null, other: null, reason: `breakdown not computed above ${max} matches` };
  }
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; from < total + 1000; from += 1000) {
    const { data, error } = await args.page().order('notice_id').range(from, from + 999);
    if (error) return { complete: false, total, direct: null, related: null, other: null, reason: `read failed: ${error.message}` };
    rows.push(...((data || []) as Array<Record<string, unknown>>));
    if (!data || data.length < 1000) break;
  }
  const { counts } = groupOpenRows(rows, args.plan, args.cap, args.anchor);
  const sum = counts.direct + counts.related + counts.other;
  if (sum !== total) {
    return { complete: false, total, direct: null, related: null, other: null, reason: `groups (${sum}) do not reconcile with the total (${total})` };
  }
  return { complete: true, total, ...counts };
}

/**
 * DHS allRecords reconciliation — identity, diffing, accounting.
 *
 * Match key: raw APFS Number as `external_id` for `source_agency=DHS`
 * (see dhs-identity.ts). Absence upstream is REPORTED only — never deleted.
 * Measured 2026-11-18: ~1,273 DB-only rows vs the public file; orphan purge is
 * a product HOLD (research_notes/Forecast refresh readiness/dhs_replacement.md).
 */
export const DHS_ALLRECORDS_SOURCE_OWNED_FIELDS = [
  'title', 'description', 'naics_code', 'naics_description',
  'bureau', 'contracting_office', 'program_office',
  'estimated_value_min', 'estimated_value_max', 'estimated_value_range',
  'contract_type', 'set_aside_type',
  'poc_name', 'poc_email', 'poc_phone',
  'incumbent_name', 'incumbent_contract_number',
  'pop_state', 'pop_city', 'performance_end_date',
  'anticipated_quarter', 'anticipated_award_date', 'solicitation_date',
  'status', 'source_url',
] as const;

export type DhsAllrecordsSourceField = typeof DHS_ALLRECORDS_SOURCE_OWNED_FIELDS[number];
export type DhsAllrecordsRow =
  Partial<Record<DhsAllrecordsSourceField, unknown>> & { external_id: string };

export interface DhsAllrecordsReconcilePlan {
  upstreamTotal: number;
  usableUpstream: number;
  matchedExisting: number;
  toInsert: DhsAllrecordsRow[];
  toUpdate: Array<{
    externalId: string;
    patch: Partial<Record<DhsAllrecordsSourceField, unknown>>;
    changedFields: string[];
  }>;
  unchanged: number;
  /** Held DHS ids not in today's file — report only, NEVER delete. */
  absentUpstream: string[];
  duplicateSourceIds: string[];
  parseRejected: number;
}

function cmp(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Build the plan. PURE — accounting is asserted before anything mutates. */
export function planDhsAllrecordsReconciliation(
  upstream: Array<DhsAllrecordsRow | null>,
  held: Map<string, Partial<Record<DhsAllrecordsSourceField, unknown>>>,
): DhsAllrecordsReconcilePlan {
  const seen = new Set<string>();
  const duplicateSourceIds: string[] = [];
  let parseRejected = 0;
  const toInsert: DhsAllrecordsRow[] = [];
  const toUpdate: DhsAllrecordsReconcilePlan['toUpdate'] = [];
  let unchanged = 0;
  let matchedExisting = 0;
  const matchedIds = new Set<string>();

  for (const row of upstream) {
    if (!row || !row.external_id || !String(row.external_id).trim()) {
      parseRejected++;
      continue;
    }
    const id = String(row.external_id).trim();
    if (seen.has(id)) {
      duplicateSourceIds.push(id);
      continue;
    }
    seen.add(id);

    const existing = held.get(id);
    if (!existing) {
      toInsert.push(row);
      continue;
    }

    matchedExisting++;
    matchedIds.add(id);

    const patch: Partial<Record<DhsAllrecordsSourceField, unknown>> = {};
    const changedFields: string[] = [];
    for (const f of DHS_ALLRECORDS_SOURCE_OWNED_FIELDS) {
      if (!(f in row)) continue;
      if (cmp(row[f]) !== cmp(existing[f])) {
        patch[f] = row[f];
        changedFields.push(f);
      }
    }
    if (changedFields.length) toUpdate.push({ externalId: id, patch, changedFields });
    else unchanged++;
  }

  const absentUpstream = [...held.keys()].filter((id) => !matchedIds.has(id));
  return {
    upstreamTotal: upstream.length,
    usableUpstream: seen.size,
    matchedExisting,
    toInsert,
    toUpdate,
    unchanged,
    absentUpstream,
    duplicateSourceIds,
    parseRejected,
  };
}

export interface DhsAllrecordsReconcileCheck { ok: boolean; problems: string[] }

/**
 * Accounting gate — three identities must hold or nothing executes:
 *   usable + duplicates + rejected == upstreamTotal
 *   inserts + matched              == usable
 *   changed + unchanged            == matched
 */
export function dhsAllrecordsPlanReconciles(p: DhsAllrecordsReconcilePlan): DhsAllrecordsReconcileCheck {
  const problems: string[] = [];
  const accounted = p.usableUpstream + p.duplicateSourceIds.length + p.parseRejected;
  if (accounted !== p.upstreamTotal) {
    problems.push(
      `upstream accounting: ${p.usableUpstream} usable + ${p.duplicateSourceIds.length} dup + ${p.parseRejected} rejected = ${accounted} != ${p.upstreamTotal}`,
    );
  }
  if (p.toInsert.length + p.matchedExisting !== p.usableUpstream) {
    problems.push(
      `membership: ${p.toInsert.length} new + ${p.matchedExisting} matched != ${p.usableUpstream} usable`,
    );
  }
  if (p.toUpdate.length + p.unchanged !== p.matchedExisting) {
    problems.push(
      `matched split: ${p.toUpdate.length} changed + ${p.unchanged} unchanged != ${p.matchedExisting} matched`,
    );
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Semantic tripwires — arithmetic balance is not identity proof (Navy lesson).
 * First ingest against an empty corpus is allowed.
 */
export function dhsAllrecordsPlanIsSemanticallySane(
  p: DhsAllrecordsReconcilePlan,
  heldTotal: number,
): DhsAllrecordsReconcileCheck {
  const problems: string[] = [];
  if (heldTotal > 0 && p.matchedExisting === 0) {
    problems.push('matchedExisting = 0 against a non-empty corpus — identity contract failed');
  }
  if (p.usableUpstream > 0 && p.toInsert.length === p.usableUpstream && heldTotal > 0) {
    problems.push('every upstream row is NEW — identity contract failed');
  }
  if (heldTotal > 0 && p.absentUpstream.length === heldTotal) {
    problems.push('every held row is absent upstream — identity contract failed');
  }
  return { ok: problems.length === 0, problems };
}

export function dhsAllrecordsDataAdvanced(inserted: number, updated: number): boolean {
  return inserted > 0 || updated > 0;
}

/**
 * NAVY LRAE RECONCILIATION — Phase II, Potato 2D-B Stage 2.
 *
 * ⚠️ NOT AN APPEND-ONLY IMPORT. Navy updates the SAME revision in place (proven:
 * `02.2026` carries `etag ...,4` and `last-modified Thu, 02 Jul 2026` — months after
 * its filename period), so a row whose `external_id` is unchanged may still have
 * different source values. Every run must therefore diff, not just insert.
 *
 * ⚠️ ABSENCE IS EVIDENCE, NOT DELETION AUTHORITY. We have not proven what a row's
 * disappearance from an LRAE revision means — cancelled, completed, deferred, moved,
 * superseded, or an upstream mistake. So `absentUpstream` rows are COUNTED and
 * RETAINED, never deleted. Conservative retention beats destructive reconciliation
 * on a first activation.
 *
 * ⚠️ THE ACCOUNTING MUST RECONCILE BEFORE ANY MUTATION. `planReconciliation` is pure
 * and returns a plan whose arithmetic is checked by `planReconciles()`. A plan that
 * does not balance must never be executed — that is how a partial import gets
 * reported as a complete one.
 */

/**
 * Fields Navy OWNS on a forecast row. Everything absent from this list is either
 * Mindy-derived enrichment (map_lat/map_lng/map_loc_source — 5,033 Navy rows carry
 * geocoding we computed) or downstream metadata, and must NEVER be overwritten by a
 * source refresh.
 */
export const NAVY_SOURCE_OWNED_FIELDS = [
  'title', 'description', 'naics_code', 'fiscal_year', 'anticipated_quarter',
  'estimated_value_min', 'estimated_value_max', 'estimated_value_range',
  'contract_type', 'set_aside_type', 'competition_type',
  'contracting_office', 'program_office', 'pop_state', 'pop_city',
  'source_url',
] as const;

export type NavySourceField = typeof NAVY_SOURCE_OWNED_FIELDS[number];
export type NavyRow = Partial<Record<NavySourceField, unknown>> & { external_id: string };

export interface ReconcilePlan {
  upstreamTotal: number;
  /** Upstream rows that survived normalization and carry a usable identity. */
  usableUpstream: number;
  matchedExisting: number;
  toInsert: NavyRow[];
  toUpdate: Array<{ externalId: string; patch: Partial<Record<NavySourceField, unknown>>; changedFields: string[] }>;
  unchanged: number;
  absentUpstream: string[];
  duplicateSourceIds: string[];
  parseRejected: number;
}

/** Normalize for comparison so formatting noise is not counted as a change. */
function cmp(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

/**
 * Build the plan. PURE — no I/O, so the accounting can be asserted before mutating.
 *
 * @param upstream rows parsed from the workbook (may contain duplicates/rejects)
 * @param held     existing Navy rows keyed by external_id
 */
export function planReconciliation(
  upstream: Array<NavyRow | null>,
  held: Map<string, Partial<Record<NavySourceField, unknown>>>,
): ReconcilePlan {
  const seen = new Set<string>();
  const duplicateSourceIds: string[] = [];
  let parseRejected = 0;

  const toInsert: NavyRow[] = [];
  const toUpdate: ReconcilePlan['toUpdate'] = [];
  let unchanged = 0;
  let matchedExisting = 0;
  const matchedIds = new Set<string>();

  for (const row of upstream) {
    // A row we cannot identify cannot be reconciled — count it, never guess an id.
    if (!row || !row.external_id || !String(row.external_id).trim()) { parseRejected++; continue; }
    const id = String(row.external_id).trim();

    // A duplicate identity INSIDE the workbook: first occurrence wins, rest counted.
    if (seen.has(id)) { duplicateSourceIds.push(id); continue; }
    seen.add(id);

    const existing = held.get(id);
    if (!existing) { toInsert.push(row); continue; }

    matchedExisting++;
    matchedIds.add(id);

    const patch: Partial<Record<NavySourceField, unknown>> = {};
    const changedFields: string[] = [];
    for (const f of NAVY_SOURCE_OWNED_FIELDS) {
      if (!(f in row)) continue;                 // source did not supply it
      if (cmp(row[f]) !== cmp(existing[f])) { patch[f] = row[f]; changedFields.push(f); }
    }
    if (changedFields.length) toUpdate.push({ externalId: id, patch, changedFields });
    else unchanged++;
  }

  // Held rows this workbook does not mention. RETAINED — see the header note.
  const absentUpstream = [...held.keys()].filter((id) => !matchedIds.has(id));

  return {
    upstreamTotal: upstream.length,
    usableUpstream: seen.size,
    matchedExisting,
    toInsert, toUpdate, unchanged,
    absentUpstream, duplicateSourceIds, parseRejected,
  };
}

export interface ReconcileCheck { ok: boolean; problems: string[] }

/**
 * The accounting gate. Two independent identities must hold, or the plan is not
 * executed:
 *   usable + duplicates + rejected      == upstreamTotal
 *   inserts + matched                   == usable
 *   changed + unchanged                 == matched
 */
export function planReconciles(p: ReconcilePlan): ReconcileCheck {
  const problems: string[] = [];
  const accountedUpstream = p.usableUpstream + p.duplicateSourceIds.length + p.parseRejected;
  if (accountedUpstream !== p.upstreamTotal) {
    problems.push(`upstream accounting: ${p.usableUpstream} usable + ${p.duplicateSourceIds.length} dup + ${p.parseRejected} rejected = ${accountedUpstream} != ${p.upstreamTotal}`);
  }
  if (p.toInsert.length + p.matchedExisting !== p.usableUpstream) {
    problems.push(`membership: ${p.toInsert.length} new + ${p.matchedExisting} matched != ${p.usableUpstream} usable`);
  }
  if (p.toUpdate.length + p.unchanged !== p.matchedExisting) {
    problems.push(`matched split: ${p.toUpdate.length} changed + ${p.unchanged} unchanged != ${p.matchedExisting} matched`);
  }
  return { ok: problems.length === 0, problems };
}

/** TRUE only when the run actually altered stored data — gates lastDataAdvance. */
export function dataAdvanced(inserted: number, updated: number): boolean {
  return inserted > 0 || updated > 0;
}

/**
 * HHS SBCX reconciliation — identity, diffing, and the canonical source fingerprint.
 *
 * WHY HHS IS SAFE TO AUTOMATE AND NAVY IS NOT
 * Navy's legacy import lost its identity rule: the planner reproduced 0 of 8,821
 * held rows, so any write would have duplicated the corpus. HHS is the opposite —
 * the source publishes a real `uuid` (5,376 records, 5,376 distinct, 100%
 * populated, byte-stable across pulls) and the held corpus already stores it as
 * `external_id = 'HHS-' + UPPERCASE(uuid)` from this very endpoint. Measured:
 * 3,479 of 3,643 held rows (95.50%) match on that exact key, with ZERO fuzzy
 * matching. Identity was recorded, not lost.
 *
 * ⚠️ 95% IS NOT AUTHORITY BY ITSELF. The 164 unmatched rows were investigated,
 * not waved through: all originate from the same 2026-08-01 import as the matched
 * rows, and HHS simply withdrew them from the published forecast. They are
 * RETAINED — HHS publishes no deletion/withdrawal semantics, so absence from
 * today's payload is not proof a record died.
 */
import { createHash } from 'node:crypto';

/**
 * Fields HHS owns. The SAME list is used for diffing AND for the update payload —
 * two lists would let a field be compared but never written (or worse, written but
 * never compared).
 *
 * ⚠️ DELIBERATELY EXCLUDED — Mindy-owned enrichment that HHS never supplies:
 *   map_lat, map_lng, map_loc_source   geocoding derived by Mindy
 *   created_at, last_synced_at         Mindy's own clocks
 *   pop_state, pop_city                NOT in the HHS payload (unlike Navy)
 * Writing any of these from a source that does not carry them would erase real
 * work with nulls.
 */
export const HHS_SOURCE_OWNED_FIELDS = [
  'title', 'description', 'naics_code',
  'estimated_value_min', 'estimated_value_max', 'estimated_value_range',
  'contract_type', 'program_office', 'contracting_office',
  'poc_name', 'poc_email', 'incumbent_name', 'incumbent_contract_number',
  'status', 'bureau', 'source_url',
] as const;

/**
 * MINDY-DERIVED, NOT SOURCE-OWNED. HHS publishes month/year INPUTS
 * (`targetAwardMonth` / `targetAwardYear`); the quarter and fiscal-year labels are
 * Mindy's interpretation of them. They are populated on NEW rows for corpus
 * consistency but are NEVER diffed and NEVER overwritten by source reconciliation —
 * a derived field must not be rewritten by the thing it was derived from.
 *
 * The legacy convention was recovered empirically, not from memory: the writer
 * that produced the 3,643 held rows no longer exists in the repo (it stamped
 * `source_type: 'sbcx_api'`, which nothing in the codebase writes). Testing every
 * candidate derivation against the live corpus reproduced
 * hhsQuarter(targetAwardMonth) at 3,479/3,479 (100.00%) and hhsFy(targetAwardYear)
 * at 3,478/3,479 (99.97%) — the single miss is a source typo, srcYear 2042, which
 * hhsFy's 2020-2040 guard correctly rejects.
 *
 * ⚠️ An earlier draft of this ingest used targetSOLICITATIONMonth/Year and so read
 * 2,915 of 3,479 rows as CHANGED, which looked like a corpus-wide convention
 * conflict. It was a field-selection bug. Writing it would have flipped the
 * convention on ~1,700 rows and erased a held value with NULL on 1,175 more.
 */
export const HHS_DERIVED_FIELDS = ['anticipated_quarter', 'fiscal_year'] as const;

export type HhsSourceField = typeof HHS_SOURCE_OWNED_FIELDS[number];
export type HhsRow = Partial<Record<HhsSourceField, unknown>> & { external_id: string };

export interface HhsReconcilePlan {
  upstreamTotal: number;
  usableUpstream: number;
  matchedExisting: number;
  toInsert: HhsRow[];
  toUpdate: Array<{ externalId: string; patch: Partial<Record<HhsSourceField, unknown>>; changedFields: string[] }>;
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

/** Build the plan. PURE — the accounting is asserted before anything mutates. */
export function planHhsReconciliation(
  upstream: Array<HhsRow | null>,
  held: Map<string, Partial<Record<HhsSourceField, unknown>>>,
): HhsReconcilePlan {
  const seen = new Set<string>();
  const duplicateSourceIds: string[] = [];
  let parseRejected = 0;
  const toInsert: HhsRow[] = [];
  const toUpdate: HhsReconcilePlan['toUpdate'] = [];
  let unchanged = 0;
  let matchedExisting = 0;
  const matchedIds = new Set<string>();

  for (const row of upstream) {
    // No identity = cannot reconcile. Counted, never guessed.
    if (!row || !row.external_id || !String(row.external_id).trim()) { parseRejected++; continue; }
    const id = String(row.external_id).trim();
    // A duplicate uuid inside one payload is an identity failure, not a merge hint.
    if (seen.has(id)) { duplicateSourceIds.push(id); continue; }
    seen.add(id);

    const existing = held.get(id);
    if (!existing) { toInsert.push(row); continue; }

    matchedExisting++;
    matchedIds.add(id);

    const patch: Partial<Record<HhsSourceField, unknown>> = {};
    const changedFields: string[] = [];
    for (const f of HHS_SOURCE_OWNED_FIELDS) {
      if (!(f in row)) continue;                   // source did not supply it
      if (cmp(row[f]) !== cmp(existing[f])) { patch[f] = row[f]; changedFields.push(f); }
    }
    if (changedFields.length) toUpdate.push({ externalId: id, patch, changedFields });
    else unchanged++;                              // MATCHED BUT IDENTICAL -> NO WRITE
  }

  const absentUpstream = [...held.keys()].filter((id) => !matchedIds.has(id));
  return {
    upstreamTotal: upstream.length,
    usableUpstream: seen.size,
    matchedExisting, toInsert, toUpdate, unchanged,
    absentUpstream, duplicateSourceIds, parseRejected,
  };
}

export interface HhsReconcileCheck { ok: boolean; problems: string[] }

/**
 * The accounting gate — three identities must hold or nothing executes:
 *   usable + duplicates + rejected == upstreamTotal
 *   inserts + matched              == usable
 *   changed + unchanged            == matched
 */
export function hhsPlanReconciles(p: HhsReconcilePlan): HhsReconcileCheck {
  const problems: string[] = [];
  const accounted = p.usableUpstream + p.duplicateSourceIds.length + p.parseRejected;
  if (accounted !== p.upstreamTotal) {
    problems.push(`upstream accounting: ${p.usableUpstream} usable + ${p.duplicateSourceIds.length} dup + ${p.parseRejected} rejected = ${accounted} != ${p.upstreamTotal}`);
  }
  if (p.toInsert.length + p.matchedExisting !== p.usableUpstream) {
    problems.push(`membership: ${p.toInsert.length} new + ${p.matchedExisting} matched != ${p.usableUpstream} usable`);
  }
  if (p.toUpdate.length + p.unchanged !== p.matchedExisting) {
    problems.push(`matched split: ${p.toUpdate.length} changed + ${p.unchanged} unchanged != ${p.matchedExisting} matched`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * ⚠️ ARITHMETIC BALANCE IS NOT IDENTITY PROOF. Navy's plan balanced perfectly
 * while matching zero rows — inserting 7,055 and orphaning 8,821 would have
 * duplicated the corpus. These are the semantic tripwires that would have caught it.
 */
export function hhsPlanIsSemanticallySane(p: HhsReconcilePlan, heldTotal: number): HhsReconcileCheck {
  const problems: string[] = [];
  if (heldTotal > 0 && p.matchedExisting === 0) problems.push('matchedExisting = 0 against a non-empty corpus — identity contract failed');
  if (p.usableUpstream > 0 && p.toInsert.length === p.usableUpstream && heldTotal > 0) problems.push('every upstream row is NEW — identity contract failed');
  if (heldTotal > 0 && p.absentUpstream.length === heldTotal) problems.push('every held row is absent upstream — identity contract failed');
  return { ok: problems.length === 0, problems };
}

/**
 * CANONICAL SOURCE FINGERPRINT — HHS's equivalent of Navy's header fingerprint.
 *
 * HHS exposes NO watermark: no ETag, no Last-Modified, no updated_at, no version,
 * and `cache-control: no-store`. So source state can only be identified from the
 * CONTENT. Raw transport bytes are not safe to hash — JSON key/record ordering can
 * vary without semantic change — so the payload is canonicalized first:
 *   • records sorted by uuid
 *   • object keys sorted
 *   • no Mindy-generated fields, no poll timestamp
 * Same canonical content -> same fingerprint. Any add/remove/edit -> different.
 *
 * Returns NULL when the payload is unusable. NULL means UNMEASURED, never
 * "unchanged" — a hash of nothing would manufacture false stability.
 *
 * ⚠️ TRUNCATED DIGEST: the first 32 of 64 hex chars (128 bits), matching the
 * ops-alert-dedup convention. Do not describe it as a complete SHA-256.
 */
export function canonicalHhsFingerprint(payload: unknown): string | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const canon = (payload as Array<Record<string, unknown>>)
    .map((r) => JSON.stringify(r, Object.keys(r).sort()))
    .sort();
  return createHash('sha256').update(canon.join('\n')).digest('hex').slice(0, 32);
}

/** TRUE only when the run actually altered stored data — gates lastDataAdvance. */
export function hhsDataAdvanced(inserted: number, updated: number): boolean {
  return inserted > 0 || updated > 0;
}

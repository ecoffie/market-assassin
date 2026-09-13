/**
 * DOJ forecast — identity, field ownership, diffing, and the source fingerprint.
 *
 * THE SOURCE. A single XLSX published at justice.gov, sheet "Sheet2", 34 columns.
 * The recorded URL 301-redirects (`/media/…` -> `/jmd/media/…`) and still resolves
 * to a real workbook. The prior classification "REPAIR_REQUIRED — file moved,
 * relocate the published file" was WRONG: nothing needs relocating, the redirect
 * already handles it.
 *
 * ⚠️ NEVER READ METADATA FROM THE REDIRECT. The 301 response carries its own
 * Last-Modified (the redirect resource's, Sep 11) which is NOT the workbook's
 * (Aug 27). Reading the first response would attribute the redirect page's age to
 * the forecast file and silently mis-date the source clock.
 *
 * IDENTITY — DOJ's Action Tracking Number, UNIQUE-ONLY.
 * DOJ publishes an ATN per row (`FY26-BOP-1540-343`) and the held corpus already
 * stores it as external_id. But it is NOT globally unique: measured on the
 * 2026-08-27 workbook, 7 ATNs carry genuinely DIFFERENT rows (18 rows total).
 *
 * For those, DOJ has provided no discriminator, so the ENTIRE ambiguous group is
 * rejected — not "first wins" (which would silently discard real procurements)
 * and not a synthetic composite key (which would make Mindy the author of an
 * identity DOJ never issued). A source can be usable while some of its records
 * are ambiguous; we do not need to invent identity for 18 rows in order to
 * safely automate the 449 DOJ identifies uniquely.
 */
import { createHash } from 'node:crypto';
import { canonicalTitle } from './doj-parse';

/**
 * Fields DOJ owns. ONE list drives BOTH the CHANGED diff and the UPDATE payload.
 *
 * ⚠️ DELIBERATELY EXCLUDED — Mindy enrichment DOJ does not supply:
 *   map_lat, map_lng, map_loc_source   geocoding (348 of 500 held rows carry it)
 *   created_at, last_synced_at         Mindy's own clocks
 *   anticipated_quarter, fiscal_year   DERIVED from DOJ's date/FY inputs
 * Unlike HHS, DOJ DOES publish Place of Performance, so pop_state/pop_city are
 * genuinely source-owned here. Ownership is per-source, never assumed.
 */
export const DOJ_SOURCE_OWNED_FIELDS = [
  'title', 'description', 'naics_code', 'naics_description', 'psc_code',
  'bureau', 'contracting_office', 'program_office',
  'estimated_value_min', 'estimated_value_max', 'estimated_value_range',
  'contract_type', 'set_aside_type', 'competition_type',
  'poc_name', 'poc_email',
  'incumbent_name', 'incumbent_contract_number',
  'pop_state', 'pop_city', 'pop_country', 'status',
] as const;

/**
 * MINDY-DERIVED, NOT SOURCE-OWNED. DOJ publishes "Target Award Date" as
 * "Q4, 2026" and a Fiscal Year of "2026"; the stored `anticipated_quarter` /
 * `fiscal_year` are Mindy's normalized interpretation. Populated on NEW rows,
 * never diffed, never overwritten — measured against the held corpus, the
 * quarter derives from the AWARD date (326/333 = 97.9%), not the solicitation
 * date (83/333 = 24.9%).
 */
export const DOJ_DERIVED_FIELDS = ['anticipated_quarter', 'fiscal_year'] as const;

export type DojSourceField = typeof DOJ_SOURCE_OWNED_FIELDS[number];
export type DojRow = Partial<Record<DojSourceField, unknown>> & { external_id: string };

export interface DojIdentityAudit {
  rawUpstream: number;
  distinctAtns: number;
  duplicateAtnGroups: string[];
  identityRejectedRows: number;
  usableUniqueIdentity: number;
  blankAtnRows: number;
}

/**
 * Split the payload into the safely identifiable population and the rejected one.
 * A blank ATN is rejected outright — the June importer's fallback to a status
 * value ('Active') or a title is exactly how two unusable identities entered the
 * corpus.
 */
export function auditDojIdentity(atns: string[]): DojIdentityAudit {
  const counts = new Map<string, number>();
  let blank = 0;
  for (const raw of atns) {
    const a = String(raw ?? '').trim();
    if (!a) { blank++; continue; }
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const duplicateAtnGroups = [...counts.entries()].filter(([, n]) => n > 1).map(([a]) => a);
  const identityRejectedRows = duplicateAtnGroups.reduce((n, a) => n + (counts.get(a) ?? 0), 0);
  const usable = [...counts.entries()].filter(([, n]) => n === 1).length;
  return {
    rawUpstream: atns.length,
    distinctAtns: counts.size,
    duplicateAtnGroups,
    identityRejectedRows,
    usableUniqueIdentity: usable,
    blankAtnRows: blank,
  };
}

export interface DojReconcilePlan {
  rawUpstream: number;
  usableUniqueIdentity: number;
  identityRejectedRows: number;
  duplicateAtnGroups: number;
  blankAtnRows: number;
  matchedExisting: number;
  toInsert: DojRow[];
  toUpdate: Array<{ externalId: string; patch: Partial<Record<DojSourceField, unknown>>; changedFields: string[] }>;
  unchanged: number;
  absentUpstream: string[];
  heldAmbiguous: string[];
  corruptLegacyIdentity: string[];
  /** ATN matched, but the titles are NOT equivalent -> two different procurements. */
  crossEditionSuspect: Array<{ atn: string; heldTitle: string; upstreamTitle: string }>;
  /** Held values preserved because the source stopped supplying them. */
  nullProtected: Record<string, number>;
  nullProtectedRows: number;
}

/** Normalize for comparison so formatting noise is not counted as a change. */
function cmp(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

/** A well-formed DOJ ATN. `OBDs` carries a lowercase 's', so the class is [A-Za-z]. */
export const DOJ_ATN_SHAPE = /^FY\d{2}-[A-Za-z]+-\d+-\d+$/;

/**
 * Build the plan. PURE — the accounting is asserted before anything mutates.
 *
 * @param upstream    rows carrying a UNIQUE ATN only (ambiguous groups already removed)
 * @param rejectedAtns the ambiguous ATNs, so held rows under them are quarantined
 * @param held         existing DOJ rows keyed by external_id
 */
export function planDojReconciliation(
  upstream: DojRow[],
  rejectedAtns: Set<string>,
  held: Map<string, Partial<Record<DojSourceField, unknown>>>,
  audit: DojIdentityAudit,
): DojReconcilePlan {
  const upById = new Map(upstream.map((r) => [r.external_id, r]));
  const toInsert: DojRow[] = [];
  const toUpdate: DojReconcilePlan['toUpdate'] = [];
  let unchanged = 0;
  let matchedExisting = 0;

  const crossEditionSuspect: DojReconcilePlan['crossEditionSuspect'] = [];
  const nullProtected: Record<string, number> = {};
  let nullProtectedRows = 0;

  for (const [id, row] of upById) {
    const existing = held.get(id);
    if (!existing) { toInsert.push(row); continue; }

    // ⚠️ CROSS-EDITION ATN REUSE. Uniqueness WITHIN today's workbook does not make
    // an ATN stable ACROSS editions — DOJ recycles numbers. Measured: three matched
    // ATNs now carry a different procurement entirely (Parking Services ->
    // Real Property Management Services). Updating in place would overwrite one
    // procurement's record with another's. An empty source title is NOT a suspect:
    // that is the null-over-value case, handled below.
    const upTitle = canonicalTitle(row.title);
    const heldTitle = canonicalTitle(existing.title);
    if (upTitle && heldTitle && upTitle !== heldTitle) {
      crossEditionSuspect.push({ atn: id, heldTitle: String(existing.title ?? ''), upstreamTitle: String(row.title ?? '') });
      continue;                                        // retain held, no write, no insert
    }

    matchedExisting++;
    const patch: Partial<Record<DojSourceField, unknown>> = {};
    const changedFields: string[] = [];
    let rowProtected = false;
    for (const f of DOJ_SOURCE_OWNED_FIELDS) {
      if (!(f in row)) continue;                       // source did not supply it
      if (cmp(row[f]) === cmp(existing[f])) continue;  // identical
      // ⚠️ NULL-OVER-VALUE. A field the source stopped publishing is
      // SOURCE_NO_LONGER_SUPPLIES_VALUE, never DELETE_VALUE — DOJ gives us no
      // field-level deletion semantics. Excluded from the PAYLOAD itself, not
      // merely from the report.
      if (cmp(row[f]) === '' && cmp(existing[f]) !== '') {
        nullProtected[f] = (nullProtected[f] ?? 0) + 1;
        rowProtected = true;
        continue;
      }
      patch[f] = row[f]; changedFields.push(f);
    }
    if (rowProtected) nullProtectedRows++;
    if (changedFields.length) toUpdate.push({ externalId: id, patch, changedFields });
    else unchanged++;
  }

  // Partition every held row so none is silently unaccounted for.
  const corruptLegacyIdentity: string[] = [];
  const heldAmbiguous: string[] = [];
  const absentUpstream: string[] = [];
  const suspectIds = new Set(crossEditionSuspect.map((c) => c.atn));
  for (const id of held.keys()) {
    if (!DOJ_ATN_SHAPE.test(id)) { corruptLegacyIdentity.push(id); continue; }
    if (rejectedAtns.has(id)) { heldAmbiguous.push(id); continue; }
    if (suspectIds.has(id)) continue;                  // counted as a suspect, not absent
    if (!upById.has(id)) absentUpstream.push(id);
  }

  return {
    rawUpstream: audit.rawUpstream,
    usableUniqueIdentity: audit.usableUniqueIdentity,
    identityRejectedRows: audit.identityRejectedRows,
    duplicateAtnGroups: audit.duplicateAtnGroups.length,
    blankAtnRows: audit.blankAtnRows,
    matchedExisting, toInsert, toUpdate, unchanged,
    absentUpstream, heldAmbiguous, corruptLegacyIdentity,
    crossEditionSuspect, nullProtected, nullProtectedRows,
  };
}

export interface DojCheck { ok: boolean; problems: string[] }

/**
 * The accounting gate — every identity must hold or nothing executes:
 *   usable + rejected + blank          == rawUpstream
 *   inserts + matched                  == usable
 *   changed + unchanged                == matched
 *   matched + absent + ambiguous + corrupt == heldTotal
 */
export function dojPlanReconciles(p: DojReconcilePlan, heldTotal: number): DojCheck {
  const problems: string[] = [];
  const accounted = p.usableUniqueIdentity + p.identityRejectedRows + p.blankAtnRows;
  if (accounted !== p.rawUpstream) problems.push(`upstream: ${p.usableUniqueIdentity} usable + ${p.identityRejectedRows} rejected + ${p.blankAtnRows} blank = ${accounted} != ${p.rawUpstream}`);
  if (p.toInsert.length + p.matchedExisting + p.crossEditionSuspect.length !== p.usableUniqueIdentity) problems.push(`membership: ${p.toInsert.length} new + ${p.matchedExisting} matched + ${p.crossEditionSuspect.length} suspect != ${p.usableUniqueIdentity} usable`);
  if (p.toUpdate.length + p.unchanged !== p.matchedExisting) problems.push(`matched split: ${p.toUpdate.length} changed + ${p.unchanged} unchanged != ${p.matchedExisting} matched`);
  const heldAccounted = p.matchedExisting + p.absentUpstream.length + p.heldAmbiguous.length + p.corruptLegacyIdentity.length + p.crossEditionSuspect.length;
  if (heldAccounted !== heldTotal) problems.push(`held: ${heldAccounted} != ${heldTotal}`);
  return { ok: problems.length === 0, problems };
}

/**
 * ⚠️ ARITHMETIC BALANCE IS NOT IDENTITY PROOF. Navy's plan balanced perfectly
 * while matching zero rows. These are the tripwires that catch that shape.
 */
export function dojPlanIsSemanticallySane(p: DojReconcilePlan, heldTotal: number): DojCheck {
  const problems: string[] = [];
  if (heldTotal > 0 && p.matchedExisting === 0) problems.push('matchedExisting = 0 against a non-empty corpus — identity contract failed');
  if (p.usableUniqueIdentity > 0 && p.toInsert.length === p.usableUniqueIdentity && heldTotal > 0) problems.push('every upstream row is NEW — identity contract failed');
  if (heldTotal > 0 && p.absentUpstream.length === heldTotal) problems.push('every held row is absent upstream — identity contract failed');
  return { ok: problems.length === 0, problems };
}

/**
 * SOURCE FINGERPRINT — hashed from the VALIDATED WORKBOOK BYTES.
 *
 * The workbook is a single binary artifact served byte-identically across pulls
 * (verified), so the bytes themselves are the canonical source state — no
 * re-canonicalization needed, unlike the HHS JSON payload whose key/record order
 * could vary without semantic change.
 *
 * Hash the FILE, never the redirect page, never the poll time. Returns NULL for
 * an empty or non-XLSX body: NULL is UNMEASURED, never "unchanged".
 *
 * ⚠️ TRUNCATED DIGEST — first 32 of 64 hex chars, the established convention.
 * Do not describe it as a complete SHA-256.
 */
export function dojWorkbookFingerprint(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return null;   // not a ZIP/XLSX
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}

/** TRUE only when the run actually altered stored data — gates lastDataAdvance. */
export function dojDataAdvanced(inserted: number, updated: number): boolean {
  return inserted > 0 || updated > 0;
}

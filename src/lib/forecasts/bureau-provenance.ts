/**
 * Bureau attribution resolution for canonical Gateway (FCO) rows.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────────────────
 * FCO has REMOVED organisational attribution from rows that still exist upstream. Measured
 * 2026-09-14 by tracing every held child row to its current upstream record by source-native id:
 *
 *   Fish & Wildlife  710 held · 710 still upstream · current Funding Organization BLANK on all 710
 *   Forest Service   639 held · 639 still upstream · BLANK
 *   PBS               28 held ·  28 still upstream · BLANK
 *   NPS               14 held ·  14 still upstream · BLANK
 *   FAS              182 held ·  90 still upstream · renamed to "Federal Acquisition Service"
 *
 * A refresh that wrote the current NULL over the held value would destroy source evidence that
 * cannot be re-acquired, because the source no longer publishes it.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────
 *   current non-null            -> use it              provenance 'current'
 *   current null + prior value  -> preserve the prior  provenance 'last_known'
 *   current non-null ≠ prior    -> CURRENT WINS        provenance 'current'  (+ record the change)
 *   neither                     -> unknown             provenance null
 *
 * A current NULL is NOT evidence the prior attribution became false. It means the source stopped
 * publishing the field for that row. Missing evidence is not a deletion event.
 *
 * ⚠️ Runtime reads the canonical row ONLY. The retired duplicate `api` rows are migration-time
 * evidence, never a query-time join.
 */

export type BureauProvenance = 'current' | 'last_known';

/** The department-name constants our parser wrote into `bureau` are NOT attribution. */
const DEPARTMENT_CONSTANTS = new Set([
  'Department of the Interior', 'Department of Agriculture', 'Department of Transportation',
  'Department of Veterans Affairs', 'General Services Administration', 'Department of Labor',
  'Department of State', 'National Science Foundation', 'Nuclear Regulatory Commission',
]);

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * A bureau value only counts as ATTRIBUTION if it names a sub-organisation. The header-drift bug
 * left every canonical row carrying its own department name in `bureau`; treating that as a bureau
 * would fabricate a child for the entire corpus.
 */
export function isRealBureauAttribution(value: unknown): boolean {
  const s = clean(value);
  return s.length > 0 && !DEPARTMENT_CONSTANTS.has(s);
}

export interface BureauResolutionInput {
  /** Bureau as published by the CURRENT upstream source (Funding Organization). */
  currentSourceBureau?: string | null;
  /** SOURCE observation time for the current value (FCO row `changed`). Never a Mindy timestamp. */
  currentSourceObservedAt?: string | null;
  /** An EXACT previously observed source-native bureau, from the historical snapshot. */
  priorSourceBureau?: string | null;
  /** SOURCE observation time of that prior value, if one is defensible. Usually null. */
  priorSourceObservedAt?: string | null;
}

export interface BureauResolution {
  bureau: string | null;
  bureauProvenance: BureauProvenance | null;
  bureauObservedAt: string | null;
  /** True when current and prior are both present and DIFFER — the caller records the transition. */
  changed: boolean;
  previousValue: string | null;
}

/**
 * Resolve the bureau a canonical row should carry.
 *
 * PURE. No I/O, no clock. It cannot synthesise a timestamp — if the caller has no defensible source
 * observation time, the result carries null rather than `now()`. A fabricated observation time is a
 * claim about the source that we cannot support.
 */
export function resolveBureau(input: BureauResolutionInput): BureauResolution {
  const current = isRealBureauAttribution(input.currentSourceBureau) ? clean(input.currentSourceBureau) : '';
  const prior = isRealBureauAttribution(input.priorSourceBureau) ? clean(input.priorSourceBureau) : '';

  if (current) {
    // CURRENT WINS — including when it differs from what we held. Do not keep an older spelling
    // alive merely because it once existed (FAS-Federal Acquisition Service -> Federal Acquisition Service).
    return {
      bureau: current,
      bureauProvenance: 'current',
      bureauObservedAt: input.currentSourceObservedAt ?? null,
      changed: Boolean(prior) && prior !== current,
      previousValue: prior || null,
    };
  }

  if (prior) {
    // Source went quiet on this field. Preserve the exact prior source-native value.
    // `priorSourceObservedAt` is almost always null in practice: the duplicate api rows carry no
    // raw_data and only a Mindy write stamp, which is NOT a source observation.
    return {
      bureau: prior,
      bureauProvenance: 'last_known',
      bureauObservedAt: input.priorSourceObservedAt ?? null,
      changed: false,
      previousValue: null,
    };
  }

  // Never observed. Stays unknown — no inference from title, description, location or office prose.
  return { bureau: null, bureauProvenance: null, bureauObservedAt: null, changed: false, previousValue: null };
}

/** One carry-forward/transition record for the EXISTING `intelligence_changes` ledger. */
export interface BureauChangeRecord {
  domain: 'forecast_attribution';
  canonical_agency: string;
  entity_key: string;
  change_type: 'bureau_carried_forward' | 'bureau_source_changed';
  old_value: string | null;
  new_value: string | null;
}

/**
 * Build the change-ledger row for a resolution, or null when there is nothing to record.
 *
 * Uses the repo's existing `intelligence_changes` mechanism rather than a new provenance framework.
 * `entity_key` is the source-native listing id so the evidence is joinable back to the source.
 */
export function bureauChangeRecord(
  sourceAgency: string,
  sourceListingId: string,
  r: BureauResolution,
): BureauChangeRecord | null {
  if (r.bureauProvenance === 'last_known') {
    return {
      domain: 'forecast_attribution',
      canonical_agency: sourceAgency,
      entity_key: sourceListingId,
      change_type: 'bureau_carried_forward',
      // The source now publishes nothing; we carry the prior value forward.
      old_value: r.bureau,
      new_value: null,
    };
  }
  if (r.changed) {
    return {
      domain: 'forecast_attribution',
      canonical_agency: sourceAgency,
      entity_key: sourceListingId,
      change_type: 'bureau_source_changed',
      old_value: r.previousValue,
      new_value: r.bureau,
    };
  }
  return null;
}

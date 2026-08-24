/**
 * THE SAM V2 PUBLIC ENTITY EXTRACT LAYOUT — the lossless source boundary.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────
 * Measured 2026-08-24 on the live mirror: `sam_entities` holds 910,123 rows, the source record
 * carries **142 pipe-delimited fields**, and the importer materialized ~15 of them. The other
 * ~127 were DISCARDED at ingest with no recoverable source — `raw_data` is `{}` on every row
 * sampled, and the `sam_*` provenance columns were set on only 3.0% (27,485) by a one-off that
 * no live code path reproduces.
 *
 * Every field on the decision-critical list — purposeOfRegistrationCode, certification
 * entry/exit dates, naicsException, entity/JV structure, identity/hierarchy — was in the
 * discarded set. Adding "field #16" meant reverse-engineering the pipe layout from scratch,
 * every time.
 *
 * ── THE ARCHITECTURAL RULE (Eric, 2026-08-24) ──────────────────────────────────────────────
 *
 *     "The importer should be lossless at its source boundary WITHOUT the database being
 *      lossless."
 *
 * So: parse the COMPLETE record here into a named, typed shape; materialize only the fields
 * Mindy has product semantics for; keep the original evidence in the archived extract (GCS),
 * NOT as 910K JSON blobs in the transactional DB. That last part was measured at ~7.5 GB even
 * after slimming — the wrong storage tier for evidence we need at audit time, not query time.
 *
 * ⚠️ `raw_data` STAYS `{}` FOR NOW, deliberately. Filling it inconsistently during this pass
 * would introduce a storage decision by accident. If a compact record-level raw representation
 * is wanted later, that is a deliberate design after the archetype audit — not a side effect.
 *
 * ⚠️ INDICES ARE ZERO-BASED against `line.split('|')`. The layout doc numbers fields from 1,
 * so field N lives at index N-1. Mis-stating that is how a "field 118" comment ends up reading
 * index 118 instead of 117.
 */

/** Field indices verified against the layout PDF + live extract (2026-08-24). */
export const SAM_EXTRACT_FIELDS = {
  uei: 0,
  cage: 3,
  expirationDate: 8,
  legalBusinessName: 11,
  dbaName: 12,
  physicalCity: 16,
  physicalState: 17,
  physicalZip: 18,
  physicalCountry: 20,
  /** SBA self-identified business types (tilde-joined). */
  sbaBusinessTypes: 31,
  primaryNaics: 32,
  /** NAICS list, tilde-joined `code + Y/N` small-business flag. */
  naicsList: 34,
  /** SBA-CERTIFIED programs (8(a), HUBZone) — the only real set-asides. */
  sbaCertifiedPrograms: 117,
} as const;

/** How many fields a genuine data row carries. Header/footer markers carry fewer. */
export const SAM_EXTRACT_FIELD_COUNT = 142;

/**
 * A complete, NAMED view of one source record.
 *
 * `fields` keeps every raw column so a later field can be added by NAME here rather than by
 * re-deriving the layout at a call site. This object lives only for the lifetime of one line —
 * it is the parser's representation, not a storage format.
 */
export interface SamExtractRecord {
  /** Every raw field, positionally, exactly as the source provided it. */
  fields: readonly string[];
  /** Total fields on this line — a row shorter than expected is a layout change, not a bad row. */
  fieldCount: number;
  get(index: number): string;
}

export function parseSamExtractLine(line: string): SamExtractRecord | null {
  if (!line || !line.includes('|')) return null;          // BOF/EOF structural markers
  const fields = line.split('|');
  if (fields.length < 35) return null;                    // header/footer guard
  return {
    fields,
    fieldCount: fields.length,
    get: (i: number) => (fields[i] ?? '').trim(),
  };
}

/**
 * Fields the archetype audit will look at, by NAME, so the diff can be run against the source
 * extract WITHOUT materializing anything. Indices are filled in as each is confirmed against a
 * real record — an unconfirmed index stays `null` rather than being guessed, because a wrong
 * index silently reads a neighbouring column and looks like real data.
 */
export const AUDIT_CANDIDATE_FIELDS: Record<string, number | null> = {
  /**
   * ✅ CONFIRMED idx 6 by value-shape + a distribution cross-check at scale (120K lines):
   *   Z2 72.0% · Z1 28.0% · Z3 0.1% · Z5/Z4 ~0%
   * and the tell holds — Z1 has NO NAICS in 33,494 of 33,541 cases (99.86%), while Z2 has
   * NAICS in 100% of 86,355. Z1 = Federal Assistance (grants) ONLY: those registrants cannot
   * receive a federal CONTRACT.
   *
   * ⚠️ DECISION IMPACT — MEASURED, AND SMALLER THAN THE HEADLINE. My first read called this
   * "up to ~28% inflation of supplier counts". Eric flagged that as a registry-wide UPPER
   * BOUND rather than a per-market correction, and the per-NAICS distribution proves him right:
   *
   *   897 NAICS with >=100 registrants → ALL 897 fall in the 0-5% Z1 bucket (worst: 1.4%).
   *   ZERO markets are materially distorted.
   *
   * The reason is in the data: only **143 of 111,941 Z1 firms (0.13%)** declare any NAICS at
   * all. So the 28% lands almost entirely on REGISTRY-WIDE totals, not on per-market counts.
   *
   * And the one surface that could have been distorted already is not: market-depth filters
   * `.contains('naics_codes', [naics])`, which structurally excludes ~99.87% of Z1 firms. The
   * public "contractors" figure comes from BigQuery `recipients` (firms that actually WON
   * awards), not from this table.
   *
   * SO: materialize it for CORRECTNESS and for the invariant below — not because a live number
   * is currently wrong. It matters the moment any surface counts registrants WITHOUT a NAICS
   * filter, which is exactly the mistake it now makes impossible to miss.
   *
   * THE INVARIANT (Eric): "Eligibility for procurement must not be inferred merely from
   * presence in the SAM entity registry." A registration can exist for federal ASSISTANCE only.
   */
  purposeOfRegistrationCode: 6,

  /** ✅ Date-shaped (YYYYMMDD), confirmed present across all five archetypes. */
  registrationDate: 7,
  expirationDate: 8,          // already materialized as registration_expiry
  lastUpdateDate: 9,
  activationDate: 10,
  initialRegistrationDate: 24,

  /** ⚠️ NOT YET CONFIRMED — left null on purpose. A guessed index silently reads a
   *  neighbouring column and looks like real data, which is worse than a null. */
  certificationEntryDate: null,
  certificationExitDate: null,
  naicsException: null,       // no `\d{6}[A-Z]` shape found in the archetype sample
  entityStructureCode: null,
  entityStructureText: null,
  stateOfIncorporation: null,
  countryOfIncorporation: null,
  parentUei: null,
  parentLegalBusinessName: null,
};

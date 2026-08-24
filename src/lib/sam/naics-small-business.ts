/**
 * P0-3 — the SINGLE normalizer for SAM's per-NAICS small-business representation.
 *
 * Both ingestion pipelines call this so they cannot quietly diverge:
 *   Entity API  → naicsList[] of { naicsCode, sbaSmallBusiness: 'Y' | 'N' }
 *   Bulk extract→ field 34, tilde-joined "332312Y~423310Y~561720N"
 *
 * THE RULE THIS ENCODES:
 *   'Y'     → SAM says the entity represents itself as small for that NAICS
 *   'N'     → SAM says it does NOT
 *   absent  → SAM said nothing. NOT the same as 'N'.
 *
 * That third state is the whole point. Storing only the Y codes would collapse
 * "not small" into "unknown", which is the unknown-vs-none defect family behind
 * P0-2 and the reason P0-3 returned zero performers for a market with 21,933
 * registrants.
 *
 * SELF-CERTIFICATION: this is the entity's own representation in SAM, not an SBA
 * determination. Callers surfacing it must say so.
 */

export type SbStatus = 'Y' | 'N';
/** { "561720": "Y", "541512": "N" } — a missing key means SAM did not say. */
export type NaicsSbMap = Record<string, SbStatus>;

const NAICS_RE = /^\d{6}$/;

function put(map: NaicsSbMap, code: string, status: string | null | undefined): void {
  const c = (code || '').trim();
  if (!NAICS_RE.test(c)) return;
  const s = (status || '').trim().toUpperCase();
  if (s !== 'Y' && s !== 'N') return;   // unknown stays ABSENT, never defaulted to N
  map[c] = s;
}

/** Entity API shape: assertions.goodsAndServices.naicsList[]. */
export function fromEntityApiNaicsList(
  list: Array<{ naicsCode?: unknown; sbaSmallBusiness?: unknown }> | null | undefined,
): NaicsSbMap {
  const out: NaicsSbMap = {};
  for (const n of list || []) {
    put(out, String(n?.naicsCode ?? ''), n?.sbaSmallBusiness == null ? '' : String(n.sbaSmallBusiness));
  }
  return out;
}

/**
 * Bulk extract shape: field 34, tilde-joined `<6-digit code><Y|N>`.
 * A token with no trailing Y/N (e.g. "541512") yields NO entry — unknown, not N.
 */
export function fromBulkExtractField(field: string | null | undefined): NaicsSbMap {
  const out: NaicsSbMap = {};
  for (const raw of (field || '').split('~')) {
    const tok = raw.trim();
    if (!tok) continue;
    const code = tok.slice(0, 6);
    const flag = tok.slice(6, 7);        // '' when the token is a bare code
    put(out, code, flag);
  }
  return out;
}

/**
 * DERIVED projection for indexed containment queries. Never store this
 * independently of the map — derive it, or Y/N/unknown will drift apart.
 */
export function smallBusinessCodes(map: NaicsSbMap | null | undefined): string[] {
  return Object.entries(map || {}).filter(([, v]) => v === 'Y').map(([c]) => c).sort();
}

/** All codes SAM said anything about — the unknown-vs-none check. */
export function representedCodes(map: NaicsSbMap | null | undefined): string[] {
  return Object.keys(map || {}).sort();
}

/**
 * Tri-state read for a single NAICS. Returns null for UNKNOWN so callers are
 * forced to handle it rather than treating a missing key as "not small".
 */
export function isSmallForNaics(map: NaicsSbMap | null | undefined, naics: string): boolean | null {
  const v = (map || {})[(naics || '').trim()];
  return v === 'Y' ? true : v === 'N' ? false : null;
}

/** Columns for a sam_entities upsert. Keeps map + projection + provenance together. */
export function toEntityColumns(map: NaicsSbMap, source: string, observedAt: string) {
  return {
    naics_small_business: map,
    small_business_naics: smallBusinessCodes(map),
    naics_sb_source: source,
    naics_sb_observed_at: observedAt,
  };
}

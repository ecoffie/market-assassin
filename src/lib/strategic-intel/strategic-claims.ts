/**
 * THE strategic-claim read boundary.
 *
 * ONE typed contract every customer-facing surface consumes instead of importing
 * `@/data/agency-pain-points.json` and guessing what the strings mean.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `sourced-pain-points.ts` already models provenance correctly (SOURCE_FACT /
 * MINDY_INTERPRETATION / LEGACY_MANUAL) and, since #1577, strips unsourced dollar
 * amounts from legacy claims. None of that helps a module that never calls it.
 *
 * Measured on origin/main @297e3136:
 *   · 2,500 priorities — 0 with a source URL, 0 with a source tag, 8 with a bare
 *     document id. FULL provenance: 0.
 *   · 1,678 of those priorities still carry a dollar figure in the RAW file.
 *   · Customer-facing modules reading the raw file therefore emit sanitized-free
 *     prose. `/api/budget-intel` went further and parsed that prose into a
 *     STRUCTURED `fundingAmount`, turning uncited prose into a machine-readable
 *     number — with a unit bug that reads "$135 billion" as 135 dollars.
 *
 * This module does NOT invent provenance. A legacy claim stays LEGACY_MANUAL; it
 * simply becomes impossible to consume one without seeing that it is.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
 * It does not delete, rewrite or re-source the corpus, and it does not gate the
 * raw file from non-customer-facing callers (admin inventory, build scripts,
 * integrity reports legitimately count raw rows).
 */
import {
  getAgencySourcedIntelligence,
  loadLegacyPainPointsForAgency,
  sanitizeLegacyClaimText,
  type SourcedPainPoint,
  type ClaimProvenance,
  type ClaimSourceType,
} from './sourced-pain-points';

/**
 * What KIND of assertion this is — the question a customer surface must answer
 * before choosing a heading. Distinct from `provenance`, which says how well the
 * claim is evidenced.
 */
export type ClaimType =
  /** A source document states it, and we can cite that document. */
  | 'AGENCY_STATED'
  /** Mindy derived/rewrote it from one or more sources. */
  | 'MINDY_INTERPRETATION'
  /** Hand-curated corpus content with no recoverable source. */
  | 'LEGACY_MANUAL'
  /** Origin cannot be established. Never presented as agency-stated. */
  | 'UNKNOWN';

/**
 * Whether the claim can defensibly be called CURRENT.
 *
 * `UNDATED` is the honest answer for the legacy corpus: it carries no publication
 * date, so neither "current" nor "historical" is establishable. Mindy's own ingest
 * time is NOT evidence of current relevance and is never used here.
 */
export type TemporalStatus = 'CURRENT' | 'HISTORICAL' | 'UNDATED';

export interface StrategicClaim {
  /** Display-safe claim text. Legacy claims are already dollar-sanitized. */
  claim: string;
  claimType: ClaimType;
  /** The agency this claim is filed under, as stored. */
  agency: string;
  /** Canonical toptier name when the resolver could establish one, else null. */
  canonicalAgency: string | null;
  /** Who published the evidence ("GAO", …). null when unestablished. */
  sourceAuthority: string | null;
  sourceUrl: string | null;
  /** Source publication date (ISO). NOT a Mindy timestamp. */
  sourceDate: string | null;
  /** Institute evidence id when the claim traces to the corpus. */
  sourceId: string | null;
  provenance: ClaimProvenance;
  sourceType: ClaimSourceType;
  temporalStatus: TemporalStatus;
  /** True only when authority + document + URL are all establishable. */
  citable: boolean;
  /** The truthful customer-facing heading for this claim's type. */
  displayLabel: string;
}

export interface StrategicClaimBundle {
  agency: string;
  canonicalAgency: string | null;
  painPoints: StrategicClaim[];
  priorities: StrategicClaim[];
  meta: {
    /** Claims whose authority + document + URL all resolve. */
    citableCount: number;
    agencyStatedCount: number;
    legacyCount: number;
    unknownCount: number;
    /**
     * TRUE only when at least one claim is citable. A surface that promises
     * "sourced intelligence" must check this, not the array length.
     */
    provenanceAvailable: boolean;
  };
}

/**
 * Truthful wording per claim type.
 *
 * "Stated strategic priorities" was the heading proposal drafting used for the
 * ENTIRE legacy corpus — an assertion that the agency said it, for 2,500 claims
 * of which zero carry a source URL. Wording is part of the claim.
 */
export const DISPLAY_LABEL: Record<ClaimType, string> = {
  AGENCY_STATED: 'Agency-stated priority',
  MINDY_INTERPRETATION: 'Mindy interpretation',
  LEGACY_MANUAL: 'Legacy context (unsourced)',
  UNKNOWN: 'Unverified context',
};

/** Long-form disclosure for a surface that shows one line under a section. */
export const DISPLAY_DISCLOSURE: Record<ClaimType, string> = {
  AGENCY_STATED: 'Stated in the cited source document.',
  MINDY_INTERPRETATION: 'Derived by Mindy from the cited evidence — not the agency’s own wording.',
  LEGACY_MANUAL:
    'Hand-curated context with no source document on file. Not an agency statement; confirm before client-facing use.',
  UNKNOWN: 'Origin not established. Do not present as an agency statement.',
};

function claimTypeOf(p: SourcedPainPoint): ClaimType {
  if (p.provenance === 'SOURCE_FACT' && p.source_url) return 'AGENCY_STATED';
  if (p.provenance === 'MINDY_INTERPRETATION') return 'MINDY_INTERPRETATION';
  if (p.provenance === 'LEGACY_MANUAL') return 'LEGACY_MANUAL';
  return 'UNKNOWN';
}

function authorityOf(p: SourcedPainPoint): string | null {
  if (p.source_type === 'gao') return 'GAO';
  // A legacy "(Source: X)" tag names an authority we cannot verify to a document.
  // It is reported as-is and NEVER upgrades citability.
  return p.legacy_source_tag ? p.legacy_source_tag : null;
}

/**
 * Temporal status from SOURCE evidence only.
 * No publication date → UNDATED. Mindy ingest time is never substituted.
 */
function temporalOf(p: SourcedPainPoint, now: Date): TemporalStatus {
  if (!p.published_at) return 'UNDATED';
  const d = new Date(p.published_at);
  if (Number.isNaN(d.getTime())) return 'UNDATED';
  const monthsOld = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  return monthsOld <= 24 ? 'CURRENT' : 'HISTORICAL';
}

export function toStrategicClaim(
  p: SourcedPainPoint,
  canonicalAgency: string | null,
  now: Date = new Date(),
): StrategicClaim {
  const claimType = claimTypeOf(p);
  const claim =
    p.provenance === 'LEGACY_MANUAL' ? sanitizeLegacyClaimText(p.pain_point) : p.pain_point;
  const citable = Boolean(p.source_url && p.document_number && p.source_type === 'gao');
  return {
    claim,
    claimType,
    agency: p.agency,
    canonicalAgency,
    sourceAuthority: authorityOf(p),
    sourceUrl: p.source_url,
    sourceDate: p.published_at,
    sourceId: p.institute_source_id,
    provenance: p.provenance,
    sourceType: p.source_type,
    temporalStatus: temporalOf(p, now),
    citable,
    displayLabel: DISPLAY_LABEL[claimType],
  };
}

/**
 * THE read entry point for customer-facing strategic content.
 *
 * Drops claims that sanitize to nothing (a legacy claim that was ONLY an unsourced
 * dollar amount) rather than re-emitting the original — the #1577 contract.
 */
export async function getAgencyStrategicClaims(
  agencyQuery: string,
  opts: { now?: Date; sourcedLimit?: number; legacyLimit?: number } = {},
): Promise<StrategicClaimBundle> {
  const now = opts.now ?? new Date();
  const bundle = await getAgencySourcedIntelligence(agencyQuery, {
    sourcedLimit: opts.sourcedLimit,
    legacyLimit: opts.legacyLimit,
  });
  const map = (rows: SourcedPainPoint[]): StrategicClaim[] =>
    rows
      .map((r) => toStrategicClaim(r, bundle.canonicalAgency, now))
      .filter((c) => c.claim.trim().length > 0);

  const painPoints = map(bundle.painPoints);
  const priorities = map(bundle.priorities);
  const all = [...painPoints, ...priorities];
  return {
    agency: bundle.agency,
    canonicalAgency: bundle.canonicalAgency,
    painPoints,
    priorities,
    meta: {
      citableCount: all.filter((c) => c.citable).length,
      agencyStatedCount: all.filter((c) => c.claimType === 'AGENCY_STATED').length,
      legacyCount: all.filter((c) => c.claimType === 'LEGACY_MANUAL').length,
      unknownCount: all.filter((c) => c.claimType === 'UNKNOWN').length,
      provenanceAvailable: all.some((c) => c.citable),
    },
  };
}

/**
 * Render one claim for a customer surface, always carrying its type.
 * A caller cannot accidentally print a legacy claim as an agency statement.
 */
export function formatClaimForCustomer(c: StrategicClaim): string {
  return c.claimType === 'AGENCY_STATED' && c.sourceUrl
    ? `${c.claim} (${c.sourceAuthority ?? 'source'}${c.sourceDate ? `, ${c.sourceDate}` : ''})`
    : `${c.claim} [${c.displayLabel}]`;
}

/**
 * Claims safe for a HIGH-STAKES surface (a generated proposal, a public factual
 * page) — those a reader could reasonably treat as fact. Legacy and unknown
 * claims are excluded here rather than relabelled, because a proposal sentence
 * carries no room for a disclaimer.
 */
export function citableClaimsOnly(claims: StrategicClaim[]): StrategicClaim[] {
  return claims.filter((c) => c.citable && c.claimType === 'AGENCY_STATED');
}

/**
 * SYNCHRONOUS legacy-only claims.
 *
 * For callers that cannot await — today only proposal drafting, whose
 * `buildAgencyContext` is sync and sits inside the draft pipeline. It returns the
 * SAME typed claims as the async path, minus the living sourced rows (which
 * require a database round-trip).
 *
 * That asymmetry is deliberate and safe: everything this returns is
 * LEGACY_MANUAL, so a caller physically cannot mistake it for agency-stated
 * fact. It is never the right function for a surface that can await.
 */
export function getAgencyLegacyClaimsSync(
  agencyQuery: string,
  opts: { now?: Date; limit?: number } = {},
): { painPoints: StrategicClaim[]; priorities: StrategicClaim[] } {
  const now = opts.now ?? new Date();
  const legacy = loadLegacyPainPointsForAgency(agencyQuery, opts.limit ?? 50);
  const map = (rows: SourcedPainPoint[]): StrategicClaim[] =>
    rows
      .map((r) => toStrategicClaim(r, null, now))
      .filter((c) => c.claim.trim().length > 0);
  return { painPoints: map(legacy.painPoints), priorities: map(legacy.priorities) };
}

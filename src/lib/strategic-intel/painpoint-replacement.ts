/**
 * Guarded, source-cited REPLACEMENT CANDIDATES for the legacy "(Source: GAO)" pain
 * points (see legacy-gao-painpoints.ts). Proposal only — nothing here writes the
 * served JSON or the database.
 *
 * Two inputs:
 *   (a) the current GAO High-Risk List (GAO-25-107743) with a hand-curated,
 *       per-area agency mapping (data/gao/high-risk-list-GAO-25-107743.json);
 *   (b) agency-resolved GAO reports in `institute_sources` (the living GAO RSS
 *       corpus synced daily by institute-gao-sync).
 *
 * Every candidate carries a document number, URL, publication date and the method
 * that established its agency. THE GUARDS (each rejection is reported, never
 * silently dropped):
 *   - no source published before 2001-01-01;
 *   - no candidate without an https URL;
 *   - no candidate without a GAO document number;
 *   - no agency that does not resolve EXACTLY to a canonical toptier name through
 *     the anchored resolver, and no agency established by substring matching.
 *
 * Pure: no DB, no network, no filesystem.
 */
import { resolve as resolvePath, sep } from 'node:path';
import { resolveAgency } from '@/lib/strategic-intel/agency-resolver';

export const MIN_SOURCE_DATE = '2001-01-01';
export const GAO_DOC_RE = /^GAO-\d{2}-\d{5,6}$/;

/** How a candidate's agency was established. Substring is listed so it can be refused by name. */
export type AgencyResolutionMethod =
  | 'curated_area_table:title_named'
  | 'curated_area_table:program_owner'
  | 'institute_resolver:cgac_code'
  | 'institute_resolver:exact_name'
  | 'institute_resolver:alias'
  | 'institute_resolver:department_of'
  | 'substring'
  | 'unresolved';

const ACCEPTED_METHODS = new Set<AgencyResolutionMethod>([
  'curated_area_table:title_named',
  'curated_area_table:program_owner',
  'institute_resolver:cgac_code',
  'institute_resolver:exact_name',
  'institute_resolver:alias',
  'institute_resolver:department_of',
]);

export type CandidateOrigin = 'gao_high_risk_2025' | 'institute_gao_report';

export interface ReplacementCandidate {
  agency: string;
  pain_point: string;
  origin: CandidateOrigin;
  document_number: string;
  source_url: string;
  publication_date: string;
  agency_resolution_method: AgencyResolutionMethod;
  /** True when a human must confirm the agency mapping before adoption. */
  requires_review: boolean;
  /** institute_sources.id when the candidate came from (b). */
  institute_source_id?: string | null;
  /** High-Risk area number when the candidate came from (a). */
  high_risk_area?: number;
}

export type RejectionReason =
  | 'pre_2001_source'
  | 'missing_publication_date'
  | 'missing_url'
  | 'missing_document_number'
  | 'unresolved_agency'
  | 'substring_agency';

export interface Rejection {
  reason: RejectionReason;
  detail: string;
  candidate: Partial<ReplacementCandidate>;
}

function day(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null;
}

/**
 * Apply every guard. Returns the first failing reason, or null when the candidate
 * may be proposed. Order is fixed so a report's rejection counts are stable.
 */
export function rejectReason(c: Partial<ReplacementCandidate>): { reason: RejectionReason; detail: string } | null {
  const date = day(c.publication_date ?? null);
  if (!date) return { reason: 'missing_publication_date', detail: `publication_date=${c.publication_date ?? 'null'}` };
  if (date < MIN_SOURCE_DATE) return { reason: 'pre_2001_source', detail: `published ${date}, before ${MIN_SOURCE_DATE}` };

  const url = (c.source_url ?? '').trim();
  if (!/^https:\/\/\S+$/i.test(url)) return { reason: 'missing_url', detail: `source_url=${c.source_url ?? 'null'}` };

  if (!c.document_number || !GAO_DOC_RE.test(c.document_number)) {
    return { reason: 'missing_document_number', detail: `document_number=${c.document_number ?? 'null'}` };
  }

  if (c.agency_resolution_method === 'substring') {
    return { reason: 'substring_agency', detail: `agency "${c.agency ?? ''}" was established by substring matching` };
  }
  if (!c.agency_resolution_method || !ACCEPTED_METHODS.has(c.agency_resolution_method)) {
    return { reason: 'unresolved_agency', detail: `method=${c.agency_resolution_method ?? 'null'}` };
  }
  // The agency STRING itself must be a canonical toptier name (exact), so a
  // candidate can never carry an agency the resolver would not stand behind.
  const r = resolveAgency({ agencyName: c.agency ?? '' });
  if (!r.resolved || r.method !== 'exact_name' || r.canonicalAgency !== c.agency) {
    return { reason: 'unresolved_agency', detail: `"${c.agency ?? ''}" is not an exact canonical agency (${r.method})` };
  }
  return null;
}

export interface Partitioned {
  accepted: ReplacementCandidate[];
  rejected: Rejection[];
}

export function partitionCandidates(cands: Array<Partial<ReplacementCandidate>>): Partitioned {
  const accepted: ReplacementCandidate[] = [];
  const rejected: Rejection[] = [];
  for (const c of cands) {
    const why = rejectReason(c);
    if (why) rejected.push({ ...why, candidate: c });
    else accepted.push(c as ReplacementCandidate);
  }
  return { accepted, rejected };
}

// ── (a) GAO High-Risk List ──────────────────────────────────────────────────

export type HighRiskMappingBasis = 'title_named' | 'program_owner' | 'multi_agency' | 'government_wide';

export interface HighRiskArea {
  n: number;
  area: string;
  url: string;
  mapping_basis: HighRiskMappingBasis;
  agencies: string[];
}

export interface HighRiskList {
  _about: { document_number: string; publication_date: string; edition: string };
  areas: HighRiskArea[];
}

export function highRiskCandidates(list: HighRiskList): {
  candidates: Array<Partial<ReplacementCandidate>>;
  unmappedAreas: Array<{ n: number; area: string; mapping_basis: HighRiskMappingBasis }>;
} {
  const doc = list._about.document_number;
  const date = list._about.publication_date;
  const candidates: Array<Partial<ReplacementCandidate>> = [];
  const unmappedAreas: Array<{ n: number; area: string; mapping_basis: HighRiskMappingBasis }> = [];
  for (const a of list.areas) {
    if (a.mapping_basis === 'multi_agency' || a.mapping_basis === 'government_wide' || a.agencies.length === 0) {
      unmappedAreas.push({ n: a.n, area: a.area, mapping_basis: a.mapping_basis });
      continue;
    }
    for (const agency of a.agencies) {
      candidates.push({
        agency,
        pain_point: `${a.area} (GAO High-Risk List, ${doc}, ${list._about.edition})`,
        origin: 'gao_high_risk_2025',
        document_number: doc,
        source_url: a.url,
        publication_date: date,
        agency_resolution_method: `curated_area_table:${a.mapping_basis}` as AgencyResolutionMethod,
        requires_review: a.mapping_basis === 'program_owner',
        high_risk_area: a.n,
      });
    }
  }
  return { candidates, unmappedAreas };
}

// ── (b) institute_sources GAO reports ───────────────────────────────────────

export interface InstituteGaoRow {
  id: string;
  source_org: string | null;
  source_type: string | null;
  document_number: string | null;
  title: string | null;
  source_url: string | null;
  publication_date: string | null;
  canonical_agency: string | null;
  resolution_method: string | null;
}

export function instituteCandidates(rows: InstituteGaoRow[]): Array<Partial<ReplacementCandidate>> {
  return rows
    .filter((r) => r.source_org === 'GAO')
    .map((r) => {
      const method = r.resolution_method && r.canonical_agency
        ? (`institute_resolver:${r.resolution_method}` as AgencyResolutionMethod)
        : 'unresolved';
      const title = (r.title ?? '').trim();
      return {
        agency: r.canonical_agency ?? '',
        pain_point: r.document_number ? `${title} (Source: ${r.document_number})` : title,
        origin: 'institute_gao_report' as const,
        document_number: r.document_number ?? undefined,
        source_url: r.source_url ?? undefined,
        publication_date: r.publication_date ?? undefined,
        agency_resolution_method: method,
        requires_review: false,
        institute_source_id: r.id,
      };
    });
}

// ── Output path guard ───────────────────────────────────────────────────────

/**
 * The workflow may only write a PROPOSED file. Refuse the served JSON and
 * anything under src/ (the bundle) — adoption is a separate, approved step.
 */
export function assertProposedOutputPath(outPath: string, repoRoot: string): string {
  const abs = resolvePath(repoRoot, outPath);
  const served = resolvePath(repoRoot, 'src/data/agency-pain-points.json');
  const srcDir = resolvePath(repoRoot, 'src') + sep;
  if (abs === served) throw new Error(`refusing to write the served pain-point JSON: ${abs}`);
  if (abs.startsWith(srcDir)) throw new Error(`refusing to write under src/ (served bundle): ${abs}`);
  return abs;
}

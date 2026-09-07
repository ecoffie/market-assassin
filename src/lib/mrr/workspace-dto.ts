import type { RenderedCell } from './grounding';
import { WORKSPACE_PROTOTYPE_BANNER } from './workspace-constants';
import type { EvidenceRef, GroundedField, Requirement, RuleOfTwoDetermination } from './types';

export type ReviewState = 'Sourced' | 'Unknown' | 'Degraded' | 'Measured zero';

export interface ReviewEvidence {
  source: string;
  retrievedAt: string;
  query: Record<string, unknown>;
  url?: string;
}

export interface ReviewFinding {
  label: string;
  state: ReviewState;
  text: string;
  reason?: string;
  evidence: ReviewEvidence[];
}

export interface SectionReviewCard {
  id: '5' | '9' | '11' | '12' | '15';
  title: string;
  state: ReviewState;
  keyFindings: ReviewFinding[];
  sources: string[];
  retrievedAt: string[];
  limitations: string[];
  provenance: ReviewFinding[];
}

export interface SupplierPopulationReview {
  eligiblePopulation: ReviewFinding;
  matchingUeis: ReviewFinding;
  boundedSampleReturned: ReviewFinding;
  capableActiveUeis: ReviewFinding;
  evaluatedUeis: ReviewFinding;
  resolvedCorporateFamilies: ReviewFinding;
  ambiguousOrUnresolvedParents: ReviewFinding;
  displayedVendorRows: ReviewFinding;
  matchingCoverageRatio: string | null;
  familyResolutionCoverageRatio: string | null;
  sampleToMatchingRatio: string | null;
  exclusionNote: string | null;
  completenessWarning: string;
}

export interface RuleOfTwoReview {
  determination: ReviewFinding;
  recommendation: ReviewFinding;
  evidenceBoundary: string;
}

/**
 * The only input `createPhase1ReviewDto` accepts. Live Phase 1 results are a
 * structural superset; restamp/reassembly reconstructs this from evidence.
 */
export interface Phase1ReviewSource {
  runId: string;
  intakeHash: string;
  generatedAt: string;
  requirement: { normalized: Requirement; notes: string[] };
  cells: RenderedCell[];
  section11: {
    suppliers: ReadonlyArray<unknown>;
    rawUeiCount: GroundedField<number>;
    evaluatedUeiCount: GroundedField<number>;
    boundedSampleReturned: GroundedField<number>;
    capableActiveCount: GroundedField<number>;
    excludedBeforeFamilyResolution: GroundedField<number>;
    deduplicatedFamilyCount: GroundedField<number>;
    ambiguousParentCount: GroundedField<number>;
    eligiblePopulation: GroundedField<number>;
    limitations: string[];
  };
  section12: {
    determination: GroundedField<RuleOfTwoDetermination>;
    recommendation: GroundedField<string>;
    limitations: string[];
  };
  section15: {
    pricingEvidence: GroundedField<string>;
    limitations: string[];
  };
}

export interface Phase1ReviewDto {
  runId: string;
  intakeHash: string;
  generatedAt: string;
  prototypeBanner: string;
  requirement: Requirement;
  normalizationNotes: string[];
  sections: SectionReviewCard[];
  suppliers: SupplierPopulationReview;
  ruleOfTwo: RuleOfTwoReview;
  pricing: {
    label: 'Supporting pricing evidence — not a government estimate';
    isGovernmentEstimate: false;
    finding: ReviewFinding;
  };
  summary: {
    mindyCompleted: string[];
    koMustComplete: string[];
  };
  downloads: Array<{
    kind: 'mrr' | 'appendix' | 'evidence';
    label: string;
    href: string;
  }>;
}

const REVIEW_STATE: Record<RenderedCell['state'], ReviewState> = {
  value: 'Sourced',
  true_zero: 'Measured zero',
  unknown: 'Unknown',
  degraded: 'Degraded',
};

function evidenceRefs(refs: EvidenceRef[]): ReviewEvidence[] {
  return refs.map((ref) => ({
    source: ref.source,
    retrievedAt: ref.retrievedAt,
    query: ref.query,
    ...(ref.url ? { url: ref.url } : {}),
  }));
}

function findingFromCell(cell: RenderedCell): ReviewFinding {
  return {
    label: cell.label,
    state: REVIEW_STATE[cell.state],
    text: cell.text,
    ...(cell.reason ? { reason: cell.reason } : {}),
    evidence: evidenceRefs(cell.evidence),
  };
}

function displayGroundedValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

export function findingFromGrounded<T>(
  label: string,
  field: GroundedField<T>,
): ReviewFinding {
  if (field.state === 'value') {
    return {
      label,
      state: 'Sourced',
      text: displayGroundedValue(field.value),
      evidence: evidenceRefs([field.evidence]),
    };
  }
  if (field.state === 'true_zero') {
    return {
      label,
      state: 'Measured zero',
      text: `Recorded: 0 — ${field.label}`,
      evidence: evidenceRefs([field.evidence]),
    };
  }
  if (field.state === 'degraded') {
    return {
      label,
      state: 'Degraded',
      text: `Degraded — ${field.reason}`,
      reason: field.reason,
      evidence: evidenceRefs(field.evidence),
    };
  }
  return {
    label,
    state: 'Unknown',
    text: `Unknown / Insufficient evidence — ${field.reason}`,
    reason: field.reason,
    evidence: evidenceRefs(field.attemptedEvidence ?? []),
  };
}

function overallState(findings: ReviewFinding[]): ReviewState {
  if (findings.some((finding) => finding.state === 'Degraded')) return 'Degraded';
  if (findings.some((finding) => finding.state === 'Unknown')) return 'Unknown';
  if (
    findings.length > 0 &&
    findings.every((finding) => finding.state === 'Measured zero')
  ) {
    return 'Measured zero';
  }
  return 'Sourced';
}

function card(
  id: SectionReviewCard['id'],
  title: string,
  cells: RenderedCell[],
  limitations: string[],
): SectionReviewCard {
  const provenance = cells.map(findingFromCell);
  const allEvidence = provenance.flatMap((finding) => finding.evidence);
  return {
    id,
    title,
    state: overallState(provenance),
    keyFindings: provenance.slice(0, 8),
    sources: [...new Set(allEvidence.map((item) => item.source))],
    retrievedAt: [...new Set(allEvidence.map((item) => item.retrievedAt))],
    limitations,
    provenance,
  };
}

function ratio(
  numerator: GroundedField<number>,
  denominator: GroundedField<number>,
): string | null {
  if (numerator.state !== 'value' || denominator.state !== 'value') return null;
  if (denominator.value <= 0) return null;
  return `${((numerator.value / denominator.value) * 100).toFixed(1)}% (${numerator.value.toLocaleString('en-US')} / ${denominator.value.toLocaleString('en-US')})`;
}

function displayedRowsFinding(result: Phase1ReviewSource): ReviewFinding {
  const displayed = Math.min(result.section11.suppliers.length, 25);
  const raw = result.section11.rawUeiCount;
  if (displayed > 0) {
    const source =
      raw.state === 'value' || raw.state === 'true_zero'
        ? [raw.evidence]
        : raw.state === 'degraded'
          ? raw.evidence
          : raw.attemptedEvidence ?? [];
    return {
      label: 'Displayed vendor rows',
      state: 'Sourced',
      text: String(displayed),
      evidence: evidenceRefs(source),
    };
  }
  if (raw.state === 'true_zero') {
    return {
      label: 'Displayed vendor rows',
      state: 'Measured zero',
      text: `Recorded: 0 — ${raw.label}`,
      evidence: evidenceRefs([raw.evidence]),
    };
  }
  return {
    label: 'Displayed vendor rows',
    state: raw.state === 'degraded' ? 'Degraded' : 'Unknown',
    text:
      raw.state === 'degraded'
        ? `Degraded — ${raw.reason}`
        : `Unknown / Insufficient evidence — ${
            raw.state === 'unknown' ? raw.reason : 'supplier population was not established'
          }`,
    evidence: evidenceRefs(
      raw.state === 'degraded'
        ? raw.evidence
        : raw.state === 'unknown'
          ? raw.attemptedEvidence ?? []
          : [],
    ),
  };
}

export function createPhase1ReviewDto(result: Phase1ReviewSource): Phase1ReviewDto {
  const sectionCells = (id: string) =>
    result.cells.filter((cell) => cell.label.startsWith(`§${id} `));
  const s11 = result.section11;
  const s12 = result.section12;
  const pricingFinding = findingFromGrounded(
    'Supporting pricing evidence',
    result.section15.pricingEvidence,
  );

  return {
    runId: result.runId,
    intakeHash: result.intakeHash,
    generatedAt: result.generatedAt,
    prototypeBanner: WORKSPACE_PROTOTYPE_BANNER,
    requirement: result.requirement.normalized,
    normalizationNotes: result.requirement.notes,
    sections: [
      card('5', '§5 Taxonomy', sectionCells('5'), []),
      card('9', '§9 Procurement History', sectionCells('9'), []),
      card('11', '§11 Potential Suppliers', sectionCells('11'), s11.limitations),
      card(
        '12',
        '§12 Small Business / Rule of Two',
        sectionCells('12'),
        s12.limitations,
      ),
      card(
        '15',
        '§15 Market Intelligence',
        sectionCells('15'),
        result.section15.limitations,
      ),
    ],
    suppliers: {
      eligiblePopulation: findingFromGrounded(
        'Eligible population',
        s11.eligiblePopulation,
      ),
      matchingUeis: findingFromGrounded('Matching UEIs', s11.rawUeiCount),
      boundedSampleReturned: findingFromGrounded(
        'Bounded sample returned',
        s11.boundedSampleReturned,
      ),
      capableActiveUeis: findingFromGrounded(
        'Capable/active after tier filtering',
        s11.capableActiveCount,
      ),
      evaluatedUeis: findingFromGrounded(
        'Submitted for family resolution',
        s11.evaluatedUeiCount,
      ),
      resolvedCorporateFamilies: findingFromGrounded(
        'Resolved corporate families',
        s11.deduplicatedFamilyCount,
      ),
      ambiguousOrUnresolvedParents: findingFromGrounded(
        'Ambiguous/unresolved parents',
        s11.ambiguousParentCount,
      ),
      displayedVendorRows: displayedRowsFinding(result),
      matchingCoverageRatio: ratio(s11.rawUeiCount, s11.eligiblePopulation),
      familyResolutionCoverageRatio: ratio(
        s11.evaluatedUeiCount,
        s11.rawUeiCount,
      ),
      sampleToMatchingRatio: ratio(s11.boundedSampleReturned, s11.rawUeiCount),
      exclusionNote:
        s11.boundedSampleReturned.state === 'value'
        && s11.capableActiveCount.state === 'value'
        && s11.excludedBeforeFamilyResolution.state === 'value'
          ? `${s11.boundedSampleReturned.value} suppliers sampled; ${s11.capableActiveCount.value} met the capable/active evaluation gate; ${s11.excludedBeforeFamilyResolution.value} were excluded before corporate-family resolution.`
          : null,
      completenessWarning:
        'These counts are separate and must not be interchanged: eligible population, matching UEIs, bounded sample returned, capable/active after tier filtering, UEIs submitted for family resolution, resolved families, ambiguous/unresolved families, and suppliers displayed. Matching coverage is matching UEIs / eligible population. Family-resolution coverage is submitted-for-family-resolution UEIs / matching UEIs. Sample coverage is bounded sample / matching UEIs. Capable/active is never the complete bounded sample when firms were excluded before family resolution. Resolved-family count is never the deduplicated full market unless the evidence establishes complete matching and complete evaluation.',
    },
    ruleOfTwo: {
      determination: findingFromGrounded(
        'Rule-of-Two determination',
        s12.determination,
      ),
      recommendation: findingFromGrounded(
        'Set-aside recommendation',
        s12.recommendation,
      ),
      evidenceBoundary:
        'A Rule-of-Two conclusion is supportable only from at least two distinct parent-deduplicated capable small businesses with established size evidence and complete enough coverage. Incomplete samples or missing business-size evidence remain Unknown / Insufficient.',
    },
    pricing: {
      label: 'Supporting pricing evidence — not a government estimate',
      isGovernmentEstimate: false,
      finding: pricingFinding,
    },
    summary: {
      mindyCompleted: [
        '§5 Taxonomy',
        '§9 Procurement History',
        '§11 Potential Suppliers',
        '§12 Small Business / Rule of Two evidence',
        '§15 Market Intelligence',
        'MRR DOCX, Sourced Evidence Appendix, and Evidence JSON',
      ],
      koMustComplete: [
        'All Phase 2 sections and acquisition-specific context',
        'Independent Government Estimate',
        'Commerciality and mandatory-source determinations',
        'Final conclusions, recommendations, certifications, and signatures',
        'Human verification of source limitations and supplier-size evidence',
      ],
    },
    downloads: [
      {
        kind: 'mrr',
        label: 'MRR DOCX',
        href: `/api/app/market-research/download?id=${encodeURIComponent(result.runId)}&kind=mrr`,
      },
      {
        kind: 'appendix',
        label: 'Sourced Evidence Appendix DOCX',
        href: `/api/app/market-research/download?id=${encodeURIComponent(result.runId)}&kind=appendix`,
      },
      {
        kind: 'evidence',
        label: 'Evidence JSON',
        href: `/api/app/market-research/download?id=${encodeURIComponent(result.runId)}&kind=evidence`,
      },
    ],
  };
}

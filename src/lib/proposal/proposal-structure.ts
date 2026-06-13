/**
 * Compliance-matrix-driven proposal STRUCTURE.
 *
 * Turns the extracted compliance requirements into the volume → section →
 * subsection tree a federal proposal must follow — so the skeleton matches THIS
 * solicitation's required structure, not a fixed template. (Eric: people can't
 * format a full IDIQ/MACC proposal; the structure is the hard part.)
 *
 * The canonical IDIQ/MACC shape (from the real Miami Wiipica W25G1V21R0014 MACC
 * in the vault) is the 4-volume package:
 *   Volume I  — Technical  (Subfactor a: Bonding, b: Safety/APP, c: QCP, d: CMP)
 *   Volume II — Past Performance
 *   Volume III— Pricing
 *   Volume IV — Solicitation & Award (SF1442 / reps & certs / contract forms)
 *
 * We start from that canonical tree and DRIVE it with the compliance matrix:
 * requirements attach under the volume/section they belong to (via the existing
 * alignMatrix), the actual L/M section labels are carried through, and a volume/
 * section with zero requirements is marked optional (present for completeness,
 * flagged so the user knows the RFP didn't explicitly ask for it).
 *
 * Deterministic — no LLM. The LLM already did the extraction (compliance route);
 * this is pure shaping. (Memory: proposal_assist_v1; builds on section-alignment.)
 */

import { alignMatrix, priorityOf, type ComplianceReq, type AlignedSection } from './section-alignment';

// Stable identity for a requirement — id when present, else its text. Used for
// dedup so a requirement can't be both "placed in a volume" and "cross-cutting".
const reqKey = (r: ComplianceReq): string => r.id || r.requirement || '';

export interface ProposalSubsection {
  key: string;
  title: string;
  /** Requirements (from the matrix) this subsection must satisfy. */
  requirements: ComplianceReq[];
  /** The corpus doc_type that holds a real example of this sub-document. */
  exampleDocType?: string;
}

export interface ProposalSection {
  key: string;
  title: string;
  /** Which aligned section bucket feeds this (technical / management / etc.). */
  aligned: AlignedSection;
  subsections: ProposalSubsection[];
  requirements: ComplianceReq[];
  /** True when no requirement explicitly drove this — included for completeness. */
  optional: boolean;
}

export interface ProposalVolume {
  key: string;
  title: string;       // "Volume I — Technical"
  sections: ProposalSection[];
  optional: boolean;
}

export interface ProposalStructure {
  volumes: ProposalVolume[];
  /** Requirements that didn't map to any specific volume (format/admin/eval). */
  crossCutting: ComplianceReq[];
  /** Critical requirements (deadlines, mandatory plans/certs) surfaced up front. */
  critical: ComplianceReq[];
}

// The canonical Volume I — Technical subfactor tree (from the real MACC). Each
// carries the regex that pulls its requirements out of the technical bucket and
// the corpus doc_type that holds a real example to mirror.
const TECHNICAL_SUBFACTORS: Array<{ key: string; title: string; match: RegExp; exampleDocType?: string }> = [
  { key: 'bonding', title: 'Bonding Capacity', match: /\bbond(ing|ed)?\b|surety|single[ _-]?aggregate/i },
  { key: 'safety', title: 'Safety Program (APP / EMR / OSHA)', match: /safety|accident[ _-]?prevention|\bapp\b|em[ _-]?385|\bemr\b|osha|experience[ _-]?modification/i, exampleDocType: 'proposal_subdoc' },
  { key: 'qcp', title: 'Quality Control Plan (QCP)', match: /quality[ _-]?control|\bqcp\b|quality[ _-]?(plan|objective)|inspection|testing[ _-]?plan/i, exampleDocType: 'proposal_subdoc' },
  { key: 'cmp', title: 'Contract Management Plan (CMP)', match: /contract[ _-]?management|\bcmp\b|management[ _-]?(plan|approach)|key[ _-]?personnel|staffing|organizational?[ _-]?chart|project[ _-]?schedule|transition/i, exampleDocType: 'proposal_subdoc' },
];

/** Build the volume/section tree from a compliance matrix. */
export function buildProposalStructure(requirements: ComplianceReq[]): ProposalStructure {
  const aligned = alignMatrix(requirements);
  const bucket = (s: string): ComplianceReq[] => aligned.bySection[s] || [];

  const technicalReqs = bucket('technical').concat(bucket('management'));
  const usedTechIds = new Set<string>();

  // ---- Volume I — Technical (subfactor tree) ----
  const techSections: ProposalSection[] = TECHNICAL_SUBFACTORS.map((sf) => {
    const reqs = technicalReqs.filter((r) => sf.match.test(r.requirement || ''));
    reqs.forEach((r) => usedTechIds.add(reqKey(r)));
    return {
      key: sf.key,
      title: sf.title,
      aligned: 'technical' as AlignedSection,
      subsections: [{ key: sf.key, title: sf.title, requirements: reqs, exampleDocType: sf.exampleDocType }],
      requirements: reqs,
      optional: reqs.length === 0,
    };
  });
  // Any technical/management requirement not captured by a named subfactor →
  // a catch-all "Technical Approach" section so nothing is dropped.
  const otherTech = technicalReqs.filter((r) => !usedTechIds.has(reqKey(r)));
  if (otherTech.length) {
    techSections.unshift({
      key: 'technical_approach',
      title: 'Technical Approach',
      aligned: 'technical',
      subsections: [{ key: 'technical_approach', title: 'Technical Approach', requirements: otherTech, exampleDocType: 'technical_volume' }],
      requirements: otherTech,
      optional: false,
    });
  }

  // ---- Volume II — Past Performance ----
  const ppReqs = bucket('past_performance');
  // ---- Volume III — Pricing ----
  const pricingReqs = bucket('pricing');
  // ---- Volume IV — Solicitation & Award (forms / reps & certs) ----
  // admin/submission requirements route to the 'all' bucket via alignMatrix, so
  // we pull the forms-specific ones OUT of 'all' by their text (SF1442, reps &
  // certs, FAR provisions) rather than from a non-existent 'admin' bucket.
  const FORMS_TEXT = /sf[ _-]?1442|sf[ _-]?1449|sf[ _-]?30\b|reps?[ _-]?(and|&)?[ _-]?cert|representations?[ _-]?and[ _-]?certifications?|\b52\.2\d|far[ _-]?provision|offer[ _-]?and[ _-]?award|solicitation[ _-]?form/i;
  const formsReqs = bucket('all').filter((r) => FORMS_TEXT.test(r.requirement || ''));

  const volumes: ProposalVolume[] = [
    {
      key: 'vol1_technical',
      title: 'Volume I — Technical',
      sections: techSections,
      optional: techSections.every((s) => s.optional),
    },
    {
      key: 'vol2_past_performance',
      title: 'Volume II — Past Performance',
      sections: [{ key: 'past_performance', title: 'Past Performance', aligned: 'past_performance', subsections: [{ key: 'past_performance', title: 'Relevant Projects', requirements: ppReqs, exampleDocType: 'past_performance' }], requirements: ppReqs, optional: ppReqs.length === 0 }],
      optional: ppReqs.length === 0,
    },
    {
      key: 'vol3_pricing',
      title: 'Volume III — Pricing',
      sections: [{ key: 'pricing', title: 'Pricing', aligned: 'pricing', subsections: [{ key: 'pricing', title: 'Price / Cost Schedule', requirements: pricingReqs, exampleDocType: 'pricing_volume' }], requirements: pricingReqs, optional: pricingReqs.length === 0 }],
      optional: pricingReqs.length === 0,
    },
    {
      key: 'vol4_forms',
      title: 'Volume IV — Solicitation, Offer & Award',
      sections: [{ key: 'forms', title: 'Solicitation Forms & Representations', aligned: 'all', subsections: [{ key: 'forms', title: 'SF Forms / Reps & Certs', requirements: formsReqs, exampleDocType: 'contract_forms' }], requirements: formsReqs, optional: formsReqs.length === 0 }],
      optional: formsReqs.length === 0,
    },
  ];

  // Cross-cutting = submission/eval/admin that didn't land in a volume above
  // (page limits, formatting, evaluation factors). Surfaced separately so the
  // user sees the rules without them cluttering a content volume.
  const placedIds = new Set<string>();
  volumes.forEach((v) => v.sections.forEach((s) => s.requirements.forEach((r) => placedIds.add(reqKey(r)))));
  const crossCutting = requirements.filter((r) => !placedIds.has(reqKey(r)));
  const critical = requirements.filter((r) => priorityOf(r) === 'critical');

  return { volumes, crossCutting, critical };
}

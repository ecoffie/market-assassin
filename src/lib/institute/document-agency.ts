/**
 * Document-level agency classification for Institute GAO sources.
 *
 * Extends resolveDocumentAgency with curated high-confidence phrases (FAA→DOT,
 * NPS→Interior, …) while preserving the multi-agency refuse contract.
 *
 * Classification vocabulary (Phase 5 audit):
 *   EXACT_RESOLVABLE | HIGH_CONFIDENCE_RESOLVABLE | MULTI_AGENCY | NO_AGENCY | UNKNOWN
 *
 * NEVER force-maps. MULTI_AGENCY stays unresolved and records candidate agencies
 * in the resolution note / raw provenance — not a single coerced department.
 */
import { resolveAgency, type AgencyResolution } from '@/lib/strategic-intel/agency-resolver';
import type { InstituteDocument } from './sources';

export type DocumentAgencyClass =
  | 'EXACT_RESOLVABLE'
  | 'HIGH_CONFIDENCE_RESOLVABLE'
  | 'MULTI_AGENCY'
  | 'NO_AGENCY'
  | 'UNKNOWN';

export interface DocumentAgencyAudit {
  classification: DocumentAgencyClass;
  candidates: string[];
  resolution: AgencyResolution;
  note: string;
}

/**
 * Curated phrase → canonical toptier. Only phrases whose TARGET is one of the
 * 49 toptier names. Sub-agency names (FAA, NPS) map UP to their department —
 * never invent a non-toptier canonical.
 *
 * Longer phrases are matched first so "Federal Aviation Administration" wins
 * over a bare "FAA" collision inside an unrelated sentence (still word-bounded).
 */
const PHRASE_TO_TOPTIER: Array<{ phrase: string; canonical: string; tier: 'exact' | 'high' }> = [
  { phrase: 'Federal Aviation Administration', canonical: 'Department of Transportation', tier: 'exact' },
  { phrase: 'General Services Administration', canonical: 'General Services Administration', tier: 'exact' },
  { phrase: 'Federal Emergency Management Agency', canonical: 'Department of Homeland Security', tier: 'exact' },
  { phrase: 'National Nuclear Security Administration', canonical: 'Department of Energy', tier: 'exact' },
  { phrase: 'Financial Crimes Enforcement Network', canonical: 'Department of the Treasury', tier: 'exact' },
  { phrase: 'National Park Service', canonical: 'Department of the Interior', tier: 'exact' },
  { phrase: 'Federal Communications Commission', canonical: 'Federal Communications Commission', tier: 'exact' },
  { phrase: 'Department of Homeland Security', canonical: 'Department of Homeland Security', tier: 'exact' },
  { phrase: 'Department of Transportation', canonical: 'Department of Transportation', tier: 'exact' },
  { phrase: 'Department of Defense', canonical: 'Department of Defense', tier: 'exact' },
  { phrase: 'Department of Energy', canonical: 'Department of Energy', tier: 'exact' },
  { phrase: 'Department of Education', canonical: 'Department of Education', tier: 'exact' },
  { phrase: 'Department of the Interior', canonical: 'Department of the Interior', tier: 'exact' },
  { phrase: 'Department of the Treasury', canonical: 'Department of the Treasury', tier: 'exact' },
  { phrase: 'Department of Agriculture', canonical: 'Department of Agriculture', tier: 'exact' },
  { phrase: 'Department of Health and Human Services', canonical: 'Department of Health and Human Services', tier: 'exact' },
  { phrase: 'Army Corps of Engineers', canonical: 'Department of Defense', tier: 'high' },
  { phrase: 'K-12 Education', canonical: 'Department of Education', tier: 'high' },
  { phrase: 'FinCEN', canonical: 'Department of the Treasury', tier: 'high' },
  { phrase: 'NNSA', canonical: 'Department of Energy', tier: 'high' },
  { phrase: 'FEMA', canonical: 'Department of Homeland Security', tier: 'high' },
  { phrase: 'NPS', canonical: 'Department of the Interior', tier: 'high' },
  { phrase: 'FAA', canonical: 'Department of Transportation', tier: 'high' },
  { phrase: 'GSA', canonical: 'General Services Administration', tier: 'high' },
  { phrase: 'FCC', canonical: 'Federal Communications Commission', tier: 'high' },
  { phrase: 'DoD', canonical: 'Department of Defense', tier: 'high' },
  { phrase: 'DOD', canonical: 'Department of Defense', tier: 'high' },
];

/** Titles that are methodology / self-assessment / government-wide with no single agency. */
const NO_AGENCY_PATTERNS = [
  /\bTesting and Evaluation Guide\b/i,
  /\bExposure Draft\b/i,
  /\bFederal Rulemaking\b/i,
  /\bGood Cause and Other Mechanisms\b/i,
  // GAO OIG reports about GAO itself — not a customer buying agency.
  /\bEnhanced Controls Could Help GAO\b/i,
  /\bWhat the OIG Found\b/i,
];

function wordBounded(haystack: string, phrase: string): boolean {
  const re = new RegExp(
    `(?:^|[^A-Za-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^A-Za-z0-9]|$)`,
    'i',
  );
  return re.test(haystack);
}

/**
 * Collect unique canonical agencies named in the document (title + abstract).
 * Returns both the set and the strongest tier that produced each hit.
 */
export function collectDocumentAgencyHits(
  doc: InstituteDocument,
  canonicalNames: string[],
): { hits: Map<string, 'exact' | 'high'>; multiAgency: boolean } {
  const haystack = `${doc.title}\n${doc.abstract ?? ''}`;
  const hits = new Map<string, 'exact' | 'high'>();

  // Full canonical toptier names (existing contract).
  for (const name of canonicalNames) {
    if (wordBounded(haystack, name)) hits.set(name, 'exact');
  }

  // Curated phrases → toptier.
  for (const { phrase, canonical, tier } of PHRASE_TO_TOPTIER) {
    if (!wordBounded(haystack, phrase)) continue;
    const prior = hits.get(canonical);
    if (!prior || (prior === 'high' && tier === 'exact')) hits.set(canonical, tier);
  }

  return { hits, multiAgency: hits.size > 1 };
}

/**
 * Resolve which agency a document concerns — with multi-agency refuse + no-agency.
 *
 * Drop-in upgrade for the previous resolveDocumentAgency: same return type, richer
 * matching, same refuse-on-ambiguous contract.
 */
export function resolveDocumentAgencyWithPhrases(
  doc: InstituteDocument,
  canonicalNames: string[],
): AgencyResolution {
  const audit = classifyDocumentAgency(doc, canonicalNames);
  return audit.resolution;
}

export function classifyDocumentAgency(
  doc: InstituteDocument,
  canonicalNames: string[],
): DocumentAgencyAudit {
  const haystack = `${doc.title}\n${doc.abstract ?? ''}`;

  // Explicit no-agency / methodology / self-report.
  for (const pat of NO_AGENCY_PATTERNS) {
    if (pat.test(haystack) || pat.test(doc.title)) {
      const resolution = resolveAgency({ agencyName: '' });
      return {
        classification: 'NO_AGENCY',
        candidates: [],
        resolution: {
          ...resolution,
          note: `Classified NO_AGENCY: document is methodology, government-wide, or about GAO itself (${pat}).`,
        },
        note: 'No single customer agency — left unresolved by design.',
      };
    }
  }

  const { hits, multiAgency } = collectDocumentAgencyHits(doc, canonicalNames);
  const candidates = [...hits.keys()].sort();

  if (multiAgency) {
    const resolution = resolveAgency({ agencyName: '' });
    return {
      classification: 'MULTI_AGENCY',
      candidates,
      resolution: {
        ...resolution,
        note: `MULTI_AGENCY: named ${candidates.join(' · ')}. Refused single-department coercion; candidates preserved.`,
      },
      note: `Multi-agency provenance preserved: ${candidates.join(', ')}`,
    };
  }

  if (candidates.length === 1) {
    const canonical = candidates[0];
    const tier = hits.get(canonical)!;
    const resolution = resolveAgency({ agencyName: canonical });
    return {
      classification: tier === 'exact' ? 'EXACT_RESOLVABLE' : 'HIGH_CONFIDENCE_RESOLVABLE',
      candidates,
      resolution: resolution.resolved
        ? {
            ...resolution,
            note: `${tier === 'exact' ? 'Exact' : 'High-confidence'} document phrase → ${canonical}.`,
          }
        : resolution,
      note: `Single agency ${canonical} (${tier}).`,
    };
  }

  const resolution = resolveAgency({ agencyName: '' });
  return {
    classification: 'UNKNOWN',
    candidates: [],
    resolution: {
      ...resolution,
      note: 'No defensible single-agency phrase found. Left unresolved rather than guessed.',
    },
    note: 'Unknown — no force-map.',
  };
}

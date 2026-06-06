/**
 * Section alignment — map each extracted compliance REQUIREMENT to the DRAFT
 * SECTION that must address it (Eric: "get the sections we need aligned to our
 * drafts"). So a draft section can show "this answers L.3.2, technical" and the
 * compliance matrix shows which requirements each section covers (and which are
 * orphaned — covered by NO section yet).
 *
 * The bridge is the requirement's `category` + `section` ref (L.3.2, M.2, SOW
 * 3.x). category maps directly to a draft section type; the L/M/SOW prefix is a
 * secondary signal.
 */
import type { SectionType } from './types';

export interface ComplianceReq {
  id?: string;
  requirement: string;
  category: 'submission' | 'evaluation' | 'technical' | 'past_performance' | 'pricing' | 'admin' | 'other';
  section?: string;       // e.g. "L.3.2", "M.2", "C.5", "SOW 3.4"
}

// Which draft section a requirement category belongs to. Submission/admin/eval
// requirements aren't a single drafted section — they're cross-cutting
// (formatting, page limits, evaluation criteria) so they map to 'all'.
const CATEGORY_TO_SECTION: Record<ComplianceReq['category'], SectionType | 'all'> = {
  technical: 'technical',
  past_performance: 'past_performance',
  pricing: 'pricing',
  evaluation: 'all',      // M-factors apply across all sections
  submission: 'all',      // L-instructions / format apply across the whole package
  admin: 'all',
  other: 'all',
};

// Section-ref prefix → a hint when category is ambiguous (e.g. an L instruction
// that's really about the technical volume).
function sectionFromRef(ref?: string): SectionType | null {
  if (!ref) return null;
  const r = ref.toLowerCase();
  if (/\b(tech|technical|approach)\b/.test(r)) return 'technical';
  if (/\b(past|perf|cpars)\b/.test(r)) return 'past_performance';
  if (/\b(pric|cost|clin|sched\s*b)\b/.test(r)) return 'pricing';
  if (/\b(mgmt|management|staffing|key\s*personnel)\b/.test(r)) return 'management';
  return null;
}

export type AlignedSection = SectionType | 'all';

/** Map ONE requirement to its target draft section. */
export function alignRequirement(req: ComplianceReq): AlignedSection {
  const fromRef = sectionFromRef(req.section);
  if (fromRef) return fromRef;
  return CATEGORY_TO_SECTION[req.category] ?? 'all';
}

export interface AlignmentResult {
  // requirement id/text → target section
  byRequirement: Array<{ requirement: ComplianceReq; section: AlignedSection }>;
  // section → the requirements it must cover
  bySection: Record<string, ComplianceReq[]>;
  // requirements that map to a specific section (not 'all') — the trackable ones
  coverage: Record<string, { total: number }>;
}

/** Align a whole matrix: returns both directions + per-section counts. */
export function alignMatrix(requirements: ComplianceReq[]): AlignmentResult {
  const byRequirement: AlignmentResult['byRequirement'] = [];
  const bySection: Record<string, ComplianceReq[]> = {};
  for (const req of requirements) {
    const section = alignRequirement(req);
    byRequirement.push({ requirement: req, section });
    (bySection[section] ||= []).push(req);
  }
  const coverage: Record<string, { total: number }> = {};
  for (const [section, reqs] of Object.entries(bySection)) coverage[section] = { total: reqs.length };
  return { byRequirement, bySection, coverage };
}

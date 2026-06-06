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

export type ReqCategory = 'submission' | 'evaluation' | 'technical' | 'past_performance' | 'pricing' | 'admin' | 'other';

export interface ComplianceReq {
  id?: string;
  requirement: string;
  category: ReqCategory;
  section?: string;       // e.g. "L.3.2", "M.2", "C.5", "SOW 3.4"
}

/**
 * Normalize the model's category (which often ignores our enum and uses the
 * doc's own headings — "Project Objectives", "special_standards_of_
 * responsibility") back to one of our 7. Uses the category text + the
 * requirement text so we never lose a requirement to an unknown bucket (the QC
 * bug Eric caught: free-text categories broke alignment + the referee).
 */
const KNOWN_CATEGORIES: ReqCategory[] = ['submission', 'evaluation', 'technical', 'past_performance', 'pricing', 'admin', 'other'];
export function normalizeCategory(rawCategory: string | undefined, requirementText = ''): ReqCategory {
  const c = (rawCategory || '').toLowerCase();
  if (KNOWN_CATEGORIES.includes(c as ReqCategory)) return c as ReqCategory;
  // The category LABEL is the strongest hint (the model usually names the right
  // theme even if it's free-text); the requirement TEXT is the tiebreaker.
  const label = c;
  const text = requirementText.toLowerCase();
  const hay = `${label} ${text}`;

  // Past performance — check first (specific, easy to mis-route). NOTE: no
  // trailing \b on word-prefixes (past[ _-]?perform must match "performance").
  if (/(past[ _-]?perform|cpars|references?|prior[ _-]?contract|relevant[ _-]?experience|standards?[ _-]?of[ _-]?responsib|similar[ _-]?(work|project|contract))/.test(hay)) return 'past_performance';
  if (/\b(pric|cost|clin|fee|labor[ _-]?rate|schedule[ _-]?b|quote|invoice|dollar)\b/.test(hay)) return 'pricing';
  // Evaluation — the LABEL must signal it (a requirement about technical merit
  // is technical; only the M-factor framing is "evaluation").
  if (/(evaluat|award[ _-]?basis|rated|trade[ _-]?off|best[ _-]?value|section[ _-]?m|basis[ _-]?(for|of)[ _-]?award)/.test(label) ||
      /(government will evaluate|evaluation factor|will[ _-]?be[ _-]?evaluated|government will assess)/.test(text)) return 'evaluation';
  if (/\b(submit|submission|page[ _-]?limit|format|due|deadline|portal|copies|font|margin|\bvolume\b|section[ _-]?l|sf[ _-]?1449|no later than)\b/.test(hay)) return 'submission';
  if (/\b(cert|representation|reps?[ _-]?(and|&)?[ _-]?cert|registration|sam\.gov|clause|far[ _-]?52|\badmin\b)\b/.test(hay)) return 'admin';
  // Technical — the broad default for scope/approach/objectives/deliverables and
  // "the contractor shall <do work>" (an objective IS technical scope).
  if (/\b(technical|approach|methodolog|scope|\btask\b|deliverabl|sow|pws|objective|install|design|construct|provide|perform|restore|maintain|repair|service|replace|upgrade|furnish|complete[ _-]?the)\b/.test(hay)) return 'technical';
  return 'other';
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

// MANAGEMENT-volume content (Eric QC: key personnel, schedule, QC, safety,
// subcontracting plan, org chart were all collapsing to technical/all). These
// belong in the Management section regardless of the model's category. Detected
// from the requirement TEXT since "management" isn't one of the 7 categories.
const MANAGEMENT_TEXT = /\b(key[ _-]?personnel|resume|project[ _-]?manager|superintendent|staffing[ _-]?plan|organizational?[ _-]?chart|org[ _-]?chart|management[ _-]?(plan|approach|volume)|quality[ _-]?control[ _-]?plan|\bqc[ _-]?plan|safety[ _-]?plan|em[ _-]?385|subcontract(ing)?[ _-]?plan|project[ _-]?schedule|schedule[ _-]?with[ _-]?milestones|risk[ _-]?management|transition[ _-]?plan|labor[ _-]?categories)\b/i;

/** Map ONE requirement to its target draft section. */
export function alignRequirement(req: ComplianceReq): AlignedSection {
  // Section-ref hint wins (most explicit).
  const fromRef = sectionFromRef(req.section);
  if (fromRef) return fromRef;
  // Management content → Management section (text-based; overrides the broad
  // 'technical'/'all' category routing).
  if (MANAGEMENT_TEXT.test(req.requirement || '')) return 'management';
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

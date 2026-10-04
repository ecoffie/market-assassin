/**
 * capability_market_match — PLAIN-ENGLISH fixture set (ChatGPT submission blocker #3,
 * owner decision 2026-10-04).
 *
 * WHY: in ChatGPT developer mode the tool returned NO market for 6 of 8 ordinary small-business
 * descriptions (drone LiDAR, building automation, rugged servers, simulation manikins,
 * environmental remediation, translation) while charging 50 credits each. The Morehouse Ascend
 * fixtures (src/mcp/decision-chain/fixtures/morehouse-ascend) cover polished capability
 * statements from one cohort; this set covers how a beginner actually describes a business in
 * one sentence — who they are first, the work second.
 *
 * Each case states what is ACCEPTABLE, not one exact answer:
 *   - acceptAnchor: the selected anchor must contain at least one of these words (the activity).
 *   - acceptNaics:  at least one of the first 3 candidate NAICS must start with one of these.
 *   - tier:         'candidate' (a market must come back, unverified) | 'empty' (honest no-market)
 *                   | 'candidate_or_empty' (thin real market; either is honest).
 * No case names a company, so none can be 'grounded' — grounded requires SAM/award identity.
 *
 * NAICS families are the plain federal reading of the activity (e.g. roofing → 23816). Where
 * federal buying genuinely spreads across families, several prefixes are accepted.
 */
export interface CapabilityPlainEnglishCase {
  id: string;
  description: string;
  acceptAnchor: string[];
  acceptNaics: string[];
  tier: 'candidate' | 'empty' | 'candidate_or_empty';
  /** Words that must NEVER be the anchor (descriptors, not the work). */
  forbidAnchor?: string[];
  note?: string;
}

const DESCRIPTORS = ['small', 'family', 'veteran', 'person', 'firm', 'company', 'owned', 'does', 'doing', 'make', 'build'];

export const CAPABILITY_PLAIN_ENGLISH_CASES: CapabilityPlainEnglishCase[] = [
  // ── The 8 ChatGPT dev-mode prompts (2026-10-03) ──────────────────────────────────────────
  { id: 'cyber-fedramp', description: "We're a veteran-owned firm that provides cybersecurity assessments and FedRAMP readiness consulting.", acceptAnchor: ['cyber', 'fedramp'], acceptNaics: ['5415', '5416'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'drone-lidar', description: 'My company does drone-based LiDAR surveying and photogrammetry for infrastructure inspection.', acceptAnchor: ['lidar', 'photogrammetry', 'survey', 'drone'], acceptNaics: ['54137', '5413', '3364'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'building-automation', description: "We're a 20-person firm that does building automation and energy audits.", acceptAnchor: ['automation', 'energy'], acceptNaics: ['5612', '2382', '5413', '5416'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'rugged-edge-servers', description: 'We build ruggedized edge-computing servers for field military use.', acceptAnchor: ['edge', 'server', 'rugged', 'computing'], acceptNaics: ['3341', '5415', '4234', '3342'], tier: 'candidate_or_empty', forbidAnchor: DESCRIPTORS, note: 'Thin exact-phrase federal market; an honest empty is acceptable.' },
  { id: 'roofing', description: 'Family-owned commercial roofing and waterproofing contractor in Florida.', acceptAnchor: ['roofing', 'waterproofing'], acceptNaics: ['23816', '2362', '2381'], tier: 'candidate', forbidAnchor: [...DESCRIPTORS, 'florida', 'commercial'] },
  { id: 'medical-simulation', description: 'We make medical simulation mannequins and training software for clinicians.', acceptAnchor: ['simulation', 'manikin', 'mannequin'], acceptNaics: ['3391', '5419', '4234', '6114', '5415', '3345'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'env-remediation', description: 'Small engineering firm doing environmental remediation and groundwater sampling.', acceptAnchor: ['remediation', 'groundwater'], acceptNaics: ['5629', '5413', '5416'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'translation-call-center', description: 'We provide bilingual call-center and document-translation services.', acceptAnchor: ['translation', 'call'], acceptNaics: ['54193', '5614', '5415', '5611'], tier: 'candidate', forbidAnchor: [...DESCRIPTORS, 'bilingual'] },

  // ── Common small-business trades and services ────────────────────────────────────────────
  { id: 'janitorial', description: 'We do janitorial and custodial services for office buildings.', acceptAnchor: ['janitorial', 'custodial'], acceptNaics: ['5617'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'electrical', description: 'Licensed electrical contractor doing commercial wiring and lighting upgrades.', acceptAnchor: ['electrical', 'wiring', 'lighting'], acceptNaics: ['2382', '2362', '3351'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'security-guards', description: 'We provide armed and unarmed security guard services.', acceptAnchor: ['guard', 'security'], acceptNaics: ['5616'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'hvac', description: 'HVAC installation, repair and preventive maintenance for commercial buildings.', acceptAnchor: ['hvac', 'maintenance'], acceptNaics: ['2382', '5612', '8113'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'it-help-desk', description: 'Small business offering IT help desk and desktop support.', acceptAnchor: ['help desk', 'desktop'], acceptNaics: ['5415', '5182', '5416'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'catering', description: 'We cater events and provide food service for large groups.', acceptAnchor: ['cater', 'food'], acceptNaics: ['7223', '7225', '3119', '4244'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'grounds', description: 'Landscaping, lawn mowing and grounds maintenance.', acceptAnchor: ['landscaping', 'grounds', 'lawn', 'mowing'], acceptNaics: ['5617'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'trucking', description: 'We haul freight with a fleet of tractor-trailers.', acceptAnchor: ['freight', 'haul', 'trailer'], acceptNaics: ['4841', '4842', '4885', '4881'], tier: 'candidate_or_empty', forbidAnchor: DESCRIPTORS, note: 'A trucking business often never says "trucking"; freight is the activity word.' },
  { id: 'medical-staffing', description: 'Medical staffing agency placing nurses and allied health professionals.', acceptAnchor: ['staffing', 'nurse', 'health'], acceptNaics: ['5613', '6211', '6216', '6221', '5612'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'cnc-machining', description: 'We manufacture custom CNC machined metal parts.', acceptAnchor: ['machin', 'cnc', 'metal'], acceptNaics: ['3327', '3329', '3363', '3364', '3339', '3335'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'nepa', description: 'Environmental consulting and NEPA compliance studies.', acceptAnchor: ['environmental', 'nepa'], acceptNaics: ['5416', '5413', '5629', '5417'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'signs-printing', description: 'We design and print marketing materials, signs and banners.', acceptAnchor: ['sign', 'banner', 'print'], acceptNaics: ['3231', '5418', '3399', '5414'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'moving', description: 'Moving and relocation services for household goods.', acceptAnchor: ['moving', 'relocation', 'household'], acceptNaics: ['4842', '4884', '4885', '5311'], tier: 'candidate', forbidAnchor: DESCRIPTORS },
  { id: 'pest-control', description: 'Pest control and extermination services.', acceptAnchor: ['pest', 'extermination'], acceptNaics: ['5617'], tier: 'candidate', forbidAnchor: DESCRIPTORS },

  // ── Negatives: no activity in the text → an honest empty, never a guessed market ──────────
  { id: 'neg-outcomes', description: 'We help organizations achieve better outcomes through innovative solutions.', acceptAnchor: [], acceptNaics: [], tier: 'empty' },
  { id: 'neg-veteran-small', description: 'We are a veteran-owned small business.', acceptAnchor: [], acceptNaics: [], tier: 'empty' },
  { id: 'neg-family-quality', description: 'Family-owned company committed to quality and excellence.', acceptAnchor: [], acceptNaics: [], tier: 'empty' },
];

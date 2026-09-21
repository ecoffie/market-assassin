/**
 * DoD Critical Technology Areas (14) — research-derived NAICS + keyword anchors.
 * Source: funding-levers-research.md §1.3 / PRD-cta-filters.md.
 * Validate with DoD OSBP before NAPEX (Phase 2).
 */

export type CtaConfidence = 'high' | 'medium' | 'low';
export type CtaMatchSource = 'naics' | 'keyword_title' | 'keyword_description';

export interface CtaDefinition {
  cta_id: string;
  name: string;
  short_name: string;
  description: string;
  naics_anchors: string[];
  keywords: string[];
  priority_order: number;
}

export interface CtaTagResult {
  cta_id: string;
  confidence: CtaConfidence;
  match_source: CtaMatchSource;
}

export const CTA_DEFINITIONS: CtaDefinition[] = [
  {
    cta_id: 'trusted_ai',
    name: 'Trusted AI & Autonomy',
    short_name: 'Trusted AI',
    description: 'Artificial intelligence, machine learning, and autonomous systems for defense applications.',
    naics_anchors: ['541511', '541512', '541715'],
    keywords: [
      'artificial intelligence',
      'machine learning',
      'autonomy',
      'autonomous systems',
      'computer vision',
    ],
    priority_order: 1,
  },
  {
    cta_id: 'biotechnology',
    name: 'Biotechnology',
    short_name: 'Biotech',
    description: 'Biomanufacturing, synthetic biology, and biodefense-related life sciences.',
    naics_anchors: ['325414', '541714', '621511'],
    keywords: ['biotechnology', 'biomanufacturing', 'synthetic biology', 'biodefense'],
    priority_order: 2,
  },
  {
    cta_id: 'quantum',
    name: 'Quantum Science',
    short_name: 'Quantum',
    description: 'Quantum computing, sensing, and communications technologies.',
    naics_anchors: ['541713', '541715'],
    keywords: ['quantum computing', 'quantum sensing', 'quantum communications', 'quantum'],
    priority_order: 3,
  },
  {
    cta_id: 'microelectronics',
    name: 'Microelectronics',
    short_name: 'Microelectronics',
    description: 'Semiconductor design, fabrication, ASIC/FPGA, and chip supply chain.',
    naics_anchors: ['334413', '334419'],
    keywords: ['microelectronics', 'semiconductor', 'chip fabrication', 'asic', 'fpga'],
    priority_order: 4,
  },
  {
    cta_id: 'space_tech',
    name: 'Space Technology',
    short_name: 'Space',
    description: 'Satellites, launch vehicles, orbital systems, and spacecraft.',
    naics_anchors: ['336414', '336415', '541713'],
    keywords: ['satellite', 'launch vehicle', 'orbital', 'spacecraft', 'space technology'],
    priority_order: 5,
  },
  {
    cta_id: 'advanced_materials',
    name: 'Advanced Materials',
    short_name: 'Adv. Materials',
    description: 'Composites, nanomaterials, metamaterials, and novel material science.',
    naics_anchors: ['325', '331', '332'],
    keywords: ['advanced materials', 'composites', 'nanomaterials', 'metamaterials'],
    priority_order: 6,
  },
  {
    cta_id: 'hypersonics',
    name: 'Hypersonics',
    short_name: 'Hypersonics',
    description: 'Hypersonic flight, scramjet propulsion, and high-speed strike systems.',
    naics_anchors: ['336414', '541330', '541713'],
    keywords: ['hypersonic', 'scramjet', 'high-speed flight'],
    priority_order: 7,
  },
  {
    cta_id: 'directed_energy',
    name: 'Directed Energy',
    short_name: 'Directed Energy',
    description: 'High-energy lasers, microwave weapons, and directed-energy systems.',
    naics_anchors: ['333611', '334516', '541330'],
    keywords: ['directed energy', 'high energy laser', 'hel', 'microwave weapon'],
    priority_order: 8,
  },
  {
    cta_id: 'integrated_sensing_cyber',
    name: 'Integrated Sensing & Cyber',
    short_name: 'Cyber & Sensing',
    description: 'Cyber defense, ISR, RF sensing, and integrated sensing architectures.',
    naics_anchors: ['334290', '541512', '541519'],
    keywords: ['cybersecurity', 'cyber defense', 'isr', 'integrated sensing'],
    priority_order: 9,
  },
  {
    cta_id: 'futureg',
    name: 'Future-Generation Wireless (FutureG)',
    short_name: 'FutureG',
    description: '5G/6G, next-generation wireless, and millimeter-wave communications.',
    naics_anchors: ['334210', '334290', '517111'],
    keywords: ['5g', '6g', 'next-gen wireless', 'futureg', 'mmwave'],
    priority_order: 10,
  },
  {
    cta_id: 'renewable_energy',
    name: 'Renewable Energy Generation & Storage',
    short_name: 'Renewable Energy',
    description: 'Battery storage, grid storage, solar, wind, and renewable generation.',
    naics_anchors: ['221114', '221115', '335999'],
    keywords: ['renewable energy', 'battery storage', 'grid storage', 'solar', 'wind energy'],
    priority_order: 11,
  },
  {
    cta_id: 'advanced_computing',
    name: 'Advanced Computing & Software',
    short_name: 'Adv. Computing',
    description: 'HPC, edge computing, supercomputing, and advanced software systems.',
    naics_anchors: ['511210', '541511', '541512'],
    keywords: [
      'high-performance computing',
      'hpc',
      'edge computing',
      'supercomputing',
    ],
    priority_order: 12,
  },
  {
    cta_id: 'human_machine',
    name: 'Human-Machine Interfaces',
    short_name: 'HMI',
    description: 'AR/VR, neurotech, and human-machine interface systems.',
    naics_anchors: ['334118', '334290', '541330'],
    keywords: [
      'human-machine interface',
      'hmi',
      'augmented reality',
      'virtual reality',
      'neurotech',
    ],
    priority_order: 13,
  },
  {
    cta_id: 'network_systems',
    name: 'Integrated Network Systems-of-Systems',
    short_name: 'Net Systems',
    description: 'C4ISR, JADC2, battle management, and mesh network architectures.',
    naics_anchors: ['334290', '334418', '541330'],
    keywords: [
      'command and control',
      'c4isr',
      'jadc2',
      'battle management',
      'mesh network',
    ],
    priority_order: 14,
  },
];

export const CTA_BY_ID = new Map(CTA_DEFINITIONS.map((c) => [c.cta_id, c]));

function normalizeNaics(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function naicsMatchesAnchor(naics: string, anchor: string): boolean {
  const n = normalizeNaics(naics);
  const a = normalizeNaics(anchor);
  if (!n || !a) return false;
  if (n.startsWith(a)) return true;
  if (a.length >= 3 && n.startsWith(a.slice(0, 3))) return n.startsWith(a);
  return false;
}

// "Catch-all" 6-digit codes — real industries, but vendor-INDUSTRY buckets that
// cut across many capabilities, not capability proof. They tagged sprinklers as
// "Directed Energy" (334516/541330) and forestry as "AI" (541511/541715). Even
// though they're ≥5 digits, a match on these ALONE is NOT high-confidence — it
// needs a keyword to corroborate, same as a broad 3-digit anchor. Identified
// empirically (audit June 15: high active-opp volume and/or reused across ≥2 CTAs).
const WEAK_ANCHORS = new Set([
  '541330', // Engineering Services        (4 CTAs)
  '334290', // Other Communications Equip  (4 CTAs)
  '541512', // Computer Systems Design      (3 CTAs)
  '541713', // R&D Physical/Eng Sci         (3 CTAs)
  '541511', // Custom Computer Programming  (2 CTAs)
  '541715', // R&D Phys/Eng/Life Sci        (2 CTAs)
  '541519', // Other Computer Services      (IT catch-all)
  '336414', // Guided Missile/Space Vehicle (2 CTAs, dual-use)
  '334516', // Analytical Lab Instruments   (428 opps — lab/medical bucket)
  '334419', // Other Electronic Components  (595 opps — cables/connectors bucket)
]);

/** A specific (≥5-digit) anchor earns 'high' on NAICS alone — UNLESS it's a known
 *  catch-all bucket, which needs keyword corroboration like a broad anchor. */
function isStrongAnchor(anchor: string): boolean {
  const a = normalizeNaics(anchor);
  return a.length >= 5 && !WEAK_ANCHORS.has(a);
}

function haystackIncludesPhrase(haystack: string, phrase: string): boolean {
  const h = haystack.toLowerCase();
  const p = phrase.toLowerCase().trim();
  if (!p) return false;
  // Prefer word-boundary match for short tokens; phrases with spaces use substring.
  if (p.includes(' ')) return h.includes(p);
  if (p.length <= 3) return false;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(h);
}

export interface SamOpportunityForCta {
  notice_id: string;
  naics_code?: string | null;
  naics_codes?: string[] | null;
  title?: string | null;
  description?: string | null;
}

/** Rules-based CTA tagging for one SAM opportunity. */
export function tagOpportunityForCta(
  opp: SamOpportunityForCta,
  definitions: CtaDefinition[] = CTA_DEFINITIONS,
): CtaTagResult[] {
  const naicsValues = [
    opp.naics_code,
    ...(Array.isArray(opp.naics_codes) ? opp.naics_codes : []),
  ].filter(Boolean) as string[];

  const title = String(opp.title || '');
  const description = String(opp.description || '');
  const results = new Map<string, CtaTagResult>();

  // NAICS-anchor pass. A match on a SPECIFIC anchor (≥5 digits — a real 6-digit
  // industry like 334413 Semiconductors) earns 'high' on NAICS alone. A match on
  // a BROAD anchor (≤4 digits, e.g. 332 = all fabricated metal, 5413 consulting)
  // is too coarse to confidently mean the CTA — it tagged rifles (332994) as
  // "Advanced Materials." So a broad-anchor-only match is provisional 'low'; it's
  // promoted to 'high' below ONLY if a keyword also corroborates. (Audit: this
  // collapses advanced_materials from 5,445 false tags → ~the 13 real ones.)
  for (const cta of definitions) {
    for (const anchor of cta.naics_anchors) {
      if (naicsValues.some((n) => naicsMatchesAnchor(n, anchor))) {
        // Strong anchor (specific, non-catch-all) → 'high' on NAICS alone.
        // Broad (≤4-digit) OR catch-all 6-digit → provisional 'low'; needs a
        // keyword below to reach high/medium.
        results.set(cta.cta_id, {
          cta_id: cta.cta_id,
          confidence: isStrongAnchor(anchor) ? 'high' : 'low',
          match_source: 'naics',
        });
        break;
      }
    }
  }

  for (const cta of definitions) {
    const existing = results.get(cta.cta_id);
    if (existing?.confidence === 'high') continue;
    for (const kw of cta.keywords) {
      if (haystackIncludesPhrase(title, kw)) {
        // Keyword in title + a (broad) NAICS anchor already hit → strong signal:
        // promote to 'high'. Keyword alone → 'medium'. (match_source stays
        // 'keyword_title' — the DB CHECK constraint allows only the 3 base values;
        // `confidence` carries the corroboration level.)
        const naicsCorroborated = existing?.match_source === 'naics';
        results.set(cta.cta_id, {
          cta_id: cta.cta_id,
          confidence: naicsCorroborated ? 'high' : 'medium',
          match_source: 'keyword_title',
        });
        break;
      }
    }
  }

  for (const cta of definitions) {
    const existing = results.get(cta.cta_id);
    // Skip if already strong; a 'low' naics-only entry may still be corroborated
    // by a description keyword → promote it to 'medium'.
    if (existing && existing.confidence !== 'low') continue;
    for (const kw of cta.keywords) {
      if (haystackIncludesPhrase(description, kw)) {
        const naicsCorroborated = existing?.match_source === 'naics';
        results.set(cta.cta_id, {
          cta_id: cta.cta_id,
          confidence: naicsCorroborated ? 'medium' : 'low',
          match_source: 'keyword_description',
        });
        break;
      }
    }
  }

  return Array.from(results.values());
}

/** Badge display: show high/medium always; low only if no high/medium for that opp. */
export function filterTagsForDisplay(tags: CtaTagResult[]): CtaTagResult[] {
  const hasStrong = tags.some((t) => t.confidence === 'high' || t.confidence === 'medium');
  if (!hasStrong) return tags;
  return tags.filter((t) => t.confidence !== 'low');
}

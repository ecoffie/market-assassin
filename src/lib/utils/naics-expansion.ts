/**
 * NAICS Code Expansion Utility
 *
 * Handles:
 * 1. Expanding prefix codes (236 → all 236xxx codes)
 * 2. Parsing comma-separated input
 * 3. Deduplication and validation
 *
 * Common NAICS prefixes:
 * - 236xxx: Construction of Buildings
 * - 237xxx: Heavy and Civil Engineering Construction
 * - 238xxx: Specialty Trade Contractors
 * - 541xxx: Professional, Scientific, and Technical Services
 * - 518xxx: Data Processing, Hosting, and Related Services
 * - 561xxx: Administrative and Support Services
 */

// Comprehensive NAICS code database (6-digit codes)
// Organized by 2-digit sector and 3-digit subsector
const NAICS_DATABASE: Record<string, string[]> = {
  // CONSTRUCTION (23)
  '236': ['236115', '236116', '236117', '236118', '236210', '236220'],
  '237': ['237110', '237120', '237130', '237210', '237310', '237990'],
  '238': [
    '238110', '238120', '238130', '238140', '238150', '238160', '238170', '238190',
    '238210', '238220', '238290', '238310', '238320', '238330', '238340', '238350',
    '238390', '238910', '238990'
  ],

  // MANUFACTURING (31-33)
  '332': ['332111', '332112', '332119', '332211', '332212', '332213', '332214', '332216', '332311', '332312', '332313', '332321', '332322', '332323', '332410', '332420', '332431', '332439', '332510', '332613', '332618', '332710', '332721', '332722', '332811', '332812', '332813', '332911', '332912', '332913', '332919', '332991', '332992', '332993', '332994', '332996', '332999'],
  '334': ['334111', '334112', '334118', '334210', '334220', '334290', '334310', '334412', '334413', '334416', '334417', '334418', '334419', '334510', '334511', '334512', '334513', '334514', '334515', '334516', '334517', '334519', '334610', '334613', '334614'],
  '336': ['336111', '336112', '336120', '336211', '336212', '336213', '336214', '336310', '336320', '336330', '336340', '336350', '336360', '336370', '336390', '336411', '336412', '336413', '336414', '336415', '336419', '336510', '336611', '336612', '336991', '336992', '336999'],

  // INFORMATION (51)
  '517': ['517111', '517112', '517121', '517122', '517210', '517310', '517410', '517911', '517919'],
  '518': ['518210'],
  '519': ['519110', '519120', '519130', '519190', '519210', '519290'],

  // PROFESSIONAL SERVICES (54)
  '541': [
    '541110', '541120', '541191', '541199', '541211', '541213', '541214', '541219',
    '541310', '541320', '541330', '541340', '541350', '541360', '541370', '541380',
    '541410', '541420', '541430', '541490',
    '541511', '541512', '541513', '541519',
    '541611', '541612', '541613', '541614', '541618', '541620', '541690',
    '541711', '541712', '541713', '541714', '541715', '541720',
    '541810', '541820', '541830', '541840', '541850', '541860', '541870', '541890',
    '541910', '541921', '541922', '541930', '541940', '541990'
  ],

  // ADMIN & SUPPORT SERVICES (56)
  '561': [
    '561110', '561210', '561311', '561312', '561320', '561330', '561410', '561421', '561422', '561431', '561439',
    '561440', '561450', '561491', '561492', '561499',
    '561510', '561520', '561591', '561599',
    '561611', '561612', '561613', '561621', '561622',
    '561710', '561720', '561730', '561740', '561790',
    '561910', '561920', '561990'
  ],
  '562': ['562111', '562112', '562119', '562211', '562212', '562213', '562219', '562910', '562920', '562991', '562998'],

  // HEALTHCARE (62)
  '621': ['621111', '621112', '621210', '621310', '621320', '621330', '621340', '621391', '621399', '621410', '621420', '621491', '621492', '621493', '621498', '621511', '621512', '621610', '621910', '621991', '621999'],
  '622': ['622110', '622210', '622310'],
  '623': ['623110', '623210', '623220', '623311', '623312', '623990'],
  '624': ['624110', '624120', '624190', '624210', '624221', '624229', '624230', '624310', '624410'],

  // ACCOMMODATION & FOOD (72)
  '721': ['721110', '721120', '721191', '721199', '721211', '721214', '721310'],
  '722': ['722310', '722320', '722330', '722410', '722511', '722513', '722514', '722515'],

  // OTHER SERVICES (81)
  '811': ['811111', '811112', '811113', '811118', '811121', '811122', '811191', '811192', '811198', '811210', '811310', '811411', '811412', '811420', '811430', '811490'],
  '812': ['812111', '812112', '812113', '812191', '812199', '812210', '812220', '812310', '812320', '812331', '812332', '812910', '812921', '812922', '812930', '812990'],
};

// NAICS descriptions for common codes
const NAICS_DESCRIPTIONS: Record<string, string> = {
  // Construction
  '236': 'Construction of Buildings',
  '236115': 'New Single-Family Housing Construction (Except For-Sale Builders)',
  '236116': 'New Multifamily Housing Construction (Except For-Sale Builders)',
  '236117': 'New Housing For-Sale Builders',
  '236118': 'Residential Remodelers',
  '236210': 'Industrial Building Construction',
  '236220': 'Commercial and Institutional Building Construction',
  '237': 'Heavy and Civil Engineering Construction',
  '237110': 'Water and Sewer Line and Related Structures Construction',
  '237120': 'Oil and Gas Pipeline and Related Structures Construction',
  '237130': 'Power and Communication Line and Related Structures Construction',
  '237210': 'Land Subdivision',
  '237310': 'Highway, Street, and Bridge Construction',
  '237990': 'Other Heavy and Civil Engineering Construction',
  '238': 'Specialty Trade Contractors',
  '238110': 'Poured Concrete Foundation and Structure Contractors',
  '238120': 'Structural Steel and Precast Concrete Contractors',
  '238130': 'Framing Contractors',
  '238140': 'Masonry Contractors',
  '238150': 'Glass and Glazing Contractors',
  '238160': 'Roofing Contractors',
  '238170': 'Siding Contractors',
  '238190': 'Other Foundation, Structure, and Building Exterior Contractors',
  '238210': 'Electrical Contractors and Other Wiring Installation Contractors',
  '238220': 'Plumbing, Heating, and Air-Conditioning Contractors',
  '238290': 'Other Building Equipment Contractors',
  '238310': 'Drywall and Insulation Contractors',
  '238320': 'Painting and Wall Covering Contractors',
  '238330': 'Flooring Contractors',
  '238340': 'Tile and Terrazzo Contractors',
  '238350': 'Finish Carpentry Contractors',
  '238390': 'Other Building Finishing Contractors',
  '238910': 'Site Preparation Contractors',
  '238990': 'All Other Specialty Trade Contractors',

  // IT & Professional Services
  '541': 'Professional, Scientific, and Technical Services',
  '541511': 'Custom Computer Programming Services',
  '541512': 'Computer Systems Design Services',
  '541513': 'Computer Facilities Management Services',
  '541519': 'Other Computer Related Services',
  '541611': 'Administrative Management and General Management Consulting Services',
  '541612': 'Human Resources Consulting Services',
  '541613': 'Marketing Consulting Services',
  '541614': 'Process, Physical Distribution, and Logistics Consulting Services',
  '541618': 'Other Management Consulting Services',
  '541620': 'Environmental Consulting Services',
  '541690': 'Other Scientific and Technical Consulting Services',
  '541711': 'Research and Development in Biotechnology',
  '541712': 'Research and Development in the Physical, Engineering, and Life Sciences',
  '541715': 'R&D in Social Sciences and Humanities',
  '541720': 'Research and Development in the Social Sciences and Humanities',
  '541990': 'All Other Professional, Scientific, and Technical Services',

  // Admin Support
  '561': 'Administrative and Support Services',
  '561110': 'Office Administrative Services',
  '561210': 'Facilities Support Services',
  '561320': 'Temporary Help Services',
  '561330': 'Professional Employer Organizations',
  '561410': 'Document Preparation Services',
  '561421': 'Telephone Answering Services',
  '561422': 'Telemarketing Bureaus and Other Contact Centers',
  '561499': 'All Other Business Support Services',
  '561710': 'Exterminating and Pest Control Services',
  '561720': 'Janitorial Services',
  '561730': 'Landscaping Services',
  '561740': 'Carpet and Upholstery Cleaning Services',
  '561790': 'Other Services to Buildings and Dwellings',
  '561990': 'All Other Support Services',
};

/**
 * Parse comma-separated NAICS input and normalize
 */
export function parseNAICSInput(input: string): string[] {
  if (!input || !input.trim()) return [];

  return input
    .split(/[,;\s]+/)
    .map(code => code.trim())
    .filter(code => /^\d{2,6}$/.test(code)); // Only valid NAICS patterns (2-6 digits)
}

/**
 * Expand a NAICS code/prefix to all matching 6-digit codes
 *
 * Examples:
 * - "541511" → ["541511"] (already specific)
 * - "541" → ["541110", "541120", ..., "541990"] (all 541xxx codes)
 * - "23" → all construction codes (236xxx, 237xxx, 238xxx)
 */
export function expandNAICSCode(code: string): string[] {
  const trimmed = code.trim();

  // If already 6 digits, return as-is
  if (trimmed.length === 6) {
    return [trimmed];
  }

  // If 5 digits, find matching 6-digit codes
  if (trimmed.length === 5) {
    const results: string[] = [];
    for (const [prefix, codes] of Object.entries(NAICS_DATABASE)) {
      for (const fullCode of codes) {
        if (fullCode.startsWith(trimmed)) {
          results.push(fullCode);
        }
      }
    }
    return results.length > 0 ? results : [trimmed]; // Return as-is if no expansion found
  }

  // If 4 digits, find matching codes
  if (trimmed.length === 4) {
    const results: string[] = [];
    for (const [prefix, codes] of Object.entries(NAICS_DATABASE)) {
      if (prefix.startsWith(trimmed) || trimmed.startsWith(prefix.slice(0, 3))) {
        for (const fullCode of codes) {
          if (fullCode.startsWith(trimmed)) {
            results.push(fullCode);
          }
        }
      }
    }
    return results.length > 0 ? results : [trimmed];
  }

  // If 3 digits (subsector), get all codes for that subsector
  if (trimmed.length === 3) {
    const codes = NAICS_DATABASE[trimmed];
    if (codes) {
      return codes;
    }
    // Try to find partial matches
    const results: string[] = [];
    for (const [prefix, prefixCodes] of Object.entries(NAICS_DATABASE)) {
      if (prefix.startsWith(trimmed)) {
        results.push(...prefixCodes);
      }
    }
    return results.length > 0 ? results : [trimmed];
  }

  // If 2 digits (sector), get all subsector codes
  if (trimmed.length === 2) {
    const results: string[] = [];
    for (const [prefix, codes] of Object.entries(NAICS_DATABASE)) {
      if (prefix.startsWith(trimmed)) {
        results.push(...codes);
      }
    }
    return results.length > 0 ? results : [trimmed];
  }

  return [trimmed];
}

/**
 * Expand multiple NAICS codes/prefixes
 */
export function expandNAICSCodes(codes: string[]): string[] {
  const expanded = new Set<string>();

  for (const code of codes) {
    const expansions = expandNAICSCode(code);
    for (const exp of expansions) {
      expanded.add(exp);
    }
  }

  return Array.from(expanded).sort();
}

/**
 * Get NAICS description
 */
export function getNAICSDescription(code: string): string | undefined {
  return NAICS_DESCRIPTIONS[code];
}

/**
 * Validate if a code is a valid NAICS format
 */
export function isValidNAICSFormat(code: string): boolean {
  return /^\d{2,6}$/.test(code.trim());
}

/**
 * Get all known NAICS codes
 */
export function getAllKnownNAICSCodes(): string[] {
  const all = new Set<string>();
  for (const codes of Object.values(NAICS_DATABASE)) {
    for (const code of codes) {
      all.add(code);
    }
  }
  return Array.from(all).sort();
}

/**
 * Get NAICS codes grouped by sector for UI display
 */
export function getNAICSSectors(): { sector: string; name: string; subsectors: { code: string; name: string; count: number }[] }[] {
  return [
    {
      sector: '23',
      name: 'Construction',
      subsectors: [
        { code: '236', name: 'Construction of Buildings', count: NAICS_DATABASE['236']?.length || 0 },
        { code: '237', name: 'Heavy and Civil Engineering', count: NAICS_DATABASE['237']?.length || 0 },
        { code: '238', name: 'Specialty Trade Contractors', count: NAICS_DATABASE['238']?.length || 0 },
      ]
    },
    {
      sector: '54',
      name: 'Professional Services',
      subsectors: [
        { code: '541', name: 'Professional, Scientific, Technical', count: NAICS_DATABASE['541']?.length || 0 },
      ]
    },
    {
      sector: '56',
      name: 'Administrative & Support',
      subsectors: [
        { code: '561', name: 'Administrative Support', count: NAICS_DATABASE['561']?.length || 0 },
        { code: '562', name: 'Waste Management', count: NAICS_DATABASE['562']?.length || 0 },
      ]
    },
    {
      sector: '51',
      name: 'Information',
      subsectors: [
        { code: '517', name: 'Telecommunications', count: NAICS_DATABASE['517']?.length || 0 },
        { code: '518', name: 'Data Processing & Hosting', count: NAICS_DATABASE['518']?.length || 0 },
        { code: '519', name: 'Other Information Services', count: NAICS_DATABASE['519']?.length || 0 },
      ]
    },
  ];
}

/**
 * Smart NAICS detection - understands both specific codes and prefixes
 * Returns structured data about the input
 */
export interface NAICSAnalysis {
  input: string;
  isPrefix: boolean;
  expandedCodes: string[];
  description?: string;
  sector?: string;
}

export function analyzeNAICSInput(input: string): NAICSAnalysis[] {
  const codes = parseNAICSInput(input);

  return codes.map(code => {
    const expanded = expandNAICSCode(code);
    const isPrefix = expanded.length > 1 || code.length < 6;

    return {
      input: code,
      isPrefix,
      expandedCodes: expanded,
      description: getNAICSDescription(code),
      sector: code.slice(0, 2),
    };
  });
}

/**
 * Industry Presets Configuration
 *
 * Shared configuration for industry categories and their NAICS codes.
 * Used by preferences UI and briefing generators.
 */

export interface IndustryPreset {
  label: string;      // Display label with emoji
  name: string;       // Clean name without emoji
  codes: string[];    // NAICS codes for this industry
  description: string;
}

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    label: 'Construction',
    name: 'Construction',
    codes: ['236', '237', '238'],
    description: 'Building, heavy civil, specialty trades'
  },
  {
    label: 'IT Services',
    name: 'IT Services',
    codes: ['541511', '541512', '541513', '541519'],
    description: 'Software, systems design, data processing'
  },
  {
    label: 'Cybersecurity',
    name: 'Cybersecurity',
    codes: ['541512', '541519', '518210'],
    description: 'Security systems, data protection'
  },
  {
    label: 'Professional Services',
    name: 'Professional Services',
    codes: ['541'],
    description: 'Consulting, engineering, R&D'
  },
  {
    label: 'Healthcare',
    name: 'Healthcare',
    codes: ['621', '622', '623'],
    description: 'Medical, hospitals, nursing care'
  },
  {
    label: 'Logistics & Supply',
    name: 'Logistics & Supply',
    codes: ['493', '484', '488'],
    description: 'Warehousing, trucking, transportation'
  },
  {
    label: 'Facilities & Maintenance',
    name: 'Facilities & Maintenance',
    codes: ['561210', '561720', '561730'],
    description: 'Janitorial, landscaping, building services'
  },
  {
    label: 'Training & Education',
    name: 'Training & Education',
    codes: ['611430', '611420', '611710'],
    description: 'Professional training, educational services'
  },
];

/**
 * Get industry preset by name
 */
export function getIndustryPreset(name: string): IndustryPreset | undefined {
  return INDUSTRY_PRESETS.find(
    p => p.name === name || p.label === name || p.label.includes(name)
  );
}

/**
 * Get NAICS codes for an industry name
 */
export function getIndustryNaicsCodes(name: string): string[] {
  const preset = getIndustryPreset(name);
  return preset?.codes || [];
}

/**
 * Prioritize NAICS codes by primary industry
 *
 * @param naicsCodes - All user NAICS codes
 * @param primaryIndustry - Primary industry name
 * @returns Reordered NAICS codes with primary industry codes first
 */
export function prioritizeNaicsByIndustry(
  naicsCodes: string[],
  primaryIndustry: string | null | undefined
): string[] {
  if (!primaryIndustry || naicsCodes.length === 0) {
    return naicsCodes;
  }

  const primaryCodes = getIndustryNaicsCodes(primaryIndustry);
  if (primaryCodes.length === 0) {
    return naicsCodes;
  }

  // Split into primary and secondary codes
  const primaryMatches: string[] = [];
  const secondary: string[] = [];

  for (const code of naicsCodes) {
    // Check if code matches any primary industry code (prefix match)
    const isPrimary = primaryCodes.some(primaryCode =>
      code.startsWith(primaryCode) || primaryCode.startsWith(code)
    );

    if (isPrimary) {
      primaryMatches.push(code);
    } else {
      secondary.push(code);
    }
  }

  // Return primary codes first, then secondary
  return [...primaryMatches, ...secondary];
}

/**
 * Common 6-digit NAICS codes for 3-digit prefixes
 * USASpending API requires full 6-digit codes - doesn't accept prefixes
 */
const NAICS_EXPANSION_MAP: Record<string, string[]> = {
  // Construction (236, 237, 238)
  '236': ['236115', '236116', '236118', '236210', '236220'],  // Building construction
  '237': ['237110', '237120', '237130', '237210', '237310', '237990'],  // Heavy/civil construction
  '238': ['238110', '238120', '238130', '238140', '238150', '238160', '238170', '238190', '238210', '238220', '238290', '238310', '238320', '238330', '238340', '238350', '238390', '238910', '238990'],  // Specialty trade contractors

  // Professional Services (541)
  '541': ['541110', '541211', '541310', '541330', '541511', '541512', '541513', '541519', '541611', '541612', '541613', '541614', '541618', '541620', '541690', '541710', '541715', '541720', '541810', '541820', '541830', '541840', '541850', '541860', '541870', '541890', '541910', '541990'],

  // Healthcare (621, 622, 623)
  '621': ['621111', '621112', '621210', '621310', '621320', '621330', '621340', '621391', '621399', '621410', '621420', '621491', '621492', '621493', '621498', '621511', '621512', '621610', '621910', '621991', '621999'],
  '622': ['622110', '622210', '622310'],
  '623': ['623110', '623210', '623220', '623311', '623312', '623990'],

  // Logistics/Warehousing (493, 484, 488)
  '493': ['493110', '493120', '493130', '493190'],
  '484': ['484110', '484121', '484122', '484210', '484220', '484230'],
  '488': ['488111', '488119', '488190', '488210', '488310', '488320', '488330', '488390', '488410', '488490', '488510', '488991', '488999'],
};

/**
 * Expand short NAICS codes (3-4 digits) to full 6-digit codes
 *
 * USASpending API requires full 6-digit NAICS codes and returns null for prefixes.
 * This function expands common prefixes to their most common full codes.
 *
 * @param naicsCodes - Array of NAICS codes (may include 3-4 digit prefixes)
 * @returns Array of 6-digit NAICS codes
 */
export function expandNaicsPrefixes(naicsCodes: string[]): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();

  for (const code of naicsCodes) {
    const trimmed = code.trim();

    // Already 6 digits - use as-is
    if (trimmed.length >= 6) {
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        expanded.push(trimmed);
      }
      continue;
    }

    // Check if we have an expansion for this prefix
    const expansions = NAICS_EXPANSION_MAP[trimmed];
    if (expansions && expansions.length > 0) {
      for (const fullCode of expansions) {
        if (!seen.has(fullCode)) {
          seen.add(fullCode);
          expanded.push(fullCode);
        }
      }
    } else {
      // No expansion map - pad with zeros (e.g., "5415" -> "541500")
      const padded = trimmed.padEnd(6, '0');
      if (!seen.has(padded)) {
        seen.add(padded);
        expanded.push(padded);
      }
    }
  }

  return expanded;
}

/**
 * Check if a NAICS code is a prefix (less than 6 digits)
 */
export function isNaicsPrefix(code: string): boolean {
  return code.trim().length < 6;
}

/**
 * Check if any NAICS codes in the array need expansion
 */
export function hasNaicsPrefixes(naicsCodes: string[]): boolean {
  return naicsCodes.some(code => isNaicsPrefix(code));
}

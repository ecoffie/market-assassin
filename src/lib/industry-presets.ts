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

// Pain Points Database Utilities
import agencyPainPointsData from '@/data/agency-pain-points.json';
import componentAgencyRulesData from '@/data/component-agency-rules.json';
import usaceOfficePainPointsData from '@/data/usace-office-specific-pain-points.json';

interface PainPointsDatabase {
  agencies: Record<string, {
    painPoints: string[];
  }>;
}

interface ComponentAgencyRules {
  metadata?: any;
  departmentRules?: Record<string, any>;
  componentAgencies?: Record<string, {
    parentAgency: string;
    altNames?: string[];
  }>;
}

const painPointsDB = agencyPainPointsData as PainPointsDatabase;
const componentAgencyRules = componentAgencyRulesData as any;
const usaceOfficePainPoints = usaceOfficePainPointsData as any;

/**
 * Clean and normalize NAICS code for matching
 */
function normalizeNAICSCode(naicsCode: string): { codes: string[]; sector: string; prefix: string } {
  let cleanCode = naicsCode.trim();

  // Handle codes ending in 0000 (sector-level like "810000")
  if (cleanCode.length === 6 && cleanCode.endsWith('0000')) {
    const sector = cleanCode.substring(0, 2);
    return { codes: [sector], sector, prefix: sector };
  }

  // Handle codes ending in 000 (subsector-level like "811000")
  if (cleanCode.length === 6 && cleanCode.endsWith('000')) {
    const prefix = cleanCode.substring(0, 3);
    const sector = cleanCode.substring(0, 2);
    return { codes: [prefix, sector], sector, prefix };
  }

  // Handle 3-digit codes
  if (cleanCode.length === 3) {
    const sector = cleanCode.substring(0, 2);
    return { codes: [cleanCode, sector], sector, prefix: cleanCode };
  }

  // Handle 2-digit codes
  if (cleanCode.length === 2) {
    return { codes: [cleanCode], sector: cleanCode, prefix: cleanCode };
  }

  // Handle full 6-digit codes
  const sector = cleanCode.substring(0, 2);
  const prefix = cleanCode.substring(0, 3);
  return { codes: [cleanCode, prefix, sector], sector, prefix };
}

/**
 * Get pain points for a specific agency, with optional command-level override
 * @param agencyName - The agency name (e.g., "Department of the Navy")
 * @param command - Optional command name for more specific matching (e.g., "NAVFAC", "NAVSEA")
 */
export function getPainPointsForAgency(agencyName: string, command?: string | null): string[] {
  // If a specific command is provided, try that first (command-level pain points)
  if (command) {
    // Direct command match (e.g., "NAVFAC", "NAVSEA", "Army Materiel Command")
    if (painPointsDB.agencies[command]) {
      return painPointsDB.agencies[command].painPoints;
    }

    // Check for partial matches for commands
    for (const [dbAgencyName, data] of Object.entries(painPointsDB.agencies)) {
      if (command.includes(dbAgencyName) || dbAgencyName.includes(command)) {
        return data.painPoints;
      }
    }
  }

  // Direct agency name match
  if (painPointsDB.agencies[agencyName]) {
    return painPointsDB.agencies[agencyName].painPoints;
  }

  // Try to find parent agency if this is a component agency
  const componentInfo = (componentAgencyRules as any)?.componentAgencies?.[agencyName];
  if (componentInfo?.parentAgency && painPointsDB.agencies[componentInfo.parentAgency]) {
    return painPointsDB.agencies[componentInfo.parentAgency].painPoints;
  }

  // Check for partial matches (e.g., "Department of Defense" in agency name)
  for (const [dbAgencyName, data] of Object.entries(painPointsDB.agencies)) {
    if (agencyName.includes(dbAgencyName) || dbAgencyName.includes(agencyName)) {
      return data.painPoints;
    }
  }

  // Check USACE-specific pain points
  if (agencyName.includes('Army') && agencyName.includes('Engineer')) {
    const usacePainPoints = usaceOfficePainPoints.offices?.[agencyName];
    if (usacePainPoints) {
      return usacePainPoints.painPoints || [];
    }
  }

  return [];
}

/**
 * Get pain points for a command-level office (for FPDS data)
 * This provides more specific pain points for DoD commands like NAVFAC, NAVSEA, etc.
 */
export function getPainPointsForCommand(
  contractingOffice: string,
  subAgency: string,
  parentAgency: string,
  command?: string | null
): { painPoints: string[]; source: string } {
  // Priority 1: Use specific command if provided (most specific)
  if (command) {
    const commandPainPoints = getPainPointsForAgency(command);
    if (commandPainPoints.length > 0) {
      return { painPoints: commandPainPoints, source: command };
    }
  }

  // Priority 2: Try to detect command from contracting office name
  const detectedCommand = detectCommandFromOfficeName(contractingOffice);
  if (detectedCommand) {
    const detectedPainPoints = getPainPointsForAgency(detectedCommand);
    if (detectedPainPoints.length > 0) {
      return { painPoints: detectedPainPoints, source: detectedCommand };
    }
  }

  // Priority 3: Use sub-agency (e.g., "Department of the Navy")
  const subAgencyPainPoints = getPainPointsForAgency(subAgency);
  if (subAgencyPainPoints.length > 0) {
    return { painPoints: subAgencyPainPoints, source: subAgency };
  }

  // Priority 4: Use parent agency (e.g., "Department of Defense")
  const parentPainPoints = getPainPointsForAgency(parentAgency);
  if (parentPainPoints.length > 0) {
    return { painPoints: parentPainPoints, source: parentAgency };
  }

  return { painPoints: [], source: '' };
}

/**
 * Detect command from contracting office name (backup detection)
 */
function detectCommandFromOfficeName(officeName: string): string | null {
  const nameUpper = officeName.toUpperCase();

  // Navy Commands
  if (nameUpper.includes('NAVFAC') || nameUpper.includes('NAVAL FACILITIES')) return 'NAVFAC';
  if (nameUpper.includes('NAVSEA') || nameUpper.includes('NAVAL SEA SYSTEMS')) return 'NAVSEA';
  if (nameUpper.includes('NAVAIR') || nameUpper.includes('NAVAL AIR SYSTEMS')) return 'NAVAIR';
  if (nameUpper.includes('NAVWAR') || nameUpper.includes('SPAWAR')) return 'NAVWAR';
  if (nameUpper.includes('MARINE CORPS SYSTEMS')) return 'Marine Corps Systems Command';

  // Army Commands
  if (nameUpper.includes('USACE') || nameUpper.includes('CORPS OF ENGINEERS')) return 'USACE';
  if (nameUpper.includes('ARMY CONTRACTING COMMAND') || nameUpper.includes('ACC-')) return 'Army Contracting Command';
  if (nameUpper.includes('ARMY MATERIEL') || nameUpper.includes('TACOM') || nameUpper.includes('CECOM') || nameUpper.includes('AMCOM')) return 'Army Materiel Command';
  if (nameUpper.includes('MICC') || nameUpper.includes('MISSION AND INSTALLATION')) return 'Army Contracting Command';

  // Air Force Commands
  if (nameUpper.includes('AFMC') || nameUpper.includes('AIR FORCE MATERIEL')) return 'Air Force Materiel Command';
  if (nameUpper.includes('AFSC') || nameUpper.includes('AIR FORCE SUSTAINMENT')) return 'Air Force Sustainment Center';
  if (nameUpper.includes('SPACE SYSTEMS')) return 'Space Systems Command';

  // Defense Agencies
  if (nameUpper.includes('DLA') || nameUpper.includes('DEFENSE LOGISTICS')) return 'Defense Logistics Agency';
  if (nameUpper.includes('DISA') || nameUpper.includes('DEFENSE INFORMATION SYSTEMS')) return 'Defense Information Systems Agency';
  if (nameUpper.includes('DCMA') || nameUpper.includes('DEFENSE CONTRACT MANAGEMENT')) return 'Defense Contract Management Agency';
  if (nameUpper.includes('MDA') || nameUpper.includes('MISSILE DEFENSE')) return 'Missile Defense Agency';
  if (nameUpper.includes('DARPA')) return 'DARPA';
  if (nameUpper.includes('DHA') || nameUpper.includes('DEFENSE HEALTH')) return 'Defense Health Agency';

  return null;
}

/**
 * Get all agencies with their pain points
 */
export function getAllAgenciesWithPainPoints(): Array<{
  agency: string;
  painPoints: string[];
  painPointCount: number;
}> {
  return Object.entries(painPointsDB.agencies).map(([agency, data]) => ({
    agency,
    painPoints: data.painPoints,
    painPointCount: data.painPoints.length
  }));
}

/**
 * Match agencies by pain point keywords
 */
export function findAgenciesByPainPoint(keyword: string): Array<{
  agency: string;
  matchingPainPoints: string[];
}> {
  const results: Array<{ agency: string; matchingPainPoints: string[] }> = [];
  const lowerKeyword = keyword.toLowerCase();

  for (const [agency, data] of Object.entries(painPointsDB.agencies)) {
    const matchingPainPoints = data.painPoints.filter(pp =>
      pp.toLowerCase().includes(lowerKeyword)
    );

    if (matchingPainPoints.length > 0) {
      results.push({
        agency,
        matchingPainPoints
      });
    }
  }

  return results;
}

/**
 * Get similar agencies based on shared pain points
 */
export function getSimilarAgencies(agencyName: string, limit: number = 5): Array<{
  agency: string;
  similarity: number;
  sharedPainPoints: string[];
}> {
  const targetPainPoints = getPainPointsForAgency(agencyName);
  if (targetPainPoints.length === 0) return [];

  const similarities: Array<{
    agency: string;
    similarity: number;
    sharedPainPoints: string[];
  }> = [];

  for (const [otherAgency, data] of Object.entries(painPointsDB.agencies)) {
    if (otherAgency === agencyName) continue;

    const sharedPainPoints = data.painPoints.filter(pp =>
      targetPainPoints.some(targetPP =>
        pp.toLowerCase().includes(targetPP.toLowerCase().split(' ').slice(0, 3).join(' ')) ||
        targetPP.toLowerCase().includes(pp.toLowerCase().split(' ').slice(0, 3).join(' '))
      )
    );

    if (sharedPainPoints.length > 0) {
      const similarity = sharedPainPoints.length / Math.max(targetPainPoints.length, data.painPoints.length);
      similarities.push({
        agency: otherAgency,
        similarity,
        sharedPainPoints
      });
    }
  }

  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Get parent agency for a component agency
 */
export function getParentAgency(componentAgency: string): string | null {
  const componentInfo = (componentAgencyRules as any)?.componentAgencies?.[componentAgency];
  return componentInfo?.parentAgency || null;
}

/**
 * Get all component agencies for a parent agency
 */
export function getComponentAgencies(parentAgency: string): string[] {
  if (!componentAgencyRules?.componentAgencies) return [];
  return Object.entries(componentAgencyRules.componentAgencies)
    .filter(([_, info]: [string, any]) => info?.parentAgency === parentAgency)
    .map(([component, _]) => component);
}

/**
 * Extract FY2026 NDAA-specific pain points
 */
export function getNDAAPainPoints(agencyName: string): string[] {
  const allPainPoints = getPainPointsForAgency(agencyName);
  return allPainPoints.filter(pp => pp.includes('FY2026 NDAA'));
}

/**
 * Categorize pain points by type
 */
export function categorizePainPoints(painPoints: string[]): {
  cybersecurity: string[];
  infrastructure: string[];
  modernization: string[];
  compliance: string[];
  other: string[];
} {
  const categories = {
    cybersecurity: [] as string[],
    infrastructure: [] as string[],
    modernization: [] as string[],
    compliance: [] as string[],
    other: [] as string[]
  };

  for (const pp of painPoints) {
    const lower = pp.toLowerCase();
    if (lower.includes('cyber') || lower.includes('security') || lower.includes('zero trust')) {
      categories.cybersecurity.push(pp);
    } else if (lower.includes('infrastructure') || lower.includes('facility') || lower.includes('building')) {
      categories.infrastructure.push(pp);
    } else if (lower.includes('moderniz') || lower.includes('cloud') || lower.includes('digital')) {
      categories.modernization.push(pp);
    } else if (lower.includes('compliance') || lower.includes('ndaa') || lower.includes('regulation')) {
      categories.compliance.push(pp);
    } else {
      categories.other.push(pp);
    }
  }

  return categories;
}

/**
 * Generate agency needs report from pain points, matched to user capabilities
 */
export function generateAgencyNeeds(
  selectedAgencies: string[],
  inputs: {
    naicsCode?: string;
    businessType?: string;
    goodsOrServices?: string;
  }
): Array<{
  agency: string;
  requirement: string;
  capabilityMatch: string;
  positioning: string;
}> {
  const needs: Array<{
    agency: string;
    requirement: string;
    capabilityMatch: string;
    positioning: string;
  }> = [];

  // NAICS code to capability keywords mapping
  const naicsToCapabilities: Record<string, string[]> = {
    // 2-digit sector codes
    '23': ['construction', 'building construction', 'heavy construction', 'specialty trade contractors'],
    '54': ['professional services', 'consulting', 'engineering', 'technical services'],
    '56': ['administrative services', 'facility support services', 'security services'],
    '81': ['repair and maintenance', 'equipment maintenance', 'personal services', 'civic organizations'],
    // 3-digit subsector codes
    '541': ['professional services', 'consulting', 'engineering', 'technical services'],
    '541330': ['engineering services', 'professional engineering', 'engineering consulting'],
    '541511': ['custom software development', 'computer programming', 'software services'],
    '541512': ['computer systems design', 'IT services', 'systems integration'],
    '236': ['construction', 'building construction'],
    '237': ['heavy construction', 'infrastructure construction'],
    '238': ['specialty trade contractors', 'construction trades'],
    '561': ['administrative services', 'facility support services'],
    '518': ['data processing', 'hosting', 'cloud services'],
    '811': ['repair and maintenance', 'equipment maintenance'],
    '812': ['personal and laundry services'],
    '813': ['civic and social organizations', 'membership associations'],
  };

  // Pain point keywords mapped to applicable NAICS prefixes and capability descriptions
  const painPointToCapability: Record<string, { naicsPrefixes: string[]; capability: string }> = {
    // IT and Technology (541 only)
    'cyber': { naicsPrefixes: ['541'], capability: 'Cybersecurity expertise and compliance capabilities' },
    'security': { naicsPrefixes: ['541'], capability: 'Security solutions and risk management' },
    'cloud': { naicsPrefixes: ['541', '518'], capability: 'Cloud migration and cloud services' },
    'software': { naicsPrefixes: ['541'], capability: 'Software development and IT services' },
    'data': { naicsPrefixes: ['541', '518'], capability: 'Data management and analytics capabilities' },
    'ai': { naicsPrefixes: ['541'], capability: 'AI/ML solutions and automation' },
    '5g': { naicsPrefixes: ['541'], capability: '5G and advanced communications services' },

    // Construction and Infrastructure (236, 237, 238)
    'infrastructure': { naicsPrefixes: ['236', '237', '238', '541'], capability: 'Infrastructure development and management' },
    'construction': { naicsPrefixes: ['236', '237', '238'], capability: 'Construction and facility management services' },
    'building': { naicsPrefixes: ['236', '238'], capability: 'Building construction and renovation services' },
    'facility': { naicsPrefixes: ['236', '238', '561'], capability: 'Facility construction and management services' },
    'base infrastructure': { naicsPrefixes: ['236', '237', '238'], capability: 'Base infrastructure and facilities construction' },
    'renovation': { naicsPrefixes: ['236', '238'], capability: 'Building renovation and modernization' },
    'hvac': { naicsPrefixes: ['238'], capability: 'HVAC and mechanical systems' },

    // Engineering (applies to construction engineering and professional engineering)
    'engineering': { naicsPrefixes: ['541', '236', '237'], capability: 'Engineering and technical services' },

    // Maintenance and Operations (81, 811, 561)
    'maintenance': { naicsPrefixes: ['81', '811', '238', '561'], capability: 'Maintenance and support services' },

    // Energy and Sustainability (applies broadly)
    'energy': { naicsPrefixes: ['236', '237', '238', '541'], capability: 'Energy efficiency and renewable energy solutions' },
    'climate': { naicsPrefixes: ['236', '237', '238', '541'], capability: 'Climate resilience and sustainability services' },
    'renewable': { naicsPrefixes: ['236', '237', '238'], capability: 'Renewable energy construction and installation' },

    // Specialized (very specific NAICS)
    'aircraft': { naicsPrefixes: ['336', '541'], capability: 'Aircraft systems and aerospace engineering' },
    'autonomous': { naicsPrefixes: ['541', '336'], capability: 'Autonomous systems and unmanned vehicles' },
    'uas': { naicsPrefixes: ['541', '336'], capability: 'Unmanned aerial systems development' },
    'training': { naicsPrefixes: ['541', '611'], capability: 'Training and simulation services' },
    'simulation': { naicsPrefixes: ['541'], capability: 'Simulation and modeling services' },
  };

  // Get capabilities from NAICS code using normalized matching
  const userCapabilities: string[] = [];
  const normalizedNaics = inputs.naicsCode ? normalizeNAICSCode(inputs.naicsCode) : null;
  const userNaicsPrefix = normalizedNaics?.prefix || '';
  const userNaicsSector = normalizedNaics?.sector || '';

  if (inputs.naicsCode && normalizedNaics) {
    // Check all normalized codes for capability matches
    for (const code of normalizedNaics.codes) {
      if (naicsToCapabilities[code]) {
        userCapabilities.push(...naicsToCapabilities[code]);
      }
    }
    // Also check sector and prefix directly
    if (naicsToCapabilities[userNaicsSector]) {
      userCapabilities.push(...naicsToCapabilities[userNaicsSector]);
    }
    if (naicsToCapabilities[userNaicsPrefix] && userNaicsPrefix !== userNaicsSector) {
      userCapabilities.push(...naicsToCapabilities[userNaicsPrefix]);
    }
  }

  // Add business type capabilities
  if (inputs.businessType) {
    userCapabilities.push(`${inputs.businessType.toLowerCase()} business`);
  }

  // Process each selected agency
  for (const agencyName of selectedAgencies) {
    const painPoints = getPainPointsForAgency(agencyName);

    for (const painPoint of painPoints) {
      const lowerPainPoint = painPoint.toLowerCase();

      // Determine capability match
      let capabilityMatch = 'General capabilities align with agency needs';
      let matchStrength = 0;

      // Check if pain point matches user capabilities
      for (const capability of userCapabilities) {
        if (lowerPainPoint.includes(capability) || capability.includes(lowerPainPoint)) {
          matchStrength++;
        }
      }

      // Check pain point keywords - but ONLY if they're applicable to user's NAICS
      for (const [keyword, config] of Object.entries(painPointToCapability)) {
        if (lowerPainPoint.includes(keyword)) {
          // Check if this keyword is applicable to the user's NAICS (sector or prefix)
          const isApplicable = !userNaicsSector ||
            config.naicsPrefixes.includes(userNaicsSector) ||
            config.naicsPrefixes.includes(userNaicsPrefix);

          if (isApplicable) {
            capabilityMatch = config.capability;
            matchStrength++;
            break;
          }
        }
      }

      // Generate positioning statement
      let positioning = `Position your ${inputs.businessType?.toLowerCase() || 'business'} solutions to address this critical agency need`;
      
      if (lowerPainPoint.includes('ndaa')) {
        positioning = `Strategic priority: Address this FY2026 NDAA requirement to gain competitive advantage in agency procurement`;
      } else if (matchStrength > 0) {
        positioning = `Strong capability match: Leverage your ${inputs.naicsCode || 'industry'} expertise to address this need`;
      } else {
        positioning = `Identify how your capabilities can be adapted or expanded to address this agency requirement`;
      }

      // Only include needs with some relevance
      if (matchStrength > 0 || lowerPainPoint.includes('ndaa') || lowerPainPoint.includes('critical')) {
        needs.push({
          agency: agencyName,
          requirement: painPoint,
          capabilityMatch,
          positioning,
        });
      }
    }
  }

  // Sort by relevance (NDAA and high-match items first)
  return needs.sort((a, b) => {
    const aScore = (a.requirement.toLowerCase().includes('ndaa') ? 10 : 0) +
                   (a.capabilityMatch !== 'General capabilities align with agency needs' ? 5 : 0);
    const bScore = (b.requirement.toLowerCase().includes('ndaa') ? 10 : 0) +
                   (b.capabilityMatch !== 'General capabilities align with agency needs' ? 5 : 0);
    return bScore - aScore;
  }).slice(0, 30); // Limit to top 30 needs
}

/**
 * Generate agency needs report with command-level pain points (for FPDS data)
 * This enhanced version uses command-level data for more specific pain points
 */
export function generateAgencyNeedsWithCommands(
  selectedAgencies: Array<{
    name: string;
    contractingOffice: string;
    subAgency: string;
    parentAgency: string;
    command?: string | null;
  }>,
  inputs: {
    naicsCode?: string;
    businessType?: string;
    goodsOrServices?: string;
  }
): Array<{
  agency: string;
  command?: string;
  requirement: string;
  capabilityMatch: string;
  positioning: string;
  painPointSource: string;
}> {
  const needs: Array<{
    agency: string;
    command?: string;
    requirement: string;
    capabilityMatch: string;
    positioning: string;
    painPointSource: string;
  }> = [];

  // NAICS code to capability keywords mapping (same as generateAgencyNeeds)
  const naicsToCapabilities: Record<string, string[]> = {
    '23': ['construction', 'building construction', 'heavy construction', 'specialty trade contractors'],
    '54': ['professional services', 'consulting', 'engineering', 'technical services'],
    '56': ['administrative services', 'facility support services', 'security services'],
    '81': ['repair and maintenance', 'equipment maintenance', 'personal services', 'civic organizations'],
    '541': ['professional services', 'consulting', 'engineering', 'technical services'],
    '541330': ['engineering services', 'professional engineering', 'engineering consulting'],
    '541511': ['custom software development', 'computer programming', 'software services'],
    '541512': ['computer systems design', 'IT services', 'systems integration'],
    '236': ['construction', 'building construction'],
    '237': ['heavy construction', 'infrastructure construction'],
    '238': ['specialty trade contractors', 'construction trades'],
    '561': ['administrative services', 'facility support services'],
    '518': ['data processing', 'hosting', 'cloud services'],
    '811': ['repair and maintenance', 'equipment maintenance'],
  };

  const painPointToCapability: Record<string, { naicsPrefixes: string[]; capability: string }> = {
    'cyber': { naicsPrefixes: ['541'], capability: 'Cybersecurity expertise and compliance capabilities' },
    'security': { naicsPrefixes: ['541'], capability: 'Security solutions and risk management' },
    'cloud': { naicsPrefixes: ['541', '518'], capability: 'Cloud migration and cloud services' },
    'software': { naicsPrefixes: ['541'], capability: 'Software development and IT services' },
    'data': { naicsPrefixes: ['541', '518'], capability: 'Data management and analytics capabilities' },
    'ai': { naicsPrefixes: ['541'], capability: 'AI/ML solutions and automation' },
    '5g': { naicsPrefixes: ['541'], capability: '5G and advanced communications services' },
    'infrastructure': { naicsPrefixes: ['236', '237', '238', '541'], capability: 'Infrastructure development and management' },
    'construction': { naicsPrefixes: ['236', '237', '238'], capability: 'Construction and facility management services' },
    'building': { naicsPrefixes: ['236', '238'], capability: 'Building construction and renovation services' },
    'facility': { naicsPrefixes: ['236', '238', '561'], capability: 'Facility construction and management services' },
    'maintenance': { naicsPrefixes: ['81', '811', '238', '561'], capability: 'Maintenance and support services' },
    'energy': { naicsPrefixes: ['236', '237', '238', '541'], capability: 'Energy efficiency and renewable energy solutions' },
    'climate': { naicsPrefixes: ['236', '237', '238', '541'], capability: 'Climate resilience and sustainability services' },
    'ship': { naicsPrefixes: ['336', '541', '238'], capability: 'Shipbuilding and marine construction' },
    'shipyard': { naicsPrefixes: ['336', '541', '238'], capability: 'Shipyard and maritime facilities services' },
    'aircraft': { naicsPrefixes: ['336', '541'], capability: 'Aircraft systems and aerospace engineering' },
    'autonomous': { naicsPrefixes: ['541', '336'], capability: 'Autonomous systems and unmanned vehicles' },
    'uas': { naicsPrefixes: ['541', '336'], capability: 'Unmanned aerial systems development' },
    'training': { naicsPrefixes: ['541', '611'], capability: 'Training and simulation services' },
  };

  // Get capabilities from NAICS code
  const userCapabilities: string[] = [];
  const normalizedNaics = inputs.naicsCode ? normalizeNAICSCode(inputs.naicsCode) : null;
  const userNaicsPrefix = normalizedNaics?.prefix || '';
  const userNaicsSector = normalizedNaics?.sector || '';

  if (inputs.naicsCode && normalizedNaics) {
    for (const code of normalizedNaics.codes) {
      if (naicsToCapabilities[code]) {
        userCapabilities.push(...naicsToCapabilities[code]);
      }
    }
    if (naicsToCapabilities[userNaicsSector]) {
      userCapabilities.push(...naicsToCapabilities[userNaicsSector]);
    }
    if (naicsToCapabilities[userNaicsPrefix] && userNaicsPrefix !== userNaicsSector) {
      userCapabilities.push(...naicsToCapabilities[userNaicsPrefix]);
    }
  }

  if (inputs.businessType) {
    userCapabilities.push(`${inputs.businessType.toLowerCase()} business`);
  }

  // Process each selected agency with command-level pain points
  for (const agency of selectedAgencies) {
    // Get pain points using command hierarchy
    const { painPoints, source } = getPainPointsForCommand(
      agency.contractingOffice,
      agency.subAgency,
      agency.parentAgency,
      agency.command
    );

    for (const painPoint of painPoints) {
      const lowerPainPoint = painPoint.toLowerCase();

      let capabilityMatch = 'General capabilities align with agency needs';
      let matchStrength = 0;

      for (const capability of userCapabilities) {
        if (lowerPainPoint.includes(capability) || capability.includes(lowerPainPoint)) {
          matchStrength++;
        }
      }

      for (const [keyword, config] of Object.entries(painPointToCapability)) {
        if (lowerPainPoint.includes(keyword)) {
          const isApplicable = !userNaicsSector ||
            config.naicsPrefixes.includes(userNaicsSector) ||
            config.naicsPrefixes.includes(userNaicsPrefix);

          if (isApplicable) {
            capabilityMatch = config.capability;
            matchStrength++;
            break;
          }
        }
      }

      let positioning = `Position your ${inputs.businessType?.toLowerCase() || 'business'} solutions to address this ${source} need`;

      if (lowerPainPoint.includes('ndaa')) {
        positioning = `Strategic priority: Address this FY2026 NDAA requirement to gain competitive advantage with ${source}`;
      } else if (matchStrength > 0) {
        positioning = `Strong capability match: Leverage your ${inputs.naicsCode || 'industry'} expertise for ${source}`;
      } else {
        positioning = `Identify how your capabilities can address this ${source} requirement`;
      }

      if (matchStrength > 0 || lowerPainPoint.includes('ndaa') || lowerPainPoint.includes('critical')) {
        needs.push({
          agency: agency.name,
          command: agency.command || undefined,
          requirement: painPoint,
          capabilityMatch,
          positioning,
          painPointSource: source,
        });
      }
    }
  }

  // Sort by relevance
  return needs.sort((a, b) => {
    const aScore = (a.requirement.toLowerCase().includes('ndaa') ? 10 : 0) +
                   (a.capabilityMatch !== 'General capabilities align with agency needs' ? 5 : 0) +
                   (a.command ? 2 : 0); // Boost command-level matches
    const bScore = (b.requirement.toLowerCase().includes('ndaa') ? 10 : 0) +
                   (b.capabilityMatch !== 'General capabilities align with agency needs' ? 5 : 0) +
                   (b.command ? 2 : 0);
    return bScore - aScore;
  }).slice(0, 40); // Limit to top 40 needs
}

export { painPointsDB, componentAgencyRules, usaceOfficePainPoints };

/**
 * Agency Source Mapping API
 *
 * Returns procurement sources and spending patterns for federal agencies.
 * Helps users understand WHERE to find opportunities beyond SAM.gov.
 *
 * Combines:
 * - Static spending/vehicle data (21 major agencies)
 * - Pain points database (250 agencies)
 *
 * GET /api/agency-sources?agency=DOD
 * GET /api/agency-sources?agencies=DOD,VA,HHS
 * GET /api/agency-sources?all=true
 * GET /api/agency-sources?search=cyber
 */

import { NextRequest, NextResponse } from 'next/server';
import agencySourcesData from '@/data/agency-procurement-sources.json';
import painPointsData from '@/data/agency-pain-points.json';

// Type definitions
interface SecondarySource {
  name: string;
  url: string;
  type: string;
  notes: string;
}

interface Vehicle {
  name: string;
  manager: string;
  naics: string[];
}

interface StaticAgencyData {
  abbreviation: string;
  cgac?: string;
  parent?: string;
  primarySources: string[];
  secondarySources: SecondarySource[];
  spendingPatterns: Record<string, number>;
  topVehicles: Vehicle[];
  tips: string;
}

interface PainPointAgency {
  painPoints: string[];
  priorities: string[];
  note?: string;
  see_also?: string;
}

interface AgencySourceResponse {
  agency: string;
  abbreviation: string;
  cgac?: string;
  parent?: string;
  spendingBreakdown?: {
    samPosted: number;
    hiddenMarket: number;
    breakdown: Record<string, number>;
  };
  primarySources: string[];
  secondarySources: SecondarySource[];
  topVehicles: Vehicle[];
  recommendations: string[];
  tips: string;
  painPoints?: string[];
  priorities?: string[];
  hasDetailedSpending: boolean;
}

// Agency aliases for matching
const agencyAliases: Record<string, string[]> = {
  'DEPARTMENT OF DEFENSE': ['DOD', 'DEFENSE', 'PENTAGON'],
  'DEPARTMENT OF THE NAVY': ['NAVY', 'USN', 'DON'],
  'DEPARTMENT OF THE ARMY': ['ARMY', 'USA'],
  'DEPARTMENT OF THE AIR FORCE': ['AIR FORCE', 'USAF', 'AF'],
  'DEPARTMENT OF VETERANS AFFAIRS': ['VA', 'VETERANS'],
  'DEPARTMENT OF HEALTH AND HUMAN SERVICES': ['HHS', 'HEALTH'],
  'GENERAL SERVICES ADMINISTRATION': ['GSA'],
  'DEPARTMENT OF HOMELAND SECURITY': ['DHS', 'HOMELAND'],
  'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION': ['NASA'],
  'DEPARTMENT OF ENERGY': ['DOE', 'ENERGY'],
  'SMALL BUSINESS ADMINISTRATION': ['SBA'],
  'DEFENSE LOGISTICS AGENCY': ['DLA'],
  'ENVIRONMENTAL PROTECTION AGENCY': ['EPA'],
  'DEPARTMENT OF JUSTICE': ['DOJ', 'JUSTICE'],
  'DEPARTMENT OF STATE': ['STATE', 'DOS'],
  'DEPARTMENT OF TRANSPORTATION': ['DOT', 'TRANSPORTATION'],
  'DEPARTMENT OF THE TREASURY': ['TREASURY'],
  'DEPARTMENT OF AGRICULTURE': ['USDA', 'AGRICULTURE'],
  'DEPARTMENT OF THE INTERIOR': ['DOI', 'INTERIOR'],
  'DEPARTMENT OF LABOR': ['DOL', 'LABOR'],
  'DEPARTMENT OF EDUCATION': ['ED', 'EDUCATION'],
  'DEPARTMENT OF HOUSING AND URBAN DEVELOPMENT': ['HUD', 'HOUSING'],
  'DEPARTMENT OF COMMERCE': ['DOC', 'COMMERCE'],
  'USACE': ['ARMY CORPS', 'CORPS OF ENGINEERS'],
  'NAVFAC': ['NAVAL FACILITIES'],
  'NAVSEA': ['NAVAL SEA SYSTEMS'],
  'NAVAIR': ['NAVAL AIR SYSTEMS'],
  'NAVWAR': ['NAVAL INFORMATION WARFARE'],
  'CDC': ['CENTERS FOR DISEASE CONTROL'],
  'FDA': ['FOOD AND DRUG'],
  'CMS': ['MEDICARE', 'MEDICAID'],
  'NIH': ['NATIONAL INSTITUTES OF HEALTH'],
  'FEMA': ['EMERGENCY MANAGEMENT'],
  'CBP': ['CUSTOMS AND BORDER'],
  'ICE': ['IMMIGRATION AND CUSTOMS'],
  'TSA': ['TRANSPORTATION SECURITY'],
  'USCG': ['COAST GUARD'],
  'DARPA': ['DEFENSE ADVANCED RESEARCH'],
  'NSF': ['NATIONAL SCIENCE FOUNDATION'],
  'NIST': ['NATIONAL INSTITUTE OF STANDARDS'],
  'NOAA': ['OCEANIC AND ATMOSPHERIC'],
  'USPTO': ['PATENT AND TRADEMARK'],
  'FAA': ['FEDERAL AVIATION'],
  'FHWA': ['FEDERAL HIGHWAY'],
  'FRA': ['FEDERAL RAILROAD'],
  'FTA': ['FEDERAL TRANSIT'],
  'IRS': ['INTERNAL REVENUE'],
  'FBI': ['FEDERAL BUREAU OF INVESTIGATION'],
  'DEA': ['DRUG ENFORCEMENT'],
  'ATF': ['ALCOHOL TOBACCO FIREARMS'],
  'USMS': ['MARSHALS SERVICE'],
  'BOP': ['BUREAU OF PRISONS'],
  'NPS': ['NATIONAL PARK SERVICE'],
  'BLM': ['BUREAU OF LAND MANAGEMENT'],
  'USFWS': ['FISH AND WILDLIFE'],
  'BOR': ['BUREAU OF RECLAMATION'],
  'USGS': ['GEOLOGICAL SURVEY'],
  'BIA': ['BUREAU OF INDIAN AFFAIRS'],
  'SSA': ['SOCIAL SECURITY'],
  'OPM': ['OFFICE OF PERSONNEL MANAGEMENT'],
  'GSA': ['GENERAL SERVICES ADMINISTRATION'],
  'CISA': ['CYBERSECURITY AND INFRASTRUCTURE'],
  'USCIS': ['CITIZENSHIP AND IMMIGRATION'],
};

// Helper to normalize agency name for lookup
function normalizeAgencyName(input: string): { staticName: string | null; painPointName: string | null } {
  const normalized = input.toUpperCase().trim();

  // Check static agency data first (spending patterns)
  let staticName: string | null = null;
  if (agencySourcesData.agencies[normalized as keyof typeof agencySourcesData.agencies]) {
    staticName = normalized;
  } else {
    // Check abbreviations in static data
    for (const [fullName, data] of Object.entries(agencySourcesData.agencies)) {
      const agency = data as StaticAgencyData;
      if (agency.abbreviation.toUpperCase() === normalized) {
        staticName = fullName;
        break;
      }
    }
  }

  // Check pain points database
  let painPointName: string | null = null;
  const painPointAgencies = painPointsData.agencies as Record<string, PainPointAgency>;

  // Direct match
  for (const agencyName of Object.keys(painPointAgencies)) {
    if (agencyName.toUpperCase() === normalized) {
      painPointName = agencyName;
      break;
    }
  }

  // Alias match
  if (!painPointName) {
    for (const [fullName, aliases] of Object.entries(agencyAliases)) {
      if (aliases.includes(normalized) || normalized === fullName) {
        // Find the pain points entry that matches
        for (const agencyName of Object.keys(painPointAgencies)) {
          if (
            agencyName.toUpperCase().includes(fullName) ||
            fullName.includes(agencyName.toUpperCase()) ||
            aliases.some(alias => agencyName.toUpperCase().includes(alias))
          ) {
            painPointName = agencyName;
            break;
          }
        }
        break;
      }
    }
  }

  // Partial match
  if (!painPointName) {
    for (const agencyName of Object.keys(painPointAgencies)) {
      if (
        agencyName.toUpperCase().includes(normalized) ||
        normalized.includes(agencyName.toUpperCase().split(' ')[0])
      ) {
        painPointName = agencyName;
        break;
      }
    }
  }

  return { staticName, painPointName };
}

// Extract abbreviation from agency name
function extractAbbreviation(name: string): string {
  // Check if there's a parenthetical abbreviation
  const match = name.match(/\(([A-Z]{2,10})\)/);
  if (match) return match[1];

  // Generate from first letters
  const words = name.split(' ').filter(w => !['of', 'the', 'and', 'for'].includes(w.toLowerCase()));
  if (words.length <= 3) {
    return words.map(w => w[0]?.toUpperCase() || '').join('');
  }
  return words.slice(0, 3).map(w => w[0]?.toUpperCase() || '').join('');
}

// Determine parent agency
function determineParent(name: string): string | undefined {
  const nameLower = name.toLowerCase();

  if (nameLower.includes('navy') || nameLower.includes('naval')) return 'Department of Defense';
  if (nameLower.includes('army')) return 'Department of Defense';
  if (nameLower.includes('air force')) return 'Department of Defense';
  if (nameLower.includes('defense') && !nameLower.includes('department of defense')) return 'Department of Defense';

  if (nameLower.includes('cdc') || nameLower.includes('fda') || nameLower.includes('cms') ||
      nameLower.includes('nih') || nameLower.includes('health')) return 'Department of Health and Human Services';

  if (nameLower.includes('fema') || nameLower.includes('cbp') || nameLower.includes('ice') ||
      nameLower.includes('tsa') || nameLower.includes('coast guard') || nameLower.includes('cisa')) {
    return 'Department of Homeland Security';
  }

  if (nameLower.includes('fbi') || nameLower.includes('dea') || nameLower.includes('atf') ||
      nameLower.includes('marshals') || nameLower.includes('prisons')) return 'Department of Justice';

  if (nameLower.includes('faa') || nameLower.includes('fhwa') || nameLower.includes('fra') ||
      nameLower.includes('fta')) return 'Department of Transportation';

  if (nameLower.includes('irs') || nameLower.includes('mint') || nameLower.includes('fiscal')) {
    return 'Department of the Treasury';
  }

  if (nameLower.includes('nps') || nameLower.includes('blm') || nameLower.includes('fish and wildlife') ||
      nameLower.includes('reclamation') || nameLower.includes('geological') || nameLower.includes('indian affairs')) {
    return 'Department of the Interior';
  }

  return undefined;
}

// Generate default sources based on agency type
function getDefaultSources(name: string, parent?: string): { primary: string[]; secondary: SecondarySource[] } {
  const nameLower = name.toLowerCase();
  const primary = ['sam.gov'];
  const secondary: SecondarySource[] = [];

  // Defense agencies
  if (parent === 'Department of Defense' || nameLower.includes('defense')) {
    primary.push('gsa_schedule', 'idiq_vehicles');
    secondary.push({
      name: 'Defense Procurement Portal',
      url: 'https://www.acq.osd.mil/',
      type: 'procurement_info',
      notes: 'DoD acquisition policy and guidance',
    });
  }

  // Civilian agencies typically use GSA
  if (!nameLower.includes('defense') && !nameLower.includes('military')) {
    primary.push('gsa_schedule');
  }

  // Research/science agencies
  if (nameLower.includes('research') || nameLower.includes('science') ||
      nameLower.includes('laboratory') || nameLower.includes('institute')) {
    primary.push('grants.gov');
    secondary.push({
      name: 'Grants.gov',
      url: 'https://www.grants.gov/',
      type: 'grants',
      notes: 'Research grants and cooperative agreements',
    });
  }

  // Health agencies
  if (nameLower.includes('health') || nameLower.includes('medical') ||
      nameLower.includes('disease') || nameLower.includes('drug')) {
    if (!primary.includes('grants.gov')) primary.push('grants.gov');
    secondary.push({
      name: 'NIH RePORTER',
      url: 'https://reporter.nih.gov/',
      type: 'research',
      notes: 'NIH-funded research projects',
    });
  }

  return { primary, secondary };
}

// Generate default spending pattern estimate
function getDefaultSpendingPattern(name: string, parent?: string): Record<string, number> {
  const nameLower = name.toLowerCase();

  // Defense agencies - high hidden market
  if (parent === 'Department of Defense' || nameLower.includes('defense')) {
    return { samPosted: 20, gsaSchedule: 30, idiqVehicles: 40, directAwards: 10 };
  }

  // Research agencies - grants heavy
  if (nameLower.includes('research') || nameLower.includes('science') || nameLower.includes('institute')) {
    return { samPosted: 25, gsaSchedule: 20, grants: 45, directAwards: 10 };
  }

  // Health agencies
  if (nameLower.includes('health') || nameLower.includes('medical')) {
    return { samPosted: 30, gsaSchedule: 25, grants: 35, directAwards: 10 };
  }

  // Default civilian
  return { samPosted: 40, gsaSchedule: 35, bpa: 15, directAwards: 10 };
}

// Build response for a single agency
function buildAgencyResponse(input: string): AgencySourceResponse | null {
  const { staticName, painPointName } = normalizeAgencyName(input);

  if (!staticName && !painPointName) {
    return null;
  }

  // Get static data if available
  const staticData = staticName
    ? (agencySourcesData.agencies[staticName as keyof typeof agencySourcesData.agencies] as StaticAgencyData)
    : null;

  // Get pain points data if available
  const painPointAgencies = painPointsData.agencies as Record<string, PainPointAgency>;
  const painPointData = painPointName ? painPointAgencies[painPointName] : null;

  // Determine agency name (prefer pain points name as it's more complete)
  const agencyName = painPointName || staticName || input;
  const parent = staticData?.parent || determineParent(agencyName);

  // Get sources
  const defaultSources = getDefaultSources(agencyName, parent);
  const primarySources = staticData?.primarySources || defaultSources.primary;
  const secondarySources = staticData?.secondarySources || defaultSources.secondary;

  // Get spending patterns
  const spendingPatterns = staticData?.spendingPatterns || getDefaultSpendingPattern(agencyName, parent);
  const samPosted = spendingPatterns.samPosted || 30;
  const hiddenMarket = 100 - samPosted;

  // Build recommendations
  const recommendations: string[] = [];

  if (spendingPatterns.gsaSchedule && spendingPatterns.gsaSchedule > 30) {
    recommendations.push(`GSA Schedule is critical - ${spendingPatterns.gsaSchedule}% of spending goes through Schedule.`);
  }

  if (spendingPatterns.idiqVehicles && spendingPatterns.idiqVehicles > 20) {
    recommendations.push(`IDIQ vehicles dominate - ${spendingPatterns.idiqVehicles}% goes through pre-competed vehicles.`);
  }

  if (spendingPatterns.grants && spendingPatterns.grants > 10) {
    recommendations.push(`Significant grants program - ${spendingPatterns.grants}% comes through grants. Check Grants.gov.`);
  }

  if (hiddenMarket > 70) {
    recommendations.push(`High hidden market (${hiddenMarket}%) - Focus on vehicles and direct relationships, not just SAM.gov.`);
  }

  if (staticData?.topVehicles && staticData.topVehicles.length > 0) {
    const vehicleNames = staticData.topVehicles.map(v => v.name).join(', ');
    recommendations.push(`Key vehicles to pursue: ${vehicleNames}`);
  }

  // Add pain point-based recommendations
  if (painPointData?.painPoints && painPointData.painPoints.length > 0) {
    recommendations.push(`Top agency pain point: ${painPointData.painPoints[0]}`);
  }

  // Generate tips
  let tips = staticData?.tips || '';
  if (!tips && painPointData?.priorities && painPointData.priorities.length > 0) {
    tips = `Focus on current priorities: ${painPointData.priorities[0].substring(0, 150)}...`;
  }
  if (!tips) {
    tips = `Check SAM.gov for ${agencyName} opportunities. GSA Schedule recommended for faster entry.`;
  }

  return {
    agency: agencyName,
    abbreviation: staticData?.abbreviation || extractAbbreviation(agencyName),
    cgac: staticData?.cgac,
    parent,
    spendingBreakdown: {
      samPosted,
      hiddenMarket,
      breakdown: spendingPatterns,
    },
    primarySources,
    secondarySources,
    topVehicles: staticData?.topVehicles || [],
    recommendations,
    tips,
    painPoints: painPointData?.painPoints?.slice(0, 5),
    priorities: painPointData?.priorities?.slice(0, 3),
    hasDetailedSpending: !!staticData,
  };
}

// Get all agencies from pain points database
function getAllAgencies(): string[] {
  const painPointAgencies = painPointsData.agencies as Record<string, PainPointAgency>;
  return Object.keys(painPointAgencies);
}

// Search agencies by keyword
function searchAgencies(query: string): string[] {
  const queryLower = query.toLowerCase();
  const painPointAgencies = painPointsData.agencies as Record<string, PainPointAgency>;

  return Object.entries(painPointAgencies)
    .filter(([name, data]) => {
      // Search in agency name
      if (name.toLowerCase().includes(queryLower)) return true;

      // Search in pain points
      if (data.painPoints?.some(p => p.toLowerCase().includes(queryLower))) return true;

      // Search in priorities
      if (data.priorities?.some(p => p.toLowerCase().includes(queryLower))) return true;

      return false;
    })
    .map(([name]) => name);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const agencyParam = searchParams.get('agency');
  const agenciesParam = searchParams.get('agencies');
  const allParam = searchParams.get('all');
  const vehiclesParam = searchParams.get('vehicles');
  const tipsParam = searchParams.get('tips');
  const searchParam = searchParams.get('search');
  const listParam = searchParams.get('list');

  // Return vehicle types info
  if (vehiclesParam === 'true') {
    return NextResponse.json({
      success: true,
      vehicleTypes: agencySourcesData.vehicleTypes,
    });
  }

  // Return general recommendations/tips
  if (tipsParam === 'true') {
    return NextResponse.json({
      success: true,
      recommendations: agencySourcesData.recommendations,
    });
  }

  // Return list of all agencies
  if (listParam === 'true') {
    const allAgencyNames = getAllAgencies();
    return NextResponse.json({
      success: true,
      count: allAgencyNames.length,
      agencies: allAgencyNames.map(name => ({
        name,
        abbreviation: extractAbbreviation(name),
      })),
    });
  }

  // Search agencies by keyword
  if (searchParam) {
    const matchingAgencies = searchAgencies(searchParam);
    const results = matchingAgencies.slice(0, 20).map(name => buildAgencyResponse(name)).filter(Boolean);

    return NextResponse.json({
      success: true,
      query: searchParam,
      count: results.length,
      totalMatches: matchingAgencies.length,
      agencies: results,
    });
  }

  // Return all agencies
  if (allParam === 'true') {
    const allAgencyNames = getAllAgencies();
    const allAgencies = allAgencyNames.map(name => buildAgencyResponse(name)).filter(Boolean);

    return NextResponse.json({
      success: true,
      count: allAgencies.length,
      agencies: allAgencies,
      vehicleTypes: agencySourcesData.vehicleTypes,
      lastUpdated: agencySourcesData.lastUpdated,
    });
  }

  // Single agency lookup
  if (agencyParam) {
    const response = buildAgencyResponse(agencyParam);

    if (!response) {
      // Find similar agencies
      const allAgencies = getAllAgencies();
      const suggestions = allAgencies
        .filter(name => name.toLowerCase().includes(agencyParam.toLowerCase().substring(0, 3)))
        .slice(0, 5);

      return NextResponse.json({
        success: false,
        error: `Agency "${agencyParam}" not found`,
        suggestions,
        tip: 'Try ?list=true to see all 250 agencies or ?search=keyword to search',
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      ...response,
      vehicleTypes: agencySourcesData.vehicleTypes,
    });
  }

  // Multiple agencies lookup
  if (agenciesParam) {
    const agencyList = agenciesParam.split(',').map(a => a.trim());
    const results: AgencySourceResponse[] = [];
    const notFound: string[] = [];

    for (const agency of agencyList) {
      const response = buildAgencyResponse(agency);
      if (response) {
        results.push(response);
      } else {
        notFound.push(agency);
      }
    }

    return NextResponse.json({
      success: true,
      count: results.length,
      agencies: results,
      notFound: notFound.length > 0 ? notFound : undefined,
      vehicleTypes: agencySourcesData.vehicleTypes,
    });
  }

  // Default: return summary
  const painPointAgencies = painPointsData.agencies as Record<string, PainPointAgency>;
  const staticAgencies = new Set(Object.keys(agencySourcesData.agencies));

  const summary = Object.keys(painPointAgencies).map(name => {
    const hasDetailedData = staticAgencies.has(name.toUpperCase()) ||
      Array.from(staticAgencies).some(s =>
        name.toUpperCase().includes(s) || s.includes(name.toUpperCase().split(' ')[0])
      );

    return {
      name,
      abbreviation: extractAbbreviation(name),
      hasDetailedSpending: hasDetailedData,
      painPointCount: painPointAgencies[name]?.painPoints?.length || 0,
    };
  });

  return NextResponse.json({
    success: true,
    message: 'Use ?agency=DOD or ?search=cyber for detailed info. Use ?all=true for full data.',
    totalAgencies: summary.length,
    agenciesWithDetailedSpending: summary.filter(a => a.hasDetailedSpending).length,
    summary: summary.slice(0, 25),
    endpoints: {
      singleAgency: '/api/agency-sources?agency=DOD',
      multipleAgencies: '/api/agency-sources?agencies=DOD,VA,HHS',
      search: '/api/agency-sources?search=cyber',
      listAll: '/api/agency-sources?list=true',
      allData: '/api/agency-sources?all=true',
      vehicles: '/api/agency-sources?vehicles=true',
    },
    lastUpdated: agencySourcesData.lastUpdated,
  });
}

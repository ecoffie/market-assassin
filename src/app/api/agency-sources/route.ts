/**
 * Agency Source Mapping API
 *
 * Returns procurement sources and spending patterns for ALL 250 federal agencies.
 * Each agency has: spending patterns, vehicles, secondary sources, pain points, priorities.
 *
 * GET /api/agency-sources?agency=DOD
 * GET /api/agency-sources?agencies=DOD,VA,HHS
 * GET /api/agency-sources?all=true
 * GET /api/agency-sources?search=cyber
 * GET /api/agency-sources?category=defense
 */

import { NextRequest, NextResponse } from 'next/server';
import spendingData from '@/data/agency-spending-complete.json';
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

interface SpendingAgencyData {
  abbreviation: string;
  parent: string | null;
  category: string;
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
  category: string;
  parent?: string;
  /** Null until the split is MEASURED from USASpending — see the suppression note. */
  spendingBreakdown: null;
  primarySources: string[];
  secondarySources: SecondarySource[];
  topVehicles: Vehicle[];
  recommendations: string[];
  tips: string;
  painPoints?: string[];
  priorities?: string[];
}

// Agency aliases for flexible lookup
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
  'CDC': ['CENTERS FOR DISEASE CONTROL'],
  'FDA': ['FOOD AND DRUG'],
  'CMS': ['MEDICARE', 'MEDICAID'],
  'NIH': ['NATIONAL INSTITUTES OF HEALTH'],
  'FEMA': ['EMERGENCY MANAGEMENT'],
  'CBP': ['CUSTOMS AND BORDER'],
  'TSA': ['TRANSPORTATION SECURITY'],
  'CISA': ['CYBERSECURITY AND INFRASTRUCTURE'],
  'DARPA': ['DEFENSE ADVANCED RESEARCH'],
  'NSF': ['NATIONAL SCIENCE FOUNDATION'],
  'FAA': ['FEDERAL AVIATION'],
  'IRS': ['INTERNAL REVENUE'],
  'FBI': ['FEDERAL BUREAU OF INVESTIGATION'],
};

const spendingAgencies = spendingData.agencies as Record<string, SpendingAgencyData>;
const painPointAgencies = painPointsData.agencies as Record<string, PainPointAgency>;

// Find agency by name or alias
function findAgency(input: string): string | null {
  const normalized = input.toUpperCase().trim();

  // Direct match
  if (spendingAgencies[input]) {
    return input;
  }

  // Case-insensitive match
  for (const name of Object.keys(spendingAgencies)) {
    if (name.toUpperCase() === normalized) {
      return name;
    }
  }

  // Alias match
  for (const [fullName, aliases] of Object.entries(agencyAliases)) {
    if (aliases.includes(normalized)) {
      // Find the actual agency name in our data
      for (const name of Object.keys(spendingAgencies)) {
        if (name.toUpperCase().includes(fullName) || fullName.includes(name.toUpperCase())) {
          return name;
        }
      }
    }
  }

  // Abbreviation match (from agency data)
  for (const [name, data] of Object.entries(spendingAgencies)) {
    if (data.abbreviation.toUpperCase() === normalized) {
      return name;
    }
  }

  // Partial match
  for (const name of Object.keys(spendingAgencies)) {
    if (name.toUpperCase().includes(normalized) || normalized.includes(name.toUpperCase().split(' ')[0])) {
      return name;
    }
  }

  return null;
}

// Build response for an agency
function buildAgencyResponse(agencyName: string): AgencySourceResponse | null {
  const spendingInfo = spendingAgencies[agencyName];
  const painPointInfo = painPointAgencies[agencyName];

  if (!spendingInfo) return null;

  /**
   * PERCENTAGES SUPPRESSED 2026-08-16.
   *
   * `spendingPatterns` was never measured. scripts/generate-agency-spending-data.js
   * assigns each of ~250 agencies one of 17 hand-written archetypes
   * (defense_heavy: { samPosted: 15, gsaSchedule: 30, idiqVehicles: 45, ... }) —
   * round numbers, no source, identical for every agency sharing a category.
   *
   * They were rendered as declarative findings: "GSA Schedule is critical - 30%
   * of spending goes through Schedule", and a headline "85% of spending is NOT
   * on SAM.gov" computed as 100 - a constant. A customer can disprove any of it
   * with one USASpending query.
   *
   * The QUALITATIVE signal is still useful and still true — these agencies DO
   * buy heavily through Schedule/IDIQ/SeaPort. So keep the guidance, drop the
   * fabricated number. Restore percentages only once the generator MEASURES
   * them from USASpending spending_by_award grouped by award/IDV type.
   */
  const recommendations: string[] = [];

  if (spendingInfo.spendingPatterns.gsaSchedule && spendingInfo.spendingPatterns.gsaSchedule > 30) {
    recommendations.push('GSA Schedule is a primary route for this agency — get on Schedule or subcontract to a holder.');
  }

  if (spendingInfo.spendingPatterns.idiqVehicles && spendingInfo.spendingPatterns.idiqVehicles > 20) {
    recommendations.push('IDIQ vehicles carry much of this work — target vehicle holders for subcontracting.');
  }

  if (spendingInfo.spendingPatterns.seaport && spendingInfo.spendingPatterns.seaport > 20) {
    recommendations.push('SeaPort-NxG is a major route here — team with a prime on that vehicle.');
  }

  if (spendingInfo.spendingPatterns.grants && spendingInfo.spendingPatterns.grants > 10) {
    recommendations.push('This agency runs a significant grants program — check Grants.gov alongside SAM.');
  }

  // The "hidden market %" was 100 minus an invented constant — the most quotable
  // number in the response and the least supported. Keep the true qualitative
  // point (much federal spend never appears as an open SAM competition) without
  // attaching a manufactured figure to this specific agency.
  if ((spendingInfo.spendingPatterns.samPosted ?? 100) < 30) {
    recommendations.push('Much of this agency\'s work never appears as an open SAM.gov competition — vehicles and direct relationships matter more here.');
  }

  if (spendingInfo.topVehicles && spendingInfo.topVehicles.length > 0) {
    const vehicleNames = spendingInfo.topVehicles.map(v => v.name).join(', ');
    recommendations.push(`Key vehicles to pursue: ${vehicleNames}`);
  }

  // Add pain point-based recommendation
  if (painPointInfo?.painPoints && painPointInfo.painPoints.length > 0) {
    recommendations.push(`Top agency challenge: ${painPointInfo.painPoints[0]}`);
  }

  return {
    agency: agencyName,
    abbreviation: spendingInfo.abbreviation,
    category: spendingInfo.category,
    parent: spendingInfo.parent || undefined,
    // spendingBreakdown intentionally OMITTED — see the suppression note above.
    // Returning the archetype numbers under a name like "spendingBreakdown"
    // invites any consumer to render them as measured fact.
    spendingBreakdown: null,
    primarySources: spendingInfo.primarySources,
    secondarySources: spendingInfo.secondarySources,
    topVehicles: spendingInfo.topVehicles,
    recommendations,
    tips: spendingInfo.tips,
    painPoints: painPointInfo?.painPoints?.slice(0, 5),
    priorities: painPointInfo?.priorities?.slice(0, 3),
  };
}

// Search agencies
function searchAgencies(query: string): string[] {
  const queryLower = query.toLowerCase();

  return Object.entries(spendingAgencies)
    .filter(([name, data]) => {
      // Search in name
      if (name.toLowerCase().includes(queryLower)) return true;

      // Search in category
      if (data.category.toLowerCase().includes(queryLower)) return true;

      // Search in pain points
      const painPoint = painPointAgencies[name];
      if (painPoint?.painPoints?.some(p => p.toLowerCase().includes(queryLower))) return true;
      if (painPoint?.priorities?.some(p => p.toLowerCase().includes(queryLower))) return true;

      // Search in tips
      if (data.tips.toLowerCase().includes(queryLower)) return true;

      return false;
    })
    .map(([name]) => name);
}

// Get agencies by category
function getAgenciesByCategory(category: string): string[] {
  return Object.entries(spendingAgencies)
    .filter(([, data]) => data.category.toLowerCase() === category.toLowerCase())
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
  const categoryParam = searchParams.get('category');
  const categoriesParam = searchParams.get('categories');

  // Return vehicle types info
  if (vehiclesParam === 'true') {
    return NextResponse.json({
      success: true,
      vehicleTypes: spendingData.vehicleTypes,
    });
  }

  // Return general recommendations/tips
  if (tipsParam === 'true') {
    return NextResponse.json({
      success: true,
      recommendations: spendingData.recommendations,
    });
  }

  // Return all categories
  if (categoriesParam === 'true') {
    const categories: Record<string, number> = {};
    for (const data of Object.values(spendingAgencies)) {
      categories[data.category] = (categories[data.category] || 0) + 1;
    }
    return NextResponse.json({
      success: true,
      categories: Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => ({ category, count })),
    });
  }

  // Return agencies by category
  if (categoryParam) {
    const matchingAgencies = getAgenciesByCategory(categoryParam);
    const results = matchingAgencies.map(name => buildAgencyResponse(name)).filter(Boolean);

    return NextResponse.json({
      success: true,
      category: categoryParam,
      count: results.length,
      agencies: results,
    });
  }

  // Return list of all agencies
  if (listParam === 'true') {
    const agencyList = Object.entries(spendingAgencies).map(([name, data]) => ({
      name,
      abbreviation: data.abbreviation,
      category: data.category,
      // Was 100 - an invented constant. Null until measured.
      hiddenMarket: null,
      vehicleCount: data.topVehicles.length,
    }));

    return NextResponse.json({
      success: true,
      count: agencyList.length,
      // Was sorted by the invented hidden-market %. Alphabetical is honest: we
      // have no measured basis for ranking these agencies against each other.
      agencies: agencyList.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  // Search agencies
  if (searchParam) {
    const matchingAgencies = searchAgencies(searchParam);
    const results = matchingAgencies.slice(0, 25).map(name => buildAgencyResponse(name)).filter(Boolean);

    return NextResponse.json({
      success: true,
      query: searchParam,
      count: results.length,
      totalMatches: matchingAgencies.length,
      agencies: results,
    });
  }

  // Return all agencies (full data)
  if (allParam === 'true') {
    const allAgencies = Object.keys(spendingAgencies)
      .map(name => buildAgencyResponse(name))
      .filter(Boolean);

    return NextResponse.json({
      success: true,
      count: allAgencies.length,
      agencies: allAgencies,
      vehicleTypes: spendingData.vehicleTypes,
      lastUpdated: spendingData.lastUpdated,
    });
  }

  // Single agency lookup
  if (agencyParam) {
    const agencyName = findAgency(agencyParam);

    if (!agencyName) {
      // Find similar agencies
      const suggestions = Object.keys(spendingAgencies)
        .filter(name => name.toLowerCase().includes(agencyParam.toLowerCase().substring(0, 3)))
        .slice(0, 5);

      return NextResponse.json({
        success: false,
        error: `Agency "${agencyParam}" not found`,
        suggestions,
        tip: 'Try ?list=true to see all 250 agencies or ?search=keyword to search',
      }, { status: 404 });
    }

    const response = buildAgencyResponse(agencyName);

    return NextResponse.json({
      success: true,
      ...response,
      vehicleTypes: spendingData.vehicleTypes,
    });
  }

  // Multiple agencies lookup
  if (agenciesParam) {
    const agencyList = agenciesParam.split(',').map(a => a.trim());
    const results: AgencySourceResponse[] = [];
    const notFound: string[] = [];

    for (const agency of agencyList) {
      const agencyName = findAgency(agency);
      if (agencyName) {
        const response = buildAgencyResponse(agencyName);
        if (response) results.push(response);
      } else {
        notFound.push(agency);
      }
    }

    return NextResponse.json({
      success: true,
      count: results.length,
      agencies: results,
      notFound: notFound.length > 0 ? notFound : undefined,
      vehicleTypes: spendingData.vehicleTypes,
    });
  }

  // Default: return summary
  const categoryCounts: Record<string, number> = {};
  let totalHiddenMarket = 0;

  for (const data of Object.values(spendingAgencies)) {
    categoryCounts[data.category] = (categoryCounts[data.category] || 0) + 1;
    totalHiddenMarket += 100 - (data.spendingPatterns.samPosted || 30);
  }

  const avgHiddenMarket = Math.round(totalHiddenMarket / Object.keys(spendingAgencies).length);

  return NextResponse.json({
    success: true,
    message: 'Use ?agency=DOD or ?search=cyber for detailed info. Use ?all=true for full data.',
    stats: {
      totalAgencies: spendingData.totalAgencies,
      avgHiddenMarket: `${avgHiddenMarket}%`,
      topCategories: Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([category, count]) => ({ category, count })),
    },
    endpoints: {
      singleAgency: '/api/agency-sources?agency=DOD',
      multipleAgencies: '/api/agency-sources?agencies=DOD,VA,HHS',
      search: '/api/agency-sources?search=cyber',
      byCategory: '/api/agency-sources?category=defense',
      listAll: '/api/agency-sources?list=true',
      allCategories: '/api/agency-sources?categories=true',
      allData: '/api/agency-sources?all=true',
      vehicles: '/api/agency-sources?vehicles=true',
    },
    lastUpdated: spendingData.lastUpdated,
  });
}

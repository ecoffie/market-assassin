/**
 * Agency Source Mapping API
 *
 * Returns procurement sources and spending patterns for federal agencies.
 * Helps users understand WHERE to find opportunities beyond SAM.gov.
 *
 * GET /api/agency-sources?agency=DOD
 * GET /api/agency-sources?agencies=DOD,VA,HHS
 * GET /api/agency-sources?all=true
 */

import { NextRequest, NextResponse } from 'next/server';
import agencySourcesData from '@/data/agency-procurement-sources.json';

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

interface AgencyData {
  abbreviation: string;
  cgac?: string;
  parent?: string;
  primarySources: string[];
  secondarySources: SecondarySource[];
  spendingPatterns: Record<string, number>;
  topVehicles: Vehicle[];
  tips: string;
}

interface AgencySourceResponse {
  agency: string;
  abbreviation: string;
  cgac?: string;
  parent?: string;
  spendingBreakdown: {
    samPosted: number;
    hiddenMarket: number;
    breakdown: Record<string, number>;
  };
  primarySources: string[];
  secondarySources: SecondarySource[];
  topVehicles: Vehicle[];
  recommendations: string[];
  tips: string;
}

interface VehicleType {
  name: string;
  description: string;
  howToGet: string;
  benefits: string[];
  url?: string;
  examples?: string[];
}

// Helper to normalize agency name for lookup
function normalizeAgencyName(input: string): string | null {
  const normalized = input.toUpperCase().trim();

  // Direct match
  if (agencySourcesData.agencies[normalized as keyof typeof agencySourcesData.agencies]) {
    return normalized;
  }

  // Check abbreviations
  for (const [fullName, data] of Object.entries(agencySourcesData.agencies)) {
    const agency = data as AgencyData;
    if (agency.abbreviation.toUpperCase() === normalized) {
      return fullName;
    }
  }

  // Partial match
  for (const fullName of Object.keys(agencySourcesData.agencies)) {
    if (fullName.includes(normalized) || normalized.includes(fullName.split(' ')[0])) {
      return fullName;
    }
  }

  return null;
}

// Build response for a single agency
function buildAgencyResponse(agencyName: string): AgencySourceResponse | null {
  const data = agencySourcesData.agencies[agencyName as keyof typeof agencySourcesData.agencies] as AgencyData | undefined;
  if (!data) return null;

  const samPosted = data.spendingPatterns.samPosted || 0;
  const hiddenMarket = 100 - samPosted;

  // Build recommendations based on spending patterns
  const recommendations: string[] = [];

  if (data.spendingPatterns.gsaSchedule && data.spendingPatterns.gsaSchedule > 30) {
    recommendations.push(`GSA Schedule is critical - ${data.spendingPatterns.gsaSchedule}% of spending goes through Schedule.`);
  }

  if (data.spendingPatterns.idiqVehicles && data.spendingPatterns.idiqVehicles > 20) {
    recommendations.push(`IDIQ vehicles dominate - ${data.spendingPatterns.idiqVehicles}% goes through pre-competed vehicles.`);
  }

  if (data.spendingPatterns.seaport && data.spendingPatterns.seaport > 20) {
    recommendations.push(`SeaPort-NxG is essential - ${data.spendingPatterns.seaport}% of spending uses this vehicle.`);
  }

  if (data.spendingPatterns.grants && data.spendingPatterns.grants > 10) {
    recommendations.push(`Significant grants program - ${data.spendingPatterns.grants}% comes through grants. Check Grants.gov.`);
  }

  if (hiddenMarket > 70) {
    recommendations.push(`High hidden market (${hiddenMarket}%) - Focus on vehicles and direct relationships, not just SAM.gov.`);
  }

  if (data.topVehicles.length > 0) {
    const vehicleNames = data.topVehicles.map(v => v.name).join(', ');
    recommendations.push(`Key vehicles to pursue: ${vehicleNames}`);
  }

  return {
    agency: agencyName,
    abbreviation: data.abbreviation,
    cgac: data.cgac,
    parent: data.parent,
    spendingBreakdown: {
      samPosted,
      hiddenMarket,
      breakdown: data.spendingPatterns,
    },
    primarySources: data.primarySources,
    secondarySources: data.secondarySources,
    topVehicles: data.topVehicles,
    recommendations,
    tips: data.tips,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const agencyParam = searchParams.get('agency');
  const agenciesParam = searchParams.get('agencies');
  const allParam = searchParams.get('all');
  const vehiclesParam = searchParams.get('vehicles');
  const tipsParam = searchParams.get('tips');

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

  // Return all agencies
  if (allParam === 'true') {
    const allAgencies: AgencySourceResponse[] = [];

    for (const agencyName of Object.keys(agencySourcesData.agencies)) {
      const response = buildAgencyResponse(agencyName);
      if (response) {
        allAgencies.push(response);
      }
    }

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
    const normalizedName = normalizeAgencyName(agencyParam);

    if (!normalizedName) {
      return NextResponse.json({
        success: false,
        error: `Agency "${agencyParam}" not found`,
        availableAgencies: Object.keys(agencySourcesData.agencies).map(name => {
          const data = agencySourcesData.agencies[name as keyof typeof agencySourcesData.agencies] as AgencyData;
          return { name, abbreviation: data.abbreviation };
        }),
      }, { status: 404 });
    }

    const response = buildAgencyResponse(normalizedName);

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
      const normalizedName = normalizeAgencyName(agency);
      if (normalizedName) {
        const response = buildAgencyResponse(normalizedName);
        if (response) {
          results.push(response);
        }
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

  // Default: return summary of all agencies
  const summary = Object.entries(agencySourcesData.agencies).map(([name, data]) => {
    const agency = data as AgencyData;
    return {
      name,
      abbreviation: agency.abbreviation,
      samPosted: agency.spendingPatterns.samPosted || 0,
      hiddenMarket: 100 - (agency.spendingPatterns.samPosted || 0),
      topVehicleCount: agency.topVehicles.length,
    };
  }).sort((a, b) => b.hiddenMarket - a.hiddenMarket);

  return NextResponse.json({
    success: true,
    message: 'Use ?agency=DOD or ?agencies=DOD,VA,HHS for detailed info. Use ?all=true for full data.',
    summary,
    totalAgencies: summary.length,
    lastUpdated: agencySourcesData.lastUpdated,
  });
}

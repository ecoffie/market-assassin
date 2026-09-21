import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface USACEData {
  district_mappings: {
    milcon_offices: {
      locations: Record<string, string>;
      keywords: string[];
    };
    civil_works_districts: {
      locations: Record<string, string>;
      keywords: string[];
    };
    environmental_offices: {
      locations: Record<string, string>;
      keywords: string[];
    };
  };
  usace_mission_areas: Record<string, {
    description: string;
    painPoints: { pain: string }[];
  }>;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const officeName = searchParams.get('officeName') || '';
    const location = searchParams.get('location') || '';

    console.log(`USACE mission detection request - Office: ${officeName}, Location: ${location}`);

    // Load USACE office-specific pain points data
    const usaceDataPath = path.join(process.cwd(), 'src', 'data', 'usace-office-specific-pain-points.json');

    if (!fs.existsSync(usaceDataPath)) {
      return NextResponse.json({
        success: false,
        error: 'USACE data file not found'
      }, { status: 404 });
    }

    const usaceData: USACEData = JSON.parse(fs.readFileSync(usaceDataPath, 'utf8'));

    let missionArea: string | null = null;
    let matchMethod = 'default';

    // Extract location city/state from location parameter
    const locationUpper = (location || '').toUpperCase();
    const locationParts = locationUpper.split(',').map(p => p.trim());
    const locationCity = locationParts[0] || '';

    // 1. Check MILCON offices by location
    const milconLocations = usaceData.district_mappings.milcon_offices.locations;
    for (const [loc, mission] of Object.entries(milconLocations)) {
      const locUpper = loc.toUpperCase();
      if (locationCity.length >= 3 && (locationCity.includes(locUpper) || locUpper.includes(locationCity))) {
        missionArea = mission;
        matchMethod = `location:${loc}`;
        break;
      }
    }

    // 2. Check Civil Works districts by location
    if (!missionArea) {
      const civilWorksLocations = usaceData.district_mappings.civil_works_districts.locations;
      for (const [loc, mission] of Object.entries(civilWorksLocations)) {
        const locUpper = loc.toUpperCase();
        if (locationCity.length >= 3 && (locationCity.includes(locUpper) || locUpper.includes(locationCity))) {
          missionArea = mission;
          matchMethod = `location:${loc}`;
          break;
        }
      }
    }

    // 3. Check Environmental offices by location
    if (!missionArea) {
      const envLocations = usaceData.district_mappings.environmental_offices.locations;
      for (const [loc, mission] of Object.entries(envLocations)) {
        const locUpper = loc.toUpperCase();
        if (locationCity.length >= 3 && (locationCity.includes(locUpper) || locUpper.includes(locationCity))) {
          missionArea = mission;
          matchMethod = `location:${loc}`;
          break;
        }
      }
    }

    // 4. Check keywords in office name if no location match
    if (!missionArea && officeName) {
      const officeNameUpper = officeName.toUpperCase();

      // Check MILCON keywords
      const milconKeywords = usaceData.district_mappings.milcon_offices.keywords;
      if (milconKeywords.some(keyword => officeNameUpper.includes(keyword.toUpperCase()))) {
        missionArea = 'military_construction';
        matchMethod = 'keyword:milcon';
      }

      // Check Civil Works keywords
      if (!missionArea) {
        const civilWorksKeywords = usaceData.district_mappings.civil_works_districts.keywords;
        if (civilWorksKeywords.some(keyword => officeNameUpper.includes(keyword.toUpperCase()))) {
          missionArea = 'civil_works';
          matchMethod = 'keyword:civil_works';
        }
      }

      // Check Environmental keywords
      if (!missionArea) {
        const envKeywords = usaceData.district_mappings.environmental_offices.keywords;
        if (envKeywords.some(keyword => officeNameUpper.includes(keyword.toUpperCase()))) {
          missionArea = 'environmental';
          matchMethod = 'keyword:environmental';
        }
      }
    }

    // 5. Default to Civil Works if no match
    if (!missionArea) {
      missionArea = 'civil_works';
      matchMethod = 'default';
    }

    // Get pain points for the identified mission area
    const missionData = usaceData.usace_mission_areas[missionArea];
    if (!missionData) {
      return NextResponse.json({
        success: false,
        error: `Mission area not found: ${missionArea}`
      }, { status: 404 });
    }

    // Extract just the pain point text
    const painPoints = missionData.painPoints.map(pp => pp.pain);

    console.log(`USACE mission detected: ${missionArea} (${matchMethod})`);

    return NextResponse.json({
      success: true,
      missionArea,
      matchMethod,
      description: missionData.description,
      painPoints
    });
  } catch (error) {
    console.error('Error detecting USACE mission:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to detect USACE mission area',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

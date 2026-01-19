import { NextRequest, NextResponse } from 'next/server';
import { expandGenericDoDAgency, ExpandedDoDAgency } from '@/lib/utils/command-info';

// Agency type that combines both regular and expanded DoD agencies
interface Agency {
  id: string;
  name: string;
  contractingOffice: string;
  subAgency: string;
  parentAgency: string;
  hasSpecificOffice: boolean;
  location: string;
  setAsideSpending: number;
  contractCount: number;
  agencyId?: string;
  agencyCode?: string;
  subAgencyCode?: string;
  command?: string;
  website?: string | null;
  forecastUrl?: string | null;
  samForecastUrl?: string;
  osbp?: {
    name: string;
    director?: string;
    phone?: string;
    email?: string;
    address?: string;
  } | null;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { naicsCodes = [], businessFormation = '' } = body;

    console.log('[Agencies Lookup] NAICS codes:', naicsCodes, 'Business:', businessFormation);

    if (!naicsCodes || naicsCodes.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No NAICS codes provided'
      }, { status: 400, headers: corsHeaders });
    }

    // Normalize NAICS codes to strings
    const normalizedCodes = naicsCodes.map((code: string | number) => String(code).trim());

    // Build USAspending API request
    const filters: Record<string, unknown> = {
      award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
      time_period: [{
        start_date: '2022-10-01',
        end_date: '2025-09-30'
      }],
      naics_codes: normalizedCodes
    };

    // Add small business set-aside if applicable
    if (businessFormation && businessFormation.toLowerCase().includes('small')) {
      filters.set_aside_type_codes = ['SBA', 'SBP', '8A', '8AN', 'WOSB', 'EDWOSB', 'HZBZ', 'HUBZ', 'SDVOSB', 'VOSB'];
    }

    const fields = [
      'Award ID',
      'Recipient Name',
      'Award Amount',
      'Awarding Agency',
      'Awarding Sub Agency',
      'Awarding Agency Code',
      'Awarding Sub Agency Code',
      'Awarding Office',
      'NAICS Code',
      'Place of Performance State Code',
      'Set-Aside Type'
    ];

    // Fetch from USAspending API - reduced pages for faster response
    const allAwards: Record<string, unknown>[] = [];
    const maxPages = 10; // Reduced from 25 for faster loading
    const limit = 100;

    for (let page = 1; page <= maxPages; page++) {
      try {
        const response = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters,
            fields,
            page,
            limit,
            order: 'desc',
            sort: 'Award Amount'
          }),
          signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) break;
        const data = await response.json();

        if (data?.results) {
          allAwards.push(...data.results);
          if (data.results.length < limit) break;
        } else {
          break;
        }

        if (page < maxPages) {
          await new Promise(resolve => setTimeout(resolve, 50)); // Reduced delay
        }
      } catch {
        break;
      }
    }

    console.log(`[Agencies Lookup] Retrieved ${allAwards.length} contracts`);

    // Aggregate by agency/office
    const officeSpending: Record<string, Agency> = {};

    for (const award of allAwards) {
      const awardingAgency = (award['Awarding Agency'] as string) || 'Unknown Agency';
      const rawSubAgency = (award['Awarding Sub Agency'] as string) || awardingAgency;
      const rawOffice = (award['Awarding Office'] as string) || null;
      const awardingOffice = rawOffice || rawSubAgency;
      const location = (award['Place of Performance State Code'] as string) || 'Unknown';
      const amount = (award['Award Amount'] as number) || 0;
      const hasSpecificOffice = !!rawOffice && rawOffice !== rawSubAgency;

      const officeKey = `${rawSubAgency}|${awardingOffice}`;

      if (!officeSpending[officeKey]) {
        officeSpending[officeKey] = {
          id: officeKey,
          agencyId: awardingAgency.toLowerCase().replace(/\s+/g, '-'),
          name: awardingOffice,
          contractingOffice: awardingOffice,
          subAgency: rawSubAgency,
          parentAgency: awardingAgency,
          hasSpecificOffice,
          agencyCode: (award['Awarding Agency Code'] as string) || '',
          subAgencyCode: (award['Awarding Sub Agency Code'] as string) || '',
          location,
          setAsideSpending: 0,
          contractCount: 0
        };
      }

      officeSpending[officeKey].setAsideSpending += amount;
      officeSpending[officeKey].contractCount += 1;
    }

    // Convert to array and sort
    let agencies: Agency[] = Object.values(officeSpending).sort(
      (a, b) => b.setAsideSpending - a.setAsideSpending
    );

    // Expand generic DoD agencies
    const dodParentAgencies = ['DEPARTMENT OF DEFENSE', 'DEPT OF DEFENSE', 'DOD'];
    const dodSubAgencies = [
      'DEPARTMENT OF THE NAVY', 'DEPT OF THE NAVY',
      'DEPARTMENT OF THE ARMY', 'DEPT OF THE ARMY',
      'DEPARTMENT OF THE AIR FORCE', 'DEPT OF THE AIR FORCE'
    ];

    const dodAgenciesNeedingDetail = agencies.filter(agency => {
      const parentUpper = (agency.parentAgency || '').toUpperCase();
      const subUpper = (agency.subAgency || '').toUpperCase();
      const nameUpper = (agency.name || '').toUpperCase();

      const isDoD = dodParentAgencies.some(p => parentUpper.includes(p)) ||
                    dodSubAgencies.some(s => subUpper.includes(s) || nameUpper.includes(s));

      return isDoD && !agency.hasSpecificOffice;
    });

    if (dodAgenciesNeedingDetail.length > 0) {
      const expandedAgencies: Agency[] = [];
      const genericDoDIds = new Set<string>();

      for (const genericAgency of dodAgenciesNeedingDetail) {
        const expanded = expandGenericDoDAgency(genericAgency, 5);
        if (expanded.length > 0) {
          // Map ExpandedDoDAgency to Agency type
          const mappedAgencies: Agency[] = expanded.map(e => ({
            ...e,
            agencyId: genericAgency.agencyId,
            agencyCode: genericAgency.agencyCode,
            subAgencyCode: genericAgency.subAgencyCode
          }));
          expandedAgencies.push(...mappedAgencies);
          genericDoDIds.add(genericAgency.id);
        }
      }

      if (expandedAgencies.length > 0) {
        const nonExpandedAgencies = agencies.filter(a => !genericDoDIds.has(a.id));
        agencies = [...nonExpandedAgencies, ...expandedAgencies];
        agencies.sort((a, b) => b.setAsideSpending - a.setAsideSpending);
      }
    }

    const totalSpending = agencies.reduce((sum, a) => sum + a.setAsideSpending, 0);

    console.log(`[Agencies Lookup] Final: ${agencies.length} agencies, $${totalSpending.toLocaleString()}`);

    return NextResponse.json({
      success: true,
      agencies,
      totalCount: agencies.length,
      totalSpending
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('[Agencies Lookup] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to lookup agencies'
    }, { status: 500, headers: corsHeaders });
  }
}

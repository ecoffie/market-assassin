/**
 * Federal Market Scanner API
 *
 * Answers 6 critical questions for any NAICS + Location:
 * 1. WHO is buying? (agencies, spending breakdown)
 * 2. HOW are they buying? (procurement methods, vehicles)
 * 3. WHO has the contracts now? (incumbents, recompete opportunities)
 * 4. WHAT opportunities exist RIGHT NOW? (SAM.gov, Grants, Forecasts)
 * 5. WHAT events should you attend? (industry days, matchmaking)
 * 6. WHO do I talk to? (OSDBU contacts, SBLOs, contracting officers)
 *
 * GET /api/market-scanner?naics=238220&state=GA
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Import existing helper functions
import {
  industryNames,
  getBorderingStates,
} from '@/lib/utils/usaspending-helpers';

import {
  searchContractAwards,
  getExpiringContracts,
} from '@/lib/sam/contract-awards';

import {
  searchEntities,
  findTeamingPartners,
} from '@/lib/sam/entity-api';

// Types
interface MarketScannerInput {
  naics: string;
  naicsDescription: string;
  state: string;
  stateName: string;
}

interface AgencyBuyer {
  name: string;
  annualSpend: number;
  department: string;
  location?: string;
}

interface ProcurementMethod {
  method: string;
  percentage: number;
  actionRequired: string;
}

interface Incumbent {
  company: string;
  agency: string;
  contractValue: number;
  expirationDate: string;
  isRecompete: boolean;
  setAside?: string;
  daysUntilExpiration?: number;
}

interface AvailableOpportunities {
  samGov: { count: number; types: string[] };
  grantsGov: { count: number };
  gsaEbuy: { count: number; note: string };
  forecasts: { count: number; timeframe: string };
}

interface FederalEvent {
  name: string;
  date: string;
  location: string;
  type: string;
}

interface Contact {
  agency: string;
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  office?: string;
}

interface MarketScannerResponse {
  input: MarketScannerInput;

  // 1. WHO is buying?
  whoIsBuying: {
    agencies: AgencyBuyer[];
    totalSpend: number;
    topBuyer: string;
    concentration: 'concentrated' | 'distributed' | 'balanced';
  };

  // 2. HOW are they buying?
  howAreTheyBuying: {
    breakdown: ProcurementMethod[];
    primaryMethod: string;
    visibilityGap: number;
    recommendation: string;
  };

  // 3. WHO has it now?
  whoHasItNow: {
    incumbents: Incumbent[];
    totalRecompetes: number;
    urgentRecompetes: number;
    lowCompetitionCount: number;
  };

  // 4. WHAT opportunities exist RIGHT NOW?
  whatIsAvailable: AvailableOpportunities;

  // 5. WHAT events should you attend?
  whatEvents: FederalEvent[];

  // 6. WHO do I talk to?
  whoToTalkTo: {
    osdubuContacts: Contact[];
    sbSpecialists: Contact[];
    contractingOfficers: Contact[];
    teamingPartners: Contact[];
  };

  generatedAt: string;
  processingTimeMs: number;
}

// State name lookup
const STATE_NAMES: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
  'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
  'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
  'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
  'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
  'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
  'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
  'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
  'DC': 'District of Columbia'
};

// Helper Functions
function getNaicsDescription(code: string): string {
  if (industryNames[code]) {
    return industryNames[code];
  }

  // Try prefix matches
  for (let i = code.length - 1; i >= 2; i--) {
    const prefix = code.substring(0, i);
    if (industryNames[prefix]) {
      return industryNames[prefix];
    }
  }

  return `NAICS ${code}`;
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

/**
 * 1. WHO is buying? - Fetch spending data from USASpending
 */
async function getWhoIsBuying(naics: string, states: string[]): Promise<MarketScannerResponse['whoIsBuying']> {
  try {
    const filters: Record<string, unknown> = {
      award_type_codes: ['A', 'B', 'C', 'D'],
      time_period: [
        {
          start_date: '2022-10-01',
          end_date: '2025-09-30',
        },
      ],
      naics_codes: [naics],
    };

    if (states.length > 0) {
      filters.place_of_performance_scope = 'domestic';
      filters.place_of_performance_locations = states.map((state) => ({
        country: 'USA',
        state,
      }));
    }

    const response = await fetch(
      'https://api.usaspending.gov/api/v2/search/spending_by_award/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters,
          fields: ['Awarding Agency', 'Awarding Sub Agency', 'Award Amount'],
          page: 1,
          limit: 100,
          order: 'desc',
          sort: 'Award Amount',
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) {
      throw new Error(`USASpending API error: ${response.status}`);
    }

    const data = await response.json();
    const awards = data.results || [];

    // Aggregate by agency
    const agencyMap = new Map<string, { spending: number; department: string }>();
    let totalSpend = 0;

    for (const award of awards) {
      const agency = award['Awarding Agency'] || 'Unknown';
      const department = award['Awarding Sub Agency'] || agency;
      const amount = award['Award Amount'] || 0;

      totalSpend += amount;

      const existing = agencyMap.get(agency) || { spending: 0, department };
      existing.spending += amount;
      agencyMap.set(agency, existing);
    }

    // Convert to array and sort
    const agencies: AgencyBuyer[] = Array.from(agencyMap.entries())
      .map(([name, data]) => ({
        name,
        annualSpend: data.spending,
        department: data.department,
      }))
      .sort((a, b) => b.annualSpend - a.annualSpend)
      .slice(0, 10);

    // Determine concentration
    const topAgencyPercent = agencies.length > 0 ? (agencies[0].annualSpend / totalSpend) * 100 : 0;
    let concentration: 'concentrated' | 'distributed' | 'balanced';
    if (topAgencyPercent > 60) {
      concentration = 'concentrated';
    } else if (topAgencyPercent < 30 && agencies.length > 5) {
      concentration = 'distributed';
    } else {
      concentration = 'balanced';
    }

    return {
      agencies,
      totalSpend,
      topBuyer: agencies.length > 0 ? agencies[0].name : 'Unknown',
      concentration,
    };
  } catch (error) {
    console.error('[WHO is buying error]', error);
    return {
      agencies: [],
      totalSpend: 0,
      topBuyer: 'Unknown',
      concentration: 'balanced',
    };
  }
}

/**
 * 2. HOW are they buying? - Analyze procurement methods
 */
async function getHowTheyAreBuying(
  naics: string,
  topAgencies: string[]
): Promise<MarketScannerResponse['howAreTheyBuying']> {
  try {
    // Fetch agency source data for top buying agencies
    const breakdown: ProcurementMethod[] = [];
    let totalSamPosted = 30; // Default assumption
    let hasGSASchedule = false;
    let hasIDIQ = false;

    // Load agency sources data
    const agencySourcesUrl = new URL('/api/agency-sources', process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000');
    agencySourcesUrl.searchParams.set('agencies', topAgencies.slice(0, 3).join(','));

    const response = await fetch(agencySourcesUrl.toString());
    if (response.ok) {
      const data = await response.json();

      if (data.success && data.agencies) {
        for (const agency of data.agencies) {
          if (agency.spendingBreakdown?.breakdown) {
            const patterns = agency.spendingBreakdown.breakdown;

            if (patterns.gsaSchedule && patterns.gsaSchedule > 20) {
              hasGSASchedule = true;
            }

            if (patterns.idiqVehicles && patterns.idiqVehicles > 15) {
              hasIDIQ = true;
            }

            if (patterns.samPosted) {
              totalSamPosted = Math.max(totalSamPosted, patterns.samPosted);
            }
          }
        }
      }
    }

    // Build breakdown
    if (hasGSASchedule) {
      breakdown.push({
        method: 'GSA Schedule',
        percentage: 40,
        actionRequired: 'Get on GSA Schedule (SIN research required)',
      });
    }

    if (hasIDIQ) {
      breakdown.push({
        method: 'IDIQ/BPA Vehicles',
        percentage: 30,
        actionRequired: 'Target vehicle holders for subcontracting',
      });
    }

    breakdown.push({
      method: 'Open SAM.gov Competitions',
      percentage: totalSamPosted,
      actionRequired: 'Monitor SAM.gov daily for RFPs/RFQs',
    });

    const hiddenMarket = 100 - totalSamPosted;
    if (hiddenMarket > 20) {
      breakdown.push({
        method: 'Direct Awards / Sole Source',
        percentage: hiddenMarket,
        actionRequired: 'Build agency relationships, capability statements',
      });
    }

    // Determine primary method
    const sortedBreakdown = [...breakdown].sort((a, b) => b.percentage - a.percentage);
    const primaryMethod = sortedBreakdown[0]?.method || 'SAM.gov Competitions';

    // Generate recommendation
    let recommendation = '';
    if (hiddenMarket > 70) {
      recommendation = `${hiddenMarket}% of spending is hidden from SAM.gov. Focus on GSA Schedule, IDIQ vehicles, and direct agency outreach.`;
    } else if (hiddenMarket > 40) {
      recommendation = `Mixed market: ${totalSamPosted}% visible on SAM.gov, ${hiddenMarket}% through vehicles/relationships. Dual approach needed.`;
    } else {
      recommendation = `${totalSamPosted}% visible on SAM.gov. Strong competitive posture and proposal quality are critical.`;
    }

    return {
      breakdown,
      primaryMethod,
      visibilityGap: hiddenMarket,
      recommendation,
    };
  } catch (error) {
    console.error('[HOW are they buying error]', error);
    return {
      breakdown: [
        {
          method: 'SAM.gov Competitions',
          percentage: 30,
          actionRequired: 'Monitor SAM.gov daily',
        },
      ],
      primaryMethod: 'SAM.gov Competitions',
      visibilityGap: 70,
      recommendation: 'Unable to determine procurement methods. Default to SAM.gov monitoring.',
    };
  }
}

/**
 * 3. WHO has it now? - Get incumbent contractors and recompete opportunities
 */
async function getWhoHasItNow(naics: string, states: string[]): Promise<MarketScannerResponse['whoHasItNow']> {
  try {
    // Get expiring contracts (18 months window for recompetes)
    const expiringContracts = await getExpiringContracts(naics, 18);

    const incumbents: Incumbent[] = expiringContracts.map((contract) => ({
      company: contract.recipientName,
      agency: contract.awardingAgencyName,
      contractValue: contract.currentTotalValueOfAward,
      expirationDate: contract.periodOfPerformanceCurrentEndDate,
      isRecompete: (contract.daysUntilExpiration || 999) <= 540, // 18 months
      setAside: contract.extentCompetedDescription,
      daysUntilExpiration: contract.daysUntilExpiration,
    }));

    const totalRecompetes = incumbents.filter((i) => i.isRecompete).length;
    const urgentRecompetes = incumbents.filter(
      (i) => i.isRecompete && (i.daysUntilExpiration || 999) <= 180
    ).length;
    const lowCompetitionCount = expiringContracts.filter(
      (c) => c.competitionLevel === 'low' || c.competitionLevel === 'sole_source'
    ).length;

    return {
      incumbents: incumbents.slice(0, 15),
      totalRecompetes,
      urgentRecompetes,
      lowCompetitionCount,
    };
  } catch (error) {
    console.error('[WHO has it now error]', error);
    return {
      incumbents: [],
      totalRecompetes: 0,
      urgentRecompetes: 0,
      lowCompetitionCount: 0,
    };
  }
}

/**
 * 4. WHAT opportunities exist RIGHT NOW?
 */
async function getWhatIsAvailable(naics: string, state?: string): Promise<AvailableOpportunities> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // SAM.gov opportunities
    let samCount = 0;
    let samTypes: string[] = [];

    if (process.env.SAM_API_KEY) {
      try {
        const params = new URLSearchParams({
          api_key: process.env.SAM_API_KEY,
          ncode: naics,
          ptype: 'p,r,k,o,s,i',
          limit: '100',
        });

        if (state) {
          params.set('state', state);
        }

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const formatDate = (d: Date) => {
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const yyyy = d.getFullYear();
          return `${mm}/${dd}/${yyyy}`;
        };
        params.set('postedFrom', formatDate(thirtyDaysAgo));
        params.set('postedTo', formatDate(new Date()));

        const samResponse = await fetch(
          `https://api.sam.gov/opportunities/v2/search?${params}`,
          { signal: AbortSignal.timeout(15000) }
        );

        if (samResponse.ok) {
          const samData = await samResponse.json();
          const opps = samData.opportunitiesData || [];
          samCount = opps.length;

          // Extract notice types
          const typeSet = new Set<string>();
          opps.forEach((opp: Record<string, unknown>) => {
            const type = opp.type as string;
            if (type) typeSet.add(type);
          });
          samTypes = Array.from(typeSet);
        }
      } catch (samError) {
        console.error('[SAM.gov fetch error]', samError);
      }
    }

    // Grants.gov
    let grantsCount = 0;
    try {
      const naicsDesc = getNaicsDescription(naics);
      const keywords = naicsDesc.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);

      const grantsResponse = await fetch(
        'https://apply07.grants.gov/grantsws/rest/opportunities/search',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oppStatuses: 'posted',
            rows: 25,
            sortBy: 'openDate|desc',
            keyword: keywords.slice(0, 3).join(' '),
          }),
          signal: AbortSignal.timeout(15000),
        }
      );

      if (grantsResponse.ok) {
        const grantsData = await grantsResponse.json();
        grantsCount = grantsData.oppHits?.length || 0;
      }
    } catch (grantsError) {
      console.error('[Grants.gov fetch error]', grantsError);
    }

    // Forecasts
    let forecastsCount = 0;
    try {
      const { count } = await supabase
        .from('agency_forecasts')
        .select('*', { count: 'exact', head: true })
        .eq('naics_code', naics);

      forecastsCount = count || 0;
    } catch (forecastError) {
      console.error('[Forecasts fetch error]', forecastError);
    }

    // GSA eBuy (mock - no public API)
    const gsaEbuyCount = 0;

    return {
      samGov: { count: samCount, types: samTypes },
      grantsGov: { count: grantsCount },
      gsaEbuy: { count: gsaEbuyCount, note: 'Requires GSA Schedule to access' },
      forecasts: { count: forecastsCount, timeframe: '6-18 months ahead' },
    };
  } catch (error) {
    console.error('[WHAT is available error]', error);
    return {
      samGov: { count: 0, types: [] },
      grantsGov: { count: 0 },
      gsaEbuy: { count: 0, note: 'Requires GSA Schedule' },
      forecasts: { count: 0, timeframe: '6-18 months' },
    };
  }
}

/**
 * 5. WHAT events should you attend?
 */
async function getWhatEvents(naics: string, state?: string): Promise<FederalEvent[]> {
  try {
    const eventsUrl = new URL('/api/federal-events', process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000');
    eventsUrl.searchParams.set('naics', naics);

    const response = await fetch(eventsUrl.toString());
    if (!response.ok) {
      throw new Error(`Events API error: ${response.status}`);
    }

    const data = await response.json();
    const events: FederalEvent[] = [];

    // Extract events from sources
    if (data.success && data.eventSources) {
      for (const source of data.eventSources.slice(0, 10)) {
        events.push({
          name: source.name,
          date: source.frequency,
          location: state ? `${state} or Virtual` : 'Various Locations',
          type: source.type,
        });
      }
    }

    return events;
  } catch (error) {
    console.error('[WHAT events error]', error);
    return [
      {
        name: 'OSDBU Events Calendar',
        date: 'Ongoing',
        location: 'Check agency websites',
        type: 'Industry Days / Matchmaking',
      },
    ];
  }
}

/**
 * 6. WHO do I talk to?
 */
async function getWhoToTalkTo(
  naics: string,
  topAgencies: string[],
  state?: string
): Promise<MarketScannerResponse['whoToTalkTo']> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // OSDBU contacts from contractor database
    const osdubuContacts: Contact[] = [];
    const { data: contractors } = await supabase
      .from('federal_contractors')
      .select('company, sblo_name, sblo_email, sblo_phone, agency')
      .in('agency', topAgencies.slice(0, 5))
      .limit(10);

    if (contractors) {
      contractors.forEach((c) => {
        osdubuContacts.push({
          agency: c.agency,
          name: c.sblo_name,
          title: 'Small Business Liaison',
          email: c.sblo_email,
          phone: c.sblo_phone,
        });
      });
    }

    // SB Specialists (using agency hierarchy)
    const sbSpecialists: Contact[] = topAgencies.slice(0, 5).map((agency) => ({
      agency,
      office: 'Office of Small and Disadvantaged Business Utilization',
    }));

    // Contracting Officers (placeholder - would need office search)
    const contractingOfficers: Contact[] = [];

    // Teaming partners from SAM.gov
    const teamingPartners: Contact[] = [];
    try {
      const partners = await findTeamingPartners(naics, undefined, state, 5);
      partners.forEach((p) => {
        const govPoc = p.pointsOfContact?.find((poc) => poc.type === 'Government');
        teamingPartners.push({
          agency: p.legalBusinessName,
          name: govPoc?.name,
          email: govPoc?.email,
          phone: govPoc?.phone,
        });
      });
    } catch (teamingError) {
      console.error('[Teaming partners error]', teamingError);
    }

    return {
      osdubuContacts: osdubuContacts.slice(0, 5),
      sbSpecialists,
      contractingOfficers,
      teamingPartners,
    };
  } catch (error) {
    console.error('[WHO to talk to error]', error);
    return {
      osdubuContacts: [],
      sbSpecialists: [],
      contractingOfficers: [],
      teamingPartners: [],
    };
  }
}

// Main Handler
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);

  const naics = searchParams.get('naics');
  const state = searchParams.get('state');

  // Validate
  if (!naics) {
    return NextResponse.json(
      {
        success: false,
        error: 'naics parameter is required',
        usage: 'GET /api/market-scanner?naics=238220&state=GA',
      },
      { status: 400 }
    );
  }

  if (naics.length < 5) {
    return NextResponse.json(
      {
        success: false,
        error: 'NAICS code must be at least 5 digits for accurate results',
      },
      { status: 400 }
    );
  }

  try {
    // Build search states
    const searchStates: string[] = [];
    if (state) {
      searchStates.push(state.toUpperCase());
      const bordering = getBorderingStates(state.toUpperCase());
      searchStates.push(...bordering.slice(0, 2));
    }

    console.log(`[Market Scanner] NAICS: ${naics}, States: ${searchStates.join(', ') || 'nationwide'}`);

    // Fetch all 6 questions in parallel
    const [whoIsBuying, howAreTheyBuying, whoHasItNow, whatIsAvailable, whatEvents, whoToTalkTo] =
      await Promise.all([
        getWhoIsBuying(naics, searchStates),
        // Pass top agencies once we have them
        Promise.resolve(null).then(async () => {
          const buyers = await getWhoIsBuying(naics, searchStates);
          return getHowTheyAreBuying(
            naics,
            buyers.agencies.slice(0, 5).map((a) => a.name)
          );
        }),
        getWhoHasItNow(naics, searchStates),
        getWhatIsAvailable(naics, state || undefined),
        getWhatEvents(naics, state || undefined),
        // Pass top agencies once we have them
        Promise.resolve(null).then(async () => {
          const buyers = await getWhoIsBuying(naics, searchStates);
          return getWhoToTalkTo(
            naics,
            buyers.agencies.slice(0, 5).map((a) => a.name),
            state || undefined
          );
        }),
      ]);

    const response: MarketScannerResponse = {
      input: {
        naics,
        naicsDescription: getNaicsDescription(naics),
        state: state?.toUpperCase() || 'Nationwide',
        stateName: state ? STATE_NAMES[state.toUpperCase()] || state : 'All States',
      },
      whoIsBuying,
      howAreTheyBuying,
      whoHasItNow,
      whatIsAvailable,
      whatEvents,
      whoToTalkTo,
      generatedAt: new Date().toISOString(),
      processingTimeMs: Date.now() - startTime,
    };

    return NextResponse.json({
      success: true,
      ...response,
    });
  } catch (error) {
    console.error('[Market Scanner Error]', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate market scan',
        processingTimeMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

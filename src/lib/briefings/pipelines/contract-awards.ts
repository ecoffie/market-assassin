/**
 * Contract Awards Pipeline
 *
 * Fetches recent contract awards from USAspending for market intelligence.
 * Returns new awards, modifications, IDV activity, and spending signals.
 */

interface ContractAward {
  awardId: string;
  piid: string;
  recipientName: string;
  recipientUei: string | null;

  // Award details
  awardAmount: number;
  totalObligatedAmount: number;
  naicsCode: string;
  naicsDescription: string;
  psc: string;
  pscDescription: string;

  // Agency info
  awardingAgency: string;
  awardingSubAgency: string;
  awardingOffice: string;
  fundingAgency: string;

  // Dates
  startDate: string;
  endDate: string;
  lastModifiedDate: string;
  periodOfPerformanceCurrent: string;

  // Type
  awardType: string;
  isIdv: boolean;
  baseOrOption: string;

  // Set-aside
  setAsideType: string | null;

  // Location
  placeOfPerformanceState: string;
  placeOfPerformanceCity: string;

  // Competition
  extentCompeted: string;
  numberOfOffers: number;

  // Calculated
  isNewAward: boolean;
  isModification: boolean;
  modificationReason: string | null;
}

interface AwardsSearchParams {
  naicsCodes?: string[];
  agencies?: string[];
  recipients?: string[];
  awardedFrom?: string;
  awardedTo?: string;
  minAmount?: number;
  limit?: number;
}

interface AwardsSearchResult {
  awards: ContractAward[];
  totalCount: number;
  totalSpending: number;
  fetchedAt: string;
}

// USAspending API base URL
const USASPENDING_API_BASE = 'https://api.usaspending.gov/api/v2';

/**
 * Fetch contract awards from USAspending
 */
export async function fetchContractAwards(
  params: AwardsSearchParams
): Promise<AwardsSearchResult> {
  const {
    naicsCodes = [],
    agencies = [],
    recipients = [],
    awardedFrom,
    awardedTo,
    minAmount = 0,
    limit = 200,
  } = params;

  // Build filters
  const filters: Record<string, unknown> = {
    award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
    time_period: [
      {
        start_date: awardedFrom || getDateDaysAgo(7),
        end_date: awardedTo || getTodayDate(),
      },
    ],
  };

  // Add NAICS filter
  if (naicsCodes.length > 0) {
    filters.naics_codes = naicsCodes;
  }

  // Add recipient filter
  if (recipients.length > 0) {
    filters.recipient_search_text = recipients;
  }

  // Add agency filter
  if (agencies.length > 0) {
    filters.agencies = agencies.map(a => ({
      type: 'awarding',
      tier: 'subtier',
      name: a,
    }));
  }

  const fields = [
    'Award ID',
    'Recipient Name',
    'Award Amount',
    'Total Obligation',
    'Awarding Agency',
    'Awarding Sub Agency',
    'Awarding Office',
    'Funding Agency',
    'NAICS Code',
    'NAICS Description',
    'Product or Service Code',
    'Product or Service Code Description',
    'Start Date',
    'End Date',
    'Last Modified Date',
    'Award Type',
    'Set-Aside Type',
    'Place of Performance State Code',
    'Place of Performance City Code',
    'Extent Competed',
    'Number of Offers Received',
  ];

  console.log(`[Awards Pipeline] Fetching recent awards for NAICS: ${naicsCodes.join(', ') || 'all'}`);

  try {
    const response = await fetch(`${USASPENDING_API_BASE}/search/spending_by_award/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filters,
        fields,
        page: 1,
        limit,
        order: 'desc',
        sort: 'Award Amount',
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`USAspending API error: ${response.status}`);
    }

    const data = await response.json();

    // Parse awards
    const awards: ContractAward[] = (data.results || [])
      .filter((a: Record<string, unknown>) => (a['Award Amount'] as number || 0) >= minAmount)
      .map((a: Record<string, unknown>) => ({
        awardId: a['Award ID'] as string || '',
        piid: a['Award ID'] as string || '',
        recipientName: a['Recipient Name'] as string || '',
        recipientUei: null,

        awardAmount: a['Award Amount'] as number || 0,
        totalObligatedAmount: a['Total Obligation'] as number || 0,
        naicsCode: a['NAICS Code'] as string || '',
        naicsDescription: a['NAICS Description'] as string || '',
        psc: a['Product or Service Code'] as string || '',
        pscDescription: a['Product or Service Code Description'] as string || '',

        awardingAgency: a['Awarding Agency'] as string || '',
        awardingSubAgency: a['Awarding Sub Agency'] as string || '',
        awardingOffice: a['Awarding Office'] as string || '',
        fundingAgency: a['Funding Agency'] as string || '',

        startDate: a['Start Date'] as string || '',
        endDate: a['End Date'] as string || '',
        lastModifiedDate: a['Last Modified Date'] as string || '',
        periodOfPerformanceCurrent: '',

        awardType: a['Award Type'] as string || '',
        isIdv: ['A', 'B', 'C'].includes(a['Award Type'] as string || ''),
        baseOrOption: '',

        setAsideType: a['Set-Aside Type'] as string || null,

        placeOfPerformanceState: a['Place of Performance State Code'] as string || '',
        placeOfPerformanceCity: a['Place of Performance City Code'] as string || '',

        extentCompeted: a['Extent Competed'] as string || '',
        numberOfOffers: a['Number of Offers Received'] as number || 0,

        isNewAward: isRecentlyAwarded(a['Start Date'] as string || ''),
        isModification: false, // Would need to check action type
        modificationReason: null,
      }));

    const totalSpending = awards.reduce((sum, a) => sum + a.awardAmount, 0);

    console.log(`[Awards Pipeline] Retrieved ${awards.length} awards, $${totalSpending.toLocaleString()} total`);

    return {
      awards,
      totalCount: data.page_metadata?.total || awards.length,
      totalSpending,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Awards Pipeline] Error fetching awards:', error);
    throw error;
  }
}

/**
 * Fetch awards for a specific user's watchlist
 */
export async function fetchAwardsForUser(
  userProfile: {
    naics_codes: string[];
    agencies: string[];
    watched_companies: string[];
  }
): Promise<AwardsSearchResult> {
  return fetchContractAwards({
    naicsCodes: userProfile.naics_codes?.slice(0, 10) || [],
    agencies: userProfile.agencies?.slice(0, 10) || [],
    recipients: userProfile.watched_companies?.slice(0, 10) || [],
    awardedFrom: getDateDaysAgo(7),
    minAmount: 25000, // Filter out micro-purchases
    limit: 200,
  });
}

/**
 * Compare two snapshots and identify changes
 */
export function diffAwards(
  today: ContractAward[],
  yesterday: ContractAward[]
): {
  newAwards: ContractAward[];
  significantMods: Array<{
    award: ContractAward;
    changes: string[];
  }>;
  competitorWins: ContractAward[];
  spendingShifts: Array<{
    agency: string;
    previousWeekSpending: number;
    currentWeekSpending: number;
    changePercent: number;
  }>;
} {
  const yesterdayMap = new Map(yesterday.map(a => [a.awardId, a]));
  const todayMap = new Map(today.map(a => [a.awardId, a]));

  // NEW AWARDS: not in yesterday
  const newAwards = today.filter(a => !yesterdayMap.has(a.awardId));

  // SIGNIFICANT MODS: >$1M change or scope change
  const significantMods: Array<{ award: ContractAward; changes: string[] }> = [];
  for (const award of today) {
    const prev = yesterdayMap.get(award.awardId);
    if (!prev) continue;

    const changes: string[] = [];
    const amountDiff = award.totalObligatedAmount - prev.totalObligatedAmount;

    if (Math.abs(amountDiff) >= 1000000) {
      changes.push(`obligation_changed: ${amountDiff > 0 ? '+' : ''}$${amountDiff.toLocaleString()}`);
    }

    if (award.endDate !== prev.endDate) {
      changes.push(`period_extended: ${prev.endDate} → ${award.endDate}`);
    }

    if (changes.length > 0) {
      significantMods.push({ award, changes });
    }
  }

  // COMPETITOR WINS: will be populated by user's watched companies
  const competitorWins: ContractAward[] = []; // Populated elsewhere with user context

  // SPENDING SHIFTS: aggregate by agency
  const todayByAgency = aggregateByAgency(today);
  const yesterdayByAgency = aggregateByAgency(yesterday);

  const spendingShifts: Array<{
    agency: string;
    previousWeekSpending: number;
    currentWeekSpending: number;
    changePercent: number;
  }> = [];

  for (const [agency, currentSpending] of Object.entries(todayByAgency)) {
    const previousSpending = yesterdayByAgency[agency] || 0;
    if (previousSpending === 0) continue;

    const changePercent = ((currentSpending - previousSpending) / previousSpending) * 100;

    if (Math.abs(changePercent) >= 10) {
      spendingShifts.push({
        agency,
        previousWeekSpending: previousSpending,
        currentWeekSpending: currentSpending,
        changePercent,
      });
    }
  }

  return {
    newAwards,
    significantMods,
    competitorWins,
    spendingShifts,
  };
}

/**
 * Score an award for relevance to ghosting/intelligence
 */
export function scoreAward(
  award: ContractAward,
  userProfile: {
    naics_codes: string[];
    agencies: string[];
    watched_companies: string[];
  }
): {
  relevanceScore: number;
  signals: string[];
} {
  let score = 0;
  const signals: string[] = [];

  // NAICS match
  if (userProfile.naics_codes.includes(award.naicsCode)) {
    score += 30;
    signals.push('exact_naics_match');
  }

  // Agency match
  const awardAgency = `${award.awardingAgency} ${award.awardingSubAgency}`.toLowerCase();
  if (userProfile.agencies.some(a => awardAgency.includes(a.toLowerCase()))) {
    score += 25;
    signals.push('target_agency');
  }

  // Competitor won
  if (userProfile.watched_companies.some(c =>
    award.recipientName.toLowerCase().includes(c.toLowerCase())
  )) {
    score += 20;
    signals.push('competitor_won');
  }

  // High value
  if (award.awardAmount >= 10000000) {
    score += 15;
    signals.push('high_value_award');
  } else if (award.awardAmount >= 1000000) {
    score += 10;
    signals.push('million_dollar_award');
  }

  // Small business set-aside
  if (award.setAsideType) {
    score += 10;
    signals.push('small_business_setaside');
  }

  // Low competition (ghosting opportunity)
  if (award.numberOfOffers <= 2) {
    score += 15;
    signals.push('low_competition');
  }

  // Recent award
  if (award.isNewAward) {
    score += 10;
    signals.push('new_this_week');
  }

  return {
    relevanceScore: Math.min(score, 100),
    signals,
  };
}

// Helper functions
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

function isRecentlyAwarded(dateStr: string): boolean {
  if (!dateStr) return false;
  const awardDate = new Date(dateStr);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return awardDate >= sevenDaysAgo;
}

function aggregateByAgency(awards: ContractAward[]): Record<string, number> {
  const byAgency: Record<string, number> = {};
  for (const award of awards) {
    const key = award.awardingSubAgency || award.awardingAgency;
    byAgency[key] = (byAgency[key] || 0) + award.awardAmount;
  }
  return byAgency;
}

export type { ContractAward, AwardsSearchParams, AwardsSearchResult };

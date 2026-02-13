import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 300; // 5 minutes (Vercel Pro)

const USASPENDING_API = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

const FIELDS = [
  'Award ID',
  'Recipient Name',
  'Award Amount',
  'Awarding Agency',
  'Awarding Office',
  'NAICS Code',
  'NAICS Description',
  'Start Date',
  'End Date',
  'Place of Performance State Code',
];

interface RawAward {
  'Award ID': string;
  'Recipient Name': string;
  'Award Amount': number;
  'Awarding Agency': string;
  'Awarding Office': string;
  'NAICS Code': string;
  'NAICS Description': string;
  'Start Date': string;
  'End Date': string;
  'Place of Performance State Code': string;
}

interface ContractGroup {
  Recipient: string;
  Agency: string;
  Office: string;
  NAICS: string;
  contracts: RawAward[];
  states: string[];
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `;
}

/**
 * GET /api/admin/build-recompete-data?password=...&mode=preview|build
 *
 * Fetches expiring contracts from USASpending API with Place of Performance State.
 * Outputs data in contracts-data.js format for the Recompete Tracker.
 *
 * Query params:
 * - password: admin password (required)
 * - mode: 'preview' (5 pages, 10 results shown) or 'build' (full fetch)
 * - pages: max pages to fetch from USASpending (default: 100 for build, 5 for preview)
 * - start: action date start (default: 2023-01-01)
 * - end: action date end (default: 2026-12-31)
 * - expireAfter: only include contracts expiring after this date (default: today)
 * - expireBefore: only include contracts expiring before this date (default: 2027-12-31)
 */
export async function GET(request: NextRequest) {
  const ip = getClientIP(request);
  const rl = await checkAdminRateLimit(ip);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = searchParams.get('mode') || 'preview';
  const maxPages = parseInt(searchParams.get('pages') || (mode === 'build' ? '100' : '5'));
  const actionStart = searchParams.get('start') || '2023-01-01';
  const actionEnd = searchParams.get('end') || '2026-12-31';
  const expireAfterStr = searchParams.get('expireAfter');
  const expireBeforeStr = searchParams.get('expireBefore') || '2027-12-31';

  const expireAfter = expireAfterStr ? new Date(expireAfterStr) : new Date();
  const expireBefore = new Date(expireBeforeStr);

  const filters = {
    award_type_codes: ['A', 'B', 'C', 'D'],
    time_period: [
      { start_date: actionStart, end_date: actionEnd }
    ]
  };

  // Fetch all pages from USASpending
  const allAwards: RawAward[] = [];
  let pagesActuallyFetched = 0;
  let fetchErrors = 0;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const response = await fetch(USASPENDING_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters,
          fields: FIELDS,
          page,
          limit: 100,
          order: 'desc',
          sort: 'Award Amount'
        }),
        signal: AbortSignal.timeout(30000)
      });

      const data = await response.json();
      pagesActuallyFetched = page;

      if (data?.results) {
        allAwards.push(...data.results);
        if (data.results.length < 100) break; // Last page
      } else {
        break;
      }
    } catch (error) {
      console.error(`Error fetching page ${page}:`, error);
      fetchErrors++;
      if (fetchErrors >= 3) break; // Too many errors, stop
      continue;
    }

    // Rate limit delay between requests
    if (page < maxPages) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  // Filter for contracts expiring in target range
  const expiringAwards = allAwards.filter(award => {
    const endDate = new Date(award['End Date']);
    if (isNaN(endDate.getTime())) return false;
    return endDate > expireAfter && endDate <= expireBefore;
  });

  // Group by Recipient + Agency + NAICS Code
  const groups: Record<string, ContractGroup> = {};

  for (const award of expiringAwards) {
    const recipient = award['Recipient Name'] || 'Unknown';
    const agency = award['Awarding Agency'] || 'Unknown';
    const naicsCode = award['NAICS Code'] || '';
    const key = `${recipient}|||${agency}|||${naicsCode}`;

    if (!groups[key]) {
      groups[key] = {
        Recipient: recipient,
        Agency: agency,
        Office: award['Awarding Office'] || '',
        NAICS: naicsCode
          ? `${naicsCode}${award['NAICS Description'] ? ' - ' + award['NAICS Description'].toUpperCase() : ''}`
          : '',
        contracts: [],
        states: []
      };
    }

    groups[key].contracts.push(award);

    const stateCode = award['Place of Performance State Code'];
    if (stateCode && stateCode.trim()) {
      groups[key].states.push(stateCode.trim());
    }
  }

  // Build output records
  const output = Object.values(groups).map(group => {
    // Most common state in the group
    const stateCounts: Record<string, number> = {};
    group.states.forEach(s => { stateCounts[s] = (stateCounts[s] || 0) + 1; });
    const sortedStates = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]);
    const state = sortedStates[0]?.[0] || '';

    // Sum total value
    const totalValue = group.contracts.reduce(
      (sum, c) => sum + (typeof c['Award Amount'] === 'number' ? c['Award Amount'] : parseFloat(String(c['Award Amount'])) || 0),
      0
    );

    // Earliest expiration
    const endDates = group.contracts
      .map(c => new Date(c['End Date']))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    // Earliest start date
    const startDates = group.contracts
      .map(c => new Date(c['Start Date']))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    // Award ID display
    const awardIds = [...new Set(group.contracts.map(c => c['Award ID']))];
    const awardIdDisplay = awardIds.length > 1
      ? `${awardIds[0]} (+${awardIds.length - 1} more)`
      : awardIds[0] || '';

    return {
      Recipient: group.Recipient,
      Agency: group.Agency,
      Office: group.Office,
      NAICS: group.NAICS,
      State: state,
      'Total Value': formatCurrency(totalValue),
      'Contract Count': group.contracts.length,
      Expiration: endDates.length > 0 ? formatDate(endDates[0].toISOString()) : '',
      'Award ID': awardIdDisplay,
      'Start Date': startDates.length > 0 ? formatDate(startDates[0].toISOString()) : '',
      Contracts: group.contracts.map(c => ({
        'Award ID': c['Award ID'],
        'Start Date': formatDate(c['Start Date']),
        Expiration: formatDate(c['End Date']),
        Value: formatCurrency(
          typeof c['Award Amount'] === 'number' ? c['Award Amount'] : parseFloat(String(c['Award Amount'])) || 0
        )
      }))
    };
  });

  // Sort by total value descending
  output.sort((a, b) => {
    const aVal = parseFloat(a['Total Value'].replace(/[$,\s]/g, '')) || 0;
    const bVal = parseFloat(b['Total Value'].replace(/[$,\s]/g, '')) || 0;
    return bVal - aVal;
  });

  // Unique states for reference
  const uniqueStates = [...new Set(output.map(r => r.State).filter(Boolean))].sort();

  const format = searchParams.get('format');

  // Return as downloadable .js file
  if (format === 'js' && mode === 'build') {
    const jsContent = `const expiringContractsData = ${JSON.stringify(output)};`;
    return new Response(jsContent, {
      headers: {
        'Content-Type': 'application/javascript',
        'Content-Disposition': `attachment; filename="contracts-data.js"`,
      }
    });
  }

  const result = {
    success: true,
    mode,
    stats: {
      rawAwardsFetched: allAwards.length,
      pagesActuallyFetched,
      fetchErrors,
      expiringAwardsInRange: expiringAwards.length,
      groupedRecords: output.length,
      uniqueStates: uniqueStates.length,
      states: uniqueStates,
      filters: {
        actionDateRange: `${actionStart} to ${actionEnd}`,
        expirationRange: `${expireAfter.toISOString().split('T')[0]} to ${expireBeforeStr}`,
        maxPages
      }
    },
    data: mode === 'build' ? output : output.slice(0, 10)
  };

  return NextResponse.json(result);
}

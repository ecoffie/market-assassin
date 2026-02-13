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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ExistingContract { [key: string]: any }

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `;
}

/**
 * Fetch pages from USASpending API and collect all awards
 */
async function fetchUSASpendingAwards(maxPages: number, actionStart: string, actionEnd: string): Promise<{
  awards: RawAward[];
  pagesActuallyFetched: number;
  fetchErrors: number;
}> {
  const filters = {
    award_type_codes: ['A', 'B', 'C', 'D'],
    time_period: [{ start_date: actionStart, end_date: actionEnd }]
  };

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
        if (data.results.length < 100) break;
      } else {
        break;
      }
    } catch (error) {
      console.error(`Error fetching page ${page}:`, error);
      fetchErrors++;
      if (fetchErrors >= 3) break;
      continue;
    }

    if (page < maxPages) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  return { awards: allAwards, pagesActuallyFetched, fetchErrors };
}

/**
 * Build a state lookup map from USASpending awards.
 * Key: normalized "recipient|||agency" → state code
 * Also builds Award ID → state lookup.
 */
function buildStateLookup(awards: RawAward[]): {
  byRecipientAgency: Map<string, string>;
  byAwardId: Map<string, string>;
} {
  const recipientAgencyStates = new Map<string, Map<string, number>>();
  const awardIdStates = new Map<string, string>();

  for (const award of awards) {
    const state = award['Place of Performance State Code']?.trim();
    if (!state) continue;

    // Award ID lookup
    if (award['Award ID']) {
      awardIdStates.set(award['Award ID'].trim(), state);
    }

    // Recipient + Agency lookup (accumulate counts for most common state)
    const key = `${(award['Recipient Name'] || '').trim().toUpperCase()}|||${(award['Awarding Agency'] || '').trim().toUpperCase()}`;
    if (!recipientAgencyStates.has(key)) {
      recipientAgencyStates.set(key, new Map());
    }
    const counts = recipientAgencyStates.get(key)!;
    counts.set(state, (counts.get(state) || 0) + 1);
  }

  // Resolve to most common state per recipient+agency
  const byRecipientAgency = new Map<string, string>();
  for (const [key, counts] of recipientAgencyStates) {
    let bestState = '';
    let bestCount = 0;
    for (const [st, ct] of counts) {
      if (ct > bestCount) { bestState = st; bestCount = ct; }
    }
    byRecipientAgency.set(key, bestState);
  }

  return { byRecipientAgency, byAwardId: awardIdStates };
}

/**
 * GET /api/admin/build-recompete-data?password=...&mode=preview|build|enrich
 *
 * Modes:
 * - preview: Quick test (5 pages, 10 results shown)
 * - build: Full rebuild from USASpending (replaces all data)
 * - enrich: Fetches live contracts-data.js, adds State from USASpending, returns enriched file
 *
 * Query params:
 * - password: admin password (required)
 * - mode: preview | build | enrich
 * - format: 'js' to get downloadable contracts-data.js file (build/enrich modes)
 * - pages: max USASpending pages (default: 100 for build/enrich, 5 for preview)
 * - start: action date start (default: 2023-01-01)
 * - end: action date end (default: 2026-12-31)
 * - expireAfter: filter contracts expiring after (default: today, build mode only)
 * - expireBefore: filter contracts expiring before (default: 2027-12-31, build mode only)
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
  const format = searchParams.get('format');
  const maxPages = parseInt(searchParams.get('pages') || (mode === 'preview' ? '5' : '100'));
  const actionStart = searchParams.get('start') || '2023-01-01';
  const actionEnd = searchParams.get('end') || '2026-12-31';

  // ─── ENRICH MODE ───
  // Fetches existing contracts-data.js from live site, adds State field using USASpending lookup
  if (mode === 'enrich') {
    // Step 1: Fetch existing contracts-data.js from live site
    let existingContracts: ExistingContract[];
    try {
      const liveUrl = `${new URL(request.url).origin}/contracts-data.js?v=${Date.now()}`;
      const resp = await fetch(liveUrl, { signal: AbortSignal.timeout(15000) });
      const text = await resp.text();
      // Parse: strip "const expiringContractsData = " prefix and trailing ";"
      const jsonStr = text.replace(/^[^[]*/, '').replace(/;?\s*$/, '');
      existingContracts = JSON.parse(jsonStr);
    } catch (error) {
      return NextResponse.json({
        error: 'Failed to fetch/parse existing contracts-data.js',
        details: String(error)
      }, { status: 500 });
    }

    // Step 2: Fetch state data from USASpending
    const { awards, pagesActuallyFetched, fetchErrors } = await fetchUSASpendingAwards(maxPages, actionStart, actionEnd);

    // Step 3: Build state lookup maps
    const { byRecipientAgency, byAwardId } = buildStateLookup(awards);

    // Step 4: Merge states into existing contracts
    let matched = 0;
    let matchedByAwardId = 0;
    let matchedByRecipient = 0;

    for (const contract of existingContracts) {
      if (contract.State) continue; // Already has state, skip

      // Try matching by Award ID first (most precise)
      const primaryAwardId = (contract['Award ID'] || '').split(' (')[0].split(' +')[0].trim();
      if (primaryAwardId && byAwardId.has(primaryAwardId)) {
        contract.State = byAwardId.get(primaryAwardId);
        matched++;
        matchedByAwardId++;
        continue;
      }

      // Try matching individual contracts' Award IDs
      if (contract.Contracts && Array.isArray(contract.Contracts)) {
        for (const sub of contract.Contracts) {
          const subId = (sub['Award ID'] || '').trim();
          if (subId && byAwardId.has(subId)) {
            contract.State = byAwardId.get(subId);
            matched++;
            matchedByAwardId++;
            break;
          }
        }
        if (contract.State) continue;
      }

      // Fallback: match by Recipient + Agency
      const key = `${(contract.Recipient || '').trim().toUpperCase()}|||${(contract.Agency || '').trim().toUpperCase()}`;
      if (byRecipientAgency.has(key)) {
        contract.State = byRecipientAgency.get(key);
        matched++;
        matchedByRecipient++;
      }
    }

    const totalWithState = existingContracts.filter(c => c.State).length;
    const uniqueStates = [...new Set(existingContracts.map(c => c.State).filter(Boolean))].sort();

    // Return as downloadable .js file
    if (format === 'js') {
      const jsContent = `const expiringContractsData = ${JSON.stringify(existingContracts)};`;
      return new Response(jsContent, {
        headers: {
          'Content-Type': 'application/javascript',
          'Content-Disposition': 'attachment; filename="contracts-data.js"',
        }
      });
    }

    return NextResponse.json({
      success: true,
      mode: 'enrich',
      stats: {
        existingRecords: existingContracts.length,
        usaSpendingAwardsFetched: awards.length,
        pagesActuallyFetched,
        fetchErrors,
        stateLookupsBuilt: {
          byAwardId: byAwardId.size,
          byRecipientAgency: byRecipientAgency.size
        },
        matched,
        matchedByAwardId,
        matchedByRecipient,
        totalWithState,
        totalWithoutState: existingContracts.length - totalWithState,
        coveragePercent: ((totalWithState / existingContracts.length) * 100).toFixed(1) + '%',
        uniqueStates: uniqueStates.length,
        states: uniqueStates
      },
      // Show first 10 enriched records as preview
      sample: existingContracts.slice(0, 10).map(c => ({
        Recipient: c.Recipient,
        Agency: c.Agency,
        State: c.State || '(none)',
        'Total Value': c['Total Value']
      }))
    });
  }

  // ─── BUILD / PREVIEW MODE ───
  const expireAfterStr = searchParams.get('expireAfter');
  const expireBeforeStr = searchParams.get('expireBefore') || '2027-12-31';
  const expireAfter = expireAfterStr ? new Date(expireAfterStr) : new Date();
  const expireBefore = new Date(expireBeforeStr);

  const { awards: allAwards, pagesActuallyFetched, fetchErrors } = await fetchUSASpendingAwards(maxPages, actionStart, actionEnd);

  // Filter for contracts expiring in target range
  const expiringAwards = allAwards.filter(award => {
    const endDate = new Date(award['End Date']);
    if (isNaN(endDate.getTime())) return false;
    return endDate > expireAfter && endDate <= expireBefore;
  });

  // Group by Recipient + Agency + NAICS Code
  const groups: Record<string, { Recipient: string; Agency: string; Office: string; NAICS: string; contracts: RawAward[]; states: string[] }> = {};

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
    if (stateCode?.trim()) groups[key].states.push(stateCode.trim());
  }

  // Build output records
  const output = Object.values(groups).map(group => {
    const stateCounts: Record<string, number> = {};
    group.states.forEach(s => { stateCounts[s] = (stateCounts[s] || 0) + 1; });
    const sortedStates = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]);
    const state = sortedStates[0]?.[0] || '';

    const totalValue = group.contracts.reduce(
      (sum, c) => sum + (typeof c['Award Amount'] === 'number' ? c['Award Amount'] : parseFloat(String(c['Award Amount'])) || 0),
      0
    );

    const endDates = group.contracts.map(c => new Date(c['End Date'])).filter(d => !isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
    const startDates = group.contracts.map(c => new Date(c['Start Date'])).filter(d => !isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());

    const awardIds = [...new Set(group.contracts.map(c => c['Award ID']))];
    const awardIdDisplay = awardIds.length > 1 ? `${awardIds[0]} (+${awardIds.length - 1} more)` : awardIds[0] || '';

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
        Value: formatCurrency(typeof c['Award Amount'] === 'number' ? c['Award Amount'] : parseFloat(String(c['Award Amount'])) || 0)
      }))
    };
  });

  output.sort((a, b) => {
    const aVal = parseFloat(a['Total Value'].replace(/[$,\s]/g, '')) || 0;
    const bVal = parseFloat(b['Total Value'].replace(/[$,\s]/g, '')) || 0;
    return bVal - aVal;
  });

  const uniqueStates = [...new Set(output.map(r => r.State).filter(Boolean))].sort();

  if (format === 'js' && mode === 'build') {
    const jsContent = `const expiringContractsData = ${JSON.stringify(output)};`;
    return new Response(jsContent, {
      headers: {
        'Content-Type': 'application/javascript',
        'Content-Disposition': 'attachment; filename="contracts-data.js"',
      }
    });
  }

  return NextResponse.json({
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
  });
}

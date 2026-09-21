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

/** Normalize an Award ID for fuzzy matching: uppercase, strip whitespace and dashes */
function normalizeAwardId(id: string): string {
  return id.trim().toUpperCase().replace(/[-\s]/g, '');
}

/** Normalize a recipient name: uppercase, strip common suffixes and trailing punctuation */
function normalizeRecipientName(name: string): string {
  const SUFFIXES = /\b(INCORPORATED|CORPORATION|COMPANY|LIMITED|PLLC|LLC|INC|CORP|LLP|PLC|LTD|LP|CO|PC)\b\.?/g;
  return name.trim().toUpperCase()
    .replace(SUFFIXES, '')
    .replace(/[,.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch pages from USASpending API and collect all awards
 */
async function fetchUSASpendingAwards(
  maxPages: number,
  actionStart: string,
  actionEnd: string,
  sortField: string = 'Award Amount'
): Promise<{
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
          sort: sortField
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
      console.error(`Error fetching page ${page} (sort: ${sortField}):`, error);
      fetchErrors++;
      if (fetchErrors >= 5) break;
      // Back off after errors
      await new Promise(resolve => setTimeout(resolve, 500 * fetchErrors));
      continue;
    }

    if (page < maxPages) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  return { awards: allAwards, pagesActuallyFetched, fetchErrors };
}

/**
 * Targeted fetch: multiple batches with different sort orders to maximize data diversity
 */
async function fetchTargetedAwards(
  maxPagesPerBatch: number,
  actionStart: string,
  actionEnd: string
): Promise<{
  awards: RawAward[];
  totalPagesFetched: number;
  totalFetchErrors: number;
  batchStats: { sort: string; awards: number; pages: number }[];
}> {
  const sortFields = ['Award Amount', 'Recipient Name', 'Last Modified Date'];
  const seenAwardIds = new Set<string>();
  const allAwards: RawAward[] = [];
  let totalPagesFetched = 0;
  let totalFetchErrors = 0;
  const batchStats: { sort: string; awards: number; pages: number }[] = [];

  for (const sortField of sortFields) {
    const batch = await fetchUSASpendingAwards(maxPagesPerBatch, actionStart, actionEnd, sortField);
    totalPagesFetched += batch.pagesActuallyFetched;
    totalFetchErrors += batch.fetchErrors;

    // Deduplicate across batches by Award ID
    let newCount = 0;
    for (const award of batch.awards) {
      const id = award['Award ID'];
      if (id && seenAwardIds.has(id)) continue;
      if (id) seenAwardIds.add(id);
      allAwards.push(award);
      newCount++;
    }

    batchStats.push({ sort: sortField, awards: newCount, pages: batch.pagesActuallyFetched });
  }

  return { awards: allAwards, totalPagesFetched, totalFetchErrors, batchStats };
}

/**
 * Build state lookup maps from USASpending awards.
 * Returns exact and normalized maps for Award ID, Recipient+Agency, and Recipient-only fallback.
 */
function buildStateLookup(awards: RawAward[]): {
  byAwardId: Map<string, string>;
  byNormalizedAwardId: Map<string, string>;
  byRecipientAgency: Map<string, string>;
  byNormalizedRecipientAgency: Map<string, string>;
  byRecipientOnly: Map<string, string>;
} {
  const awardIdStates = new Map<string, string>();
  const normalizedAwardIdStates = new Map<string, string>();
  const recipientAgencyStates = new Map<string, Map<string, number>>();
  const normalizedRecipientAgencyStates = new Map<string, Map<string, number>>();
  const recipientOnlyStates = new Map<string, Map<string, number>>();

  for (const award of awards) {
    const state = award['Place of Performance State Code']?.trim();
    if (!state) continue;

    // Exact Award ID lookup
    if (award['Award ID']) {
      const id = award['Award ID'].trim();
      awardIdStates.set(id, state);
      normalizedAwardIdStates.set(normalizeAwardId(id), state);
    }

    const recipientRaw = (award['Recipient Name'] || '').trim().toUpperCase();
    const agencyRaw = (award['Awarding Agency'] || '').trim().toUpperCase();

    // Exact Recipient + Agency lookup
    const exactKey = `${recipientRaw}|||${agencyRaw}`;
    if (!recipientAgencyStates.has(exactKey)) recipientAgencyStates.set(exactKey, new Map());
    const exactCounts = recipientAgencyStates.get(exactKey)!;
    exactCounts.set(state, (exactCounts.get(state) || 0) + 1);

    // Normalized Recipient + Agency lookup
    const normKey = `${normalizeRecipientName(recipientRaw)}|||${agencyRaw}`;
    if (!normalizedRecipientAgencyStates.has(normKey)) normalizedRecipientAgencyStates.set(normKey, new Map());
    const normCounts = normalizedRecipientAgencyStates.get(normKey)!;
    normCounts.set(state, (normCounts.get(state) || 0) + 1);

    // Recipient-only lookup (for fallback)
    const recipientNorm = normalizeRecipientName(recipientRaw);
    if (recipientNorm) {
      if (!recipientOnlyStates.has(recipientNorm)) recipientOnlyStates.set(recipientNorm, new Map());
      const rCounts = recipientOnlyStates.get(recipientNorm)!;
      rCounts.set(state, (rCounts.get(state) || 0) + 1);
    }
  }

  // Helper: resolve count map to most common state
  function resolveBest(countMap: Map<string, Map<string, number>>): Map<string, string> {
    const result = new Map<string, string>();
    for (const [key, counts] of countMap) {
      let bestState = '';
      let bestCount = 0;
      for (const [st, ct] of counts) {
        if (ct > bestCount) { bestState = st; bestCount = ct; }
      }
      result.set(key, bestState);
    }
    return result;
  }

  // Recipient-only: only use if >=3 contracts and all point to same state
  const byRecipientOnly = new Map<string, string>();
  for (const [recipient, counts] of recipientOnlyStates) {
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    if (total < 3) continue;
    let bestState = '';
    let bestCount = 0;
    for (const [st, ct] of counts) {
      if (ct > bestCount) { bestState = st; bestCount = ct; }
    }
    // Only use if dominant state accounts for >=80% of contracts
    if (bestCount / total >= 0.8) {
      byRecipientOnly.set(recipient, bestState);
    }
  }

  return {
    byAwardId: awardIdStates,
    byNormalizedAwardId: normalizedAwardIdStates,
    byRecipientAgency: resolveBest(recipientAgencyStates),
    byNormalizedRecipientAgency: resolveBest(normalizedRecipientAgencyStates),
    byRecipientOnly,
  };
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
 * - pages: max USASpending pages (default: 200 for enrich, 100 for build, 5 for preview)
 * - strategy: 'default' (single sort by amount) or 'targeted' (3 sorts: amount, start date, end date)
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
  const strategy = searchParams.get('strategy') || 'default'; // 'default' or 'targeted'
  const defaultPages = mode === 'preview' ? '5' : (mode === 'enrich' ? '200' : '100');
  const maxPages = parseInt(searchParams.get('pages') || defaultPages);
  const defaultStart = mode === 'enrich' ? '2018-01-01' : '2023-01-01';
  const actionStart = searchParams.get('start') || defaultStart;
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
    let awards: RawAward[];
    let totalPagesFetched: number;
    let totalFetchErrors: number;
    let batchStats: { sort: string; awards: number; pages: number }[] | null = null;

    if (strategy === 'targeted') {
      const result = await fetchTargetedAwards(maxPages, actionStart, actionEnd);
      awards = result.awards;
      totalPagesFetched = result.totalPagesFetched;
      totalFetchErrors = result.totalFetchErrors;
      batchStats = result.batchStats;
    } else {
      const result = await fetchUSASpendingAwards(maxPages, actionStart, actionEnd);
      awards = result.awards;
      totalPagesFetched = result.pagesActuallyFetched;
      totalFetchErrors = result.fetchErrors;
    }

    // Step 3: Build state lookup maps (exact + normalized + recipient-only)
    const lookups = buildStateLookup(awards);

    // Step 4: Merge states into existing contracts (6 strategies, most precise first)
    let matchedByAwardId = 0;
    let matchedBySubAwardId = 0;
    let matchedByNormalizedId = 0;
    let matchedByRecipientAgency = 0;
    let matchedByNormalizedRecipientAgency = 0;
    let matchedByRecipientOnly = 0;

    for (const contract of existingContracts) {
      if (contract.State) continue; // Already has state, skip

      // Strategy 1: Exact Award ID match
      const primaryAwardId = (contract['Award ID'] || '').split(' (')[0].split(' +')[0].trim();
      if (primaryAwardId && lookups.byAwardId.has(primaryAwardId)) {
        contract.State = lookups.byAwardId.get(primaryAwardId);
        matchedByAwardId++;
        continue;
      }

      // Strategy 2: Sub-contract Award IDs (exact)
      if (contract.Contracts && Array.isArray(contract.Contracts)) {
        let found = false;
        for (const sub of contract.Contracts) {
          const subId = (sub['Award ID'] || '').trim();
          if (subId && lookups.byAwardId.has(subId)) {
            contract.State = lookups.byAwardId.get(subId);
            matchedBySubAwardId++;
            found = true;
            break;
          }
        }
        if (found) continue;
      }

      // Strategy 3: Normalized Award ID (strip dashes/spaces)
      if (primaryAwardId) {
        const normId = normalizeAwardId(primaryAwardId);
        if (lookups.byNormalizedAwardId.has(normId)) {
          contract.State = lookups.byNormalizedAwardId.get(normId);
          matchedByNormalizedId++;
          continue;
        }
      }
      // Also try sub-contract IDs normalized
      if (contract.Contracts && Array.isArray(contract.Contracts)) {
        let found = false;
        for (const sub of contract.Contracts) {
          const subId = (sub['Award ID'] || '').trim();
          if (subId) {
            const normSubId = normalizeAwardId(subId);
            if (lookups.byNormalizedAwardId.has(normSubId)) {
              contract.State = lookups.byNormalizedAwardId.get(normSubId);
              matchedByNormalizedId++;
              found = true;
              break;
            }
          }
        }
        if (found) continue;
      }

      // Strategy 4: Exact Recipient + Agency match
      const recipientUpper = (contract.Recipient || '').trim().toUpperCase();
      const agencyUpper = (contract.Agency || '').trim().toUpperCase();
      const exactKey = `${recipientUpper}|||${agencyUpper}`;
      if (lookups.byRecipientAgency.has(exactKey)) {
        contract.State = lookups.byRecipientAgency.get(exactKey);
        matchedByRecipientAgency++;
        continue;
      }

      // Strategy 5: Normalized Recipient + Agency match (strip suffixes)
      const normKey = `${normalizeRecipientName(recipientUpper)}|||${agencyUpper}`;
      if (lookups.byNormalizedRecipientAgency.has(normKey)) {
        contract.State = lookups.byNormalizedRecipientAgency.get(normKey);
        matchedByNormalizedRecipientAgency++;
        continue;
      }

      // Strategy 6: Recipient-only fallback (>=3 contracts, >=80% same state)
      const recipientNorm = normalizeRecipientName(recipientUpper);
      if (recipientNorm && lookups.byRecipientOnly.has(recipientNorm)) {
        contract.State = lookups.byRecipientOnly.get(recipientNorm);
        matchedByRecipientOnly++;
      }
    }

    const totalMatched = matchedByAwardId + matchedBySubAwardId + matchedByNormalizedId +
      matchedByRecipientAgency + matchedByNormalizedRecipientAgency + matchedByRecipientOnly;
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
      strategy,
      stats: {
        existingRecords: existingContracts.length,
        usaSpendingAwardsFetched: awards.length,
        totalPagesFetched,
        totalFetchErrors,
        ...(batchStats ? { batchStats } : {}),
        stateLookupsBuilt: {
          byAwardId: lookups.byAwardId.size,
          byNormalizedAwardId: lookups.byNormalizedAwardId.size,
          byRecipientAgency: lookups.byRecipientAgency.size,
          byNormalizedRecipientAgency: lookups.byNormalizedRecipientAgency.size,
          byRecipientOnly: lookups.byRecipientOnly.size
        },
        totalMatched,
        matchedByAwardId,
        matchedBySubAwardId,
        matchedByNormalizedId,
        matchedByRecipientAgency,
        matchedByNormalizedRecipientAgency,
        matchedByRecipientOnly,
        totalWithState,
        totalWithoutState: existingContracts.length - totalWithState,
        coveragePercent: ((totalWithState / existingContracts.length) * 100).toFixed(1) + '%',
        uniqueStates: uniqueStates.length,
        states: uniqueStates
      },
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

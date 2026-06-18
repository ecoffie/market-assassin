import { NextRequest, NextResponse } from 'next/server';
import { CoreInputs } from '@/types/federal-market-assassin';
import {
  setAsideMap,
  veteranMap,
  naicsExpansion,
  industryNames,
  enhanceOfficeName,
  getStateFromZip,
  getBorderingStates,
  getExtendedRegionStates,
  getStatesByTier,
  generateAlternativeSearchOptions,
  estimateAlternativeSearchResults,
  validateNaicsCode,
  MARKET_SPEND_WINDOW
} from '@/lib/utils/usaspending-helpers';
import { fetchFPDSByNaics, mapFPDSToAgencies } from '@/lib/utils/fpds-api';
import { expandGenericDoDAgency } from '@/lib/utils/command-info';
import { expandNAICSCodes, parseNAICSInput } from '@/lib/utils/naics-expansion';
import { marketFilterToUsaspending } from '@/lib/market/keyword-coverage';
import {
  MICRO_PURCHASE_THRESHOLD,
  SIMPLIFIED_ACQUISITION_THRESHOLD,
  scoreAgencyPriority,
  sortAgenciesForSmallBusiness,
} from '@/lib/utils/agency-priority';

export async function POST(request: NextRequest) {
  try {
    const body: CoreInputs = await request.json();
    const {
      businessType,
      naicsCode,
      zipCode,
      veteranStatus,
      pscCode,
      excludeDOD,
      searchKeywords: rawSearchKeywords,
      marketFilter: rawMarketFilter,
    } = body;
    // The dashboard's States filter (an array) — not on CoreInputs, read from raw
    // body. When set, it scopes the spend query to those states (place of
    // performance). Previously only zipCode→single-state was wired, so the States
    // filter the user picked never reached the query (results stayed national).
    const rawBody = body as unknown as Record<string, unknown>;
    const locationStates: string[] = Array.isArray(rawBody.locationStates)
      ? (rawBody.locationStates as unknown[])
          .map((s) => String(s).trim().toUpperCase())
          .filter((s) => /^[A-Z]{2}$/.test(s))
      : [];

    const marketFilter = rawMarketFilter
      && (rawMarketFilter.keywords?.length || rawMarketFilter.psc_codes?.length)
      ? rawMarketFilter
      : null;
    const keywordPrimary = Boolean(marketFilter);

    console.log('🔍 Government contract search request:', body);
    if (keywordPrimary) {
      console.log(`🎯 Keyword/PSC-primary discovery: ${marketFilter!.rankingLabel}`);
    }
    if (excludeDOD) {
      console.log('🚫 DOD exclusion enabled - will filter out Department of Defense agencies');
    }

    // Build set-aside type codes array for USAspending API.
    // The panel sends the chosen set-aside in `businessType` (its BUSINESS_TYPES
    // includes SDVOSB/VOSB), so look businessType up in BOTH maps — otherwise a
    // veteran type selected as businessType silently applied no filter.
    const setAsideTypeCodes: string[] = [];
    if (businessType && setAsideMap[businessType]) {
      setAsideTypeCodes.push(...setAsideMap[businessType]);
    }
    if (businessType && veteranMap[businessType]) {
      setAsideTypeCodes.push(...veteranMap[businessType]);
    }
    if (veteranStatus && veteranMap[veteranStatus]) {
      setAsideTypeCodes.push(...veteranMap[veteranStatus]);
    }
    // De-dupe in case both maps contributed the same code.
    const dedupedSetAside = Array.from(new Set(setAsideTypeCodes));
    setAsideTypeCodes.length = 0;
    setAsideTypeCodes.push(...dedupedSetAside);

    console.log('🎯 Target set-aside codes:', setAsideTypeCodes);

    // Build USAspending API request
    const filters: any = {
      award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
      // Canonical 3-FY window shared with fpds-top-n + TMR so all dashboard
      // dollars reconcile (see MARKET_SPEND_WINDOW).
      time_period: [
        { start_date: MARKET_SPEND_WINDOW.start_date, end_date: MARKET_SPEND_WINDOW.end_date }
      ]
    };

    let naicsCorrectionMessage: string | null = null;
    let naicsValidationError: string | null = null;
    let suggestedNaicsCodes: Array<{ code: string; name: string; }> = [];

    // Track if this is a multi-NAICS search (for expanded fetch limits)
    let isMultiNaicsSearch = false;

    // Add NAICS filter if provided — SKIPPED when keyword/PSC-primary (#59).
    // NAICS = vendor industry (who sold), not what was bought. Keyword-primary
    // mode uses marketFilter for discovery; NAICS stays eligibility-only in TMR.
    if (naicsCode && naicsCode.trim() && !keywordPrimary) {
      // Check if user entered multiple NAICS codes (comma-separated)
      const inputCodes = parseNAICSInput(naicsCode);

      if (inputCodes.length > 1) {
        // MULTI-NAICS MODE: Expand all codes and merge.
        // expandFullCodes=false: 6-digit codes stay exact (no subsector sweep) so
        // multi-code spend totals aren't inflated; typed prefixes still expand.
        isMultiNaicsSearch = true;
        console.log(`📋 Multi-NAICS input detected: ${inputCodes.join(', ')}`);
        const expandedCodes = expandNAICSCodes(inputCodes, false);
        filters.naics_codes = expandedCodes;
        console.log(`   Expanded ${inputCodes.length} inputs to ${expandedCodes.length} NAICS codes`);
        naicsCorrectionMessage = `Searching ${inputCodes.length} NAICS codes/sectors: ${inputCodes.join(', ')} (${expandedCodes.length} total codes)`;
      } else {
        // SINGLE NAICS MODE: Use existing validation and expansion logic.
        // Use the PARSED code, not the raw string (Eric: "236220," with a
        // trailing comma was failing validation → invalid_naics). parseNAICSInput
        // already stripped the comma; fall back to a defensive strip.
        let trimmedNaics = (inputCodes[0] || naicsCode).replace(/[,\s]+/g, '').trim();

      // Validate the NAICS code first
      const validation = validateNaicsCode(trimmedNaics);
      if (!validation.isValid) {
        console.log(`❌ Invalid NAICS code: ${trimmedNaics}`);
        console.log(`   Error: ${validation.errorMessage}`);
        console.log(`   Suggestions: ${validation.suggestedCodes.map(s => s.code).join(', ')}`);

        naicsValidationError = validation.errorMessage || `NAICS code "${trimmedNaics}" is not recognized.`;
        suggestedNaicsCodes = validation.suggestedCodes;

        // Return early with validation error and suggestions
        return NextResponse.json({
          success: false,
          error: 'invalid_naics',
          naicsValidationError,
          suggestedNaicsCodes,
          agencies: [],
          totalCount: 0,
          totalSpending: 0,
          message: `The NAICS code "${trimmedNaics}" does not exist. Please select from the suggested codes below or enter a valid NAICS code.`
        });
      }

      // Use the normalized code from validation (e.g., "81000" → "81")
      if (validation.normalizedCode !== trimmedNaics) {
        const originalCode = trimmedNaics;
        trimmedNaics = validation.normalizedCode;
        const industryName = industryNames[trimmedNaics] || `${trimmedNaics}xx industry`;
        naicsCorrectionMessage = `NAICS ${originalCode} was automatically normalized to ${trimmedNaics} (${industryName}).`;
        console.log(`📋 Auto-normalized NAICS: ${originalCode} → ${trimmedNaics}`);
      }

      // Normalize NAICS codes with trailing zeros to their sector/subsector equivalent
      // This handles cases where users enter codes like "81000", "810000", "8100", etc.

      // 6-digit codes ending in 0000 (sector-level like 810000) → convert to 2-digit
      if (trimmedNaics.length === 6 && trimmedNaics.endsWith('0000')) {
        const sectorPrefix = trimmedNaics.substring(0, 2);
        console.log(`⚠️ NAICS ${trimmedNaics} appears to be sector-level (ends in 0000). Auto-correcting to 2-digit sector: ${sectorPrefix}`);

        const industryName = industryNames[sectorPrefix] || `Sector ${sectorPrefix}`;
        naicsCorrectionMessage = `NAICS ${trimmedNaics} was expanded to search all codes in the ${industryName} sector.`;
        trimmedNaics = sectorPrefix;
      }
      // 6-digit codes ending in 000 (subsector-level like 811000) → convert to 3-digit
      else if (trimmedNaics.length === 6 && trimmedNaics.endsWith('000')) {
        const prefix = trimmedNaics.substring(0, 3);
        console.log(`⚠️ NAICS ${trimmedNaics} appears invalid (ends in 000). Auto-correcting to 3-digit prefix: ${prefix}`);

        const industryName = industryNames[prefix] || `${prefix}xx industry`;
        naicsCorrectionMessage = `NAICS ${trimmedNaics} was expanded to search all ${prefix}xx codes in the ${industryName} sector.`;
        trimmedNaics = prefix;
      }
      // 5-digit codes ending in 000 (sector-level like 81000) → convert to 2-digit
      else if (trimmedNaics.length === 5 && trimmedNaics.endsWith('000')) {
        const sectorPrefix = trimmedNaics.substring(0, 2);
        console.log(`⚠️ NAICS ${trimmedNaics} appears to be sector-level (5-digit ending in 000). Auto-correcting to 2-digit sector: ${sectorPrefix}`);

        const industryName = industryNames[sectorPrefix] || `Sector ${sectorPrefix}`;
        naicsCorrectionMessage = `NAICS ${trimmedNaics} was expanded to search all codes in the ${industryName} sector.`;
        trimmedNaics = sectorPrefix;
      }
      // 5-digit codes ending in 00 (subsector-level like 81100) → convert to 3-digit
      else if (trimmedNaics.length === 5 && trimmedNaics.endsWith('00')) {
        const prefix = trimmedNaics.substring(0, 3);
        console.log(`⚠️ NAICS ${trimmedNaics} appears to be subsector-level (5-digit ending in 00). Auto-correcting to 3-digit prefix: ${prefix}`);

        const industryName = industryNames[prefix] || `${prefix}xx industry`;
        naicsCorrectionMessage = `NAICS ${trimmedNaics} was expanded to search all ${prefix}xx codes.`;
        trimmedNaics = prefix;
      }
      // 4-digit codes ending in 00 (sector-level like 8100) → convert to 2-digit
      else if (trimmedNaics.length === 4 && trimmedNaics.endsWith('00')) {
        const sectorPrefix = trimmedNaics.substring(0, 2);
        console.log(`⚠️ NAICS ${trimmedNaics} appears to be sector-level (4-digit ending in 00). Auto-correcting to 2-digit sector: ${sectorPrefix}`);

        const industryName = industryNames[sectorPrefix] || `Sector ${sectorPrefix}`;
        naicsCorrectionMessage = `NAICS ${trimmedNaics} was expanded to search all codes in the ${industryName} sector.`;
        trimmedNaics = sectorPrefix;
      }
      // 4-digit codes ending in 0 (subsector-level like 8110) → convert to 3-digit
      else if (trimmedNaics.length === 4 && trimmedNaics.endsWith('0')) {
        const prefix = trimmedNaics.substring(0, 3);
        console.log(`⚠️ NAICS ${trimmedNaics} appears to be subsector-level (4-digit ending in 0). Auto-correcting to 3-digit prefix: ${prefix}`);

        const industryName = industryNames[prefix] || `${prefix}xx industry`;
        naicsCorrectionMessage = `NAICS ${trimmedNaics} was expanded to search all ${prefix}xx codes.`;
        trimmedNaics = prefix;
      }

      // Expand 2-digit NAICS sector to all related codes
      if (trimmedNaics.length === 2) {
        console.log(`📋 Expanding 2-digit NAICS sector ${trimmedNaics} to all related codes...`);

        const expandedCodes = naicsExpansion[trimmedNaics];
        if (expandedCodes && expandedCodes.length > 0) {
          filters.naics_codes = expandedCodes;
          console.log(`   Expanded to ${expandedCodes.length} specific NAICS codes in sector ${trimmedNaics}`);
        } else {
          console.log(`   No expansion mapping for sector ${trimmedNaics}, using as-is`);
          filters.naics_codes = [trimmedNaics];
        }
      }
      // Expand 3-digit NAICS prefix to all related codes
      else if (trimmedNaics.length === 3) {
        console.log(`📋 Expanding 3-digit NAICS prefix ${trimmedNaics} to all related codes...`);

        let expandedCodes = naicsExpansion[trimmedNaics];

        // If no mapping for 3-digit, try falling back to 2-digit sector
        if (!expandedCodes || expandedCodes.length === 0) {
          const sectorPrefix = trimmedNaics.substring(0, 2);
          expandedCodes = naicsExpansion[sectorPrefix];
          if (expandedCodes && expandedCodes.length > 0) {
            const industryName = industryNames[sectorPrefix] || `Sector ${sectorPrefix}`;
            naicsCorrectionMessage = `NAICS ${trimmedNaics} is not a standard code. Expanded to search all codes in the ${industryName} sector.`;
            console.log(`   No mapping for ${trimmedNaics}, fell back to sector ${sectorPrefix} with ${expandedCodes.length} codes`);
          }
        }

        if (expandedCodes && expandedCodes.length > 0) {
          filters.naics_codes = expandedCodes;
          console.log(`   Expanded to ${expandedCodes.length} specific NAICS codes`);
        } else {
          console.log(`   No expansion mapping for ${trimmedNaics}, using as-is`);
          filters.naics_codes = [trimmedNaics];
        }
      }
      // 4-digit NAICS codes → map to 3-digit subsector
      else if (trimmedNaics.length === 4) {
        const subsectorPrefix = trimmedNaics.substring(0, 3);
        console.log(`📋 Mapping 4-digit NAICS ${trimmedNaics} to 3-digit subsector ${subsectorPrefix}...`);

        let expandedCodes = naicsExpansion[subsectorPrefix];

        // If no mapping for 3-digit, fall back to 2-digit sector
        if (!expandedCodes || expandedCodes.length === 0) {
          const sectorPrefix = trimmedNaics.substring(0, 2);
          expandedCodes = naicsExpansion[sectorPrefix];
          if (expandedCodes && expandedCodes.length > 0) {
            const industryName = industryNames[sectorPrefix] || `Sector ${sectorPrefix}`;
            naicsCorrectionMessage = `NAICS ${trimmedNaics} expanded to search all codes in the ${industryName} sector.`;
            console.log(`   No mapping for subsector ${subsectorPrefix}, fell back to sector ${sectorPrefix} with ${expandedCodes.length} codes`);
          }
        } else {
          const industryName = industryNames[subsectorPrefix] || `${subsectorPrefix}xx industry`;
          naicsCorrectionMessage = `NAICS ${trimmedNaics} expanded to search all ${subsectorPrefix}xx codes in the ${industryName} subsector.`;
        }

        if (expandedCodes && expandedCodes.length > 0) {
          filters.naics_codes = expandedCodes;
          console.log(`   Expanded to ${expandedCodes.length} specific NAICS codes`);
        } else {
          console.log(`   No expansion mapping available, using ${trimmedNaics} as-is`);
          filters.naics_codes = [trimmedNaics];
        }
      }
      // 5-digit NAICS codes → map to 3-digit subsector
      else if (trimmedNaics.length === 5) {
        const subsectorPrefix = trimmedNaics.substring(0, 3);
        console.log(`📋 Mapping 5-digit NAICS ${trimmedNaics} to 3-digit subsector ${subsectorPrefix}...`);

        let expandedCodes = naicsExpansion[subsectorPrefix];

        // If no mapping for 3-digit, fall back to 2-digit sector
        if (!expandedCodes || expandedCodes.length === 0) {
          const sectorPrefix = trimmedNaics.substring(0, 2);
          expandedCodes = naicsExpansion[sectorPrefix];
          if (expandedCodes && expandedCodes.length > 0) {
            const industryName = industryNames[sectorPrefix] || `Sector ${sectorPrefix}`;
            naicsCorrectionMessage = `NAICS ${trimmedNaics} expanded to search all codes in the ${industryName} sector.`;
            console.log(`   No mapping for subsector ${subsectorPrefix}, fell back to sector ${sectorPrefix} with ${expandedCodes.length} codes`);
          }
        } else {
          const industryName = industryNames[subsectorPrefix] || `${subsectorPrefix}xx industry`;
          naicsCorrectionMessage = `NAICS ${trimmedNaics} expanded to search all ${subsectorPrefix}xx codes in the ${industryName} subsector.`;
        }

        if (expandedCodes && expandedCodes.length > 0) {
          filters.naics_codes = expandedCodes;
          console.log(`   Expanded to ${expandedCodes.length} specific NAICS codes`);
        } else {
          console.log(`   No expansion mapping available, using ${trimmedNaics} as-is`);
          filters.naics_codes = [trimmedNaics];
        }
      } else {
        // 6-digit NAICS codes → use exact code
        console.log(`📋 Using exact 6-digit NAICS code: ${trimmedNaics}`);
        filters.naics_codes = [trimmedNaics];
      }
      } // End single NAICS mode
    }

    // Add set-aside filter
    if (setAsideTypeCodes.length > 0) {
      filters.set_aside_type_codes = setAsideTypeCodes;
    }

    // Add PSC filter — keyword-primary already carries PSC in marketFilter.
    const hasNaicsFilter = naicsCode && naicsCode.trim() && !keywordPrimary;

    if (!keywordPrimary && !hasNaicsFilter && pscCode && pscCode.trim()) {
      const trimmedPsc = pscCode.trim().toUpperCase();
      // Use crosswalk to convert PSC → related NAICS codes for better results
      const { getNAICSForPSC } = await import('@/lib/utils/psc-crosswalk');
      const crosswalkMatches = getNAICSForPSC(trimmedPsc, 15);

      if (crosswalkMatches.length > 0) {
        const relatedNaics = crosswalkMatches
          .filter(m => m.confidence !== 'low')
          .map(m => m.naicsCode);
        if (relatedNaics.length > 0) {
          filters.naics_codes = relatedNaics;
          console.log(`🎯 PSC ${trimmedPsc} → ${relatedNaics.length} NAICS codes via crosswalk: ${relatedNaics.slice(0, 5).join(', ')}...`);
        } else {
          // All matches were low confidence, use PSC directly
          filters.psc_codes = [trimmedPsc];
          console.log(`🎯 Filtering by specific PSC code: ${trimmedPsc} (low-confidence crosswalk)`);
        }
      } else {
        // No crosswalk data, use PSC directly
        filters.psc_codes = [trimmedPsc];
        console.log(`🎯 Filtering by specific PSC code: ${trimmedPsc} (no crosswalk data)`);
      }
    } else if (pscCode && pscCode.trim() && hasNaicsFilter) {
      // Both provided — NAICS is primary, add PSC as supplemental filter
      console.log(`ℹ️ PSC code ${pscCode} noted — NAICS ${naicsCode} is primary filter`);
    }

    // Add location filter. The explicit States filter (array) wins; otherwise fall
    // back to deriving a single state from the zip code.
    let userState: string | null = null;
    let currentLocationTier = 1;
    if (locationStates.length > 0) {
      filters.place_of_performance_locations = locationStates.map((state) => ({
        country: 'USA',
        state,
      }));
      userState = locationStates[0];
      console.log('📍 Initial search: States filter -', locationStates.join(', '));
    } else if (zipCode && zipCode.trim()) {
      userState = getStateFromZip(zipCode);
      if (userState) {
        // Start with just the user's state (Tier 1)
        filters.place_of_performance_locations = [{
          country: 'USA',
          state: userState
        }];

        console.log('📍 Initial search: State only -', userState);
      }
    }

    console.log('🌐 USAspending API filters:', JSON.stringify(filters, null, 2));

    // Fields to request from USAspending API
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
      'NAICS Description',
      'Place of Performance State Code',
      'Place of Performance City Code',
      'Primary Place of Performance',
      'Set-Aside Type',
      'Number of Offers Received'
    ];

    // Determine number of pages based on filter restrictiveness and search type
    const filterCount = [
      naicsCode && naicsCode.trim(),
      setAsideTypeCodes.length > 0,
      zipCode && zipCode.trim()
    ].filter(Boolean).length;

    // Smart sampling strategy:
    // - Multi-NAICS searches get 10,000 contracts (broader coverage needed)
    // - We fetch in two passes: by $ amount (biggest) + by date (newest)
    // - This ensures we catch both major contracts AND recent small awards

    let maxPagesPerSort = 10;
    if (isMultiNaicsSearch) {
      maxPagesPerSort = 50; // 5000 per sort = 10,000 total for multi-NAICS
      console.log('🔍 Multi-NAICS search: using expanded 10,000 contract limit');
    } else if (filterCount >= 3) {
      maxPagesPerSort = 25; // Very restrictive: 2500 per sort = 5000 total
      console.log('🔍 Highly restrictive search detected');
    } else if (filterCount === 2) {
      maxPagesPerSort = 15; // Moderately restrictive: 1500 per sort = 3000 total
      console.log('🔍 Moderately restrictive search');
    }

    const limit = 100;

    /** USAspending returns Award Amount as number or string — coerce before SAT thresholds. */
    function parseAwardAmount(raw: unknown): number {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (typeof raw === 'string') {
        const n = Number(raw.replace(/[$,\s]/g, ''));
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    }

    // Helper to fetch a batch of contracts with a specific sort
    async function fetchBatch(
      sortField: string,
      sortOrder: string,
      maxPgs: number,
      batchFilters: Record<string, unknown> = filters,
    ): Promise<any[]> {
      const results: any[] = [];
      for (let page = 1; page <= maxPgs; page++) {
        try {
          const response = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filters: batchFilters,
              fields,
              page,
              limit,
              order: sortOrder,
              sort: sortField
            }),
            signal: AbortSignal.timeout(30000)
          });

          if (!response.ok) break;
          const data = await response.json();

          if (data?.results) {
            results.push(...data.results);
            if (data.results.length < limit) break;
          } else {
            break;
          }

          if (page < maxPgs) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } catch (error) {
          console.error(`Error fetching page ${page} (${sortField}):`, error);
          break;
        }
      }
      return results;
    }

    const satPages = Math.min(maxPagesPerSort, 15);

    const seenAwardIds = new Set<string>();
    const allAwards: any[] = [];

    const mergeAwards = (batch: any[]) => {
      for (const award of batch) {
        const awardId = award['Award ID'];
        if (awardId && !seenAwardIds.has(awardId)) {
          seenAwardIds.add(awardId);
          allAwards.push(award);
        }
      }
    };

    let amountOnlyCount = 0;
    let uniqueFromDate = 0;
    let uniqueFromSat = 0;

    if (keywordPrimary && marketFilter) {
      // KEYWORD/PSC-PRIMARY (#59): sample awards by what was BOUGHT, not vendor NAICS.
      const discoveryBase: Record<string, unknown> = { ...filters };
      delete discoveryBase.naics_codes;
      delete discoveryBase.psc_codes;
      delete discoveryBase.keywords;
      const primaryFilter = marketFilterToUsaspending(marketFilter, discoveryBase);
      const kwPages = Math.min(maxPagesPerSort, 20);

      console.log(`📊 Keyword/PSC-primary sampling: ${marketFilter.rankingLabel}`);
      console.log('   Pass 1: Fetching by Award Amount (largest contracts)...');
      const byAmount = await fetchBatch('Award Amount', 'desc', kwPages, primaryFilter);
      console.log(`   ✓ Retrieved ${byAmount.length} contracts by amount`);
      console.log('   Pass 2: Fetching by Award Date (most recent)...');
      const byDate = await fetchBatch('Award Date', 'desc', kwPages, primaryFilter);
      console.log(`   ✓ Retrieved ${byDate.length} contracts by date`);
      const satFilters = {
        ...primaryFilter,
        award_amounts: [{ lower_bound: 1, upper_bound: SIMPLIFIED_ACQUISITION_THRESHOLD }],
      };
      console.log(`   Pass 3: Fetching SAT-eligible awards (≤$${SIMPLIFIED_ACQUISITION_THRESHOLD / 1000}K)...`);
      const bySat = await fetchBatch('Award Amount', 'desc', satPages, satFilters);
      console.log(`   ✓ Retrieved ${bySat.length} SAT-eligible contracts`);

      mergeAwards(byAmount);
      amountOnlyCount = allAwards.length;
      mergeAwards(byDate);
      uniqueFromDate = allAwards.length - amountOnlyCount;
      const beforeSat = allAwards.length;
      mergeAwards(bySat);
      uniqueFromSat = allAwards.length - beforeSat;

      // Union derived search terms (PSC name, NAICS title signals) — skip primary keyword dup.
      const searchKeywords = Array.isArray(rawSearchKeywords)
        ? rawSearchKeywords.map((k) => String(k).trim()).filter((k) => k.length >= 3).slice(0, 6)
        : [];
      const primaryKw = (marketFilter.keywords?.[0] || '').toLowerCase();
      if (searchKeywords.length > 0) {
        const beforeKw = allAwards.length;
        const extraPages = Math.min(kwPages, 12);
        for (const kw of searchKeywords) {
          if (kw.toLowerCase() === primaryKw) continue;
          const kwFilters = { ...discoveryBase, keywords: [kw.slice(0, 80)] };
          console.log(`   Derived keyword pass: "${kw}"...`);
          mergeAwards(await fetchBatch('Award Amount', 'desc', extraPages, kwFilters));
          mergeAwards(await fetchBatch('Award Date', 'desc', Math.min(extraPages, 8), kwFilters));
        }
        console.log(`✅ Derived keyword union: +${allAwards.length - beforeKw} contracts`);
      }
    } else {
      console.log(
        `📊 Smart sampling: up to ${maxPagesPerSort * limit} by $ + ${maxPagesPerSort * limit} by date + ${satPages * limit} SAT-eligible (≤$${SIMPLIFIED_ACQUISITION_THRESHOLD / 1000}K)...`,
      );

      // PASS 1: Fetch by Award Amount (biggest contracts first)
      console.log('   Pass 1: Fetching by Award Amount (largest contracts)...');
      const byAmount = await fetchBatch('Award Amount', 'desc', maxPagesPerSort);
      console.log(`   ✓ Retrieved ${byAmount.length} contracts by amount`);

      // PASS 2: Fetch by Award Date (most recent contracts)
      console.log('   Pass 2: Fetching by Award Date (most recent)...');
      const byDate = await fetchBatch('Award Date', 'desc', maxPagesPerSort);
      console.log(`   ✓ Retrieved ${byDate.length} contracts by date`);

      const satFilters = {
        ...filters,
        award_amounts: [{ lower_bound: 1, upper_bound: SIMPLIFIED_ACQUISITION_THRESHOLD }],
      };
      console.log(`   Pass 3: Fetching SAT-eligible awards (≤$${SIMPLIFIED_ACQUISITION_THRESHOLD / 1000}K)...`);
      const bySat = await fetchBatch('Award Amount', 'desc', satPages, satFilters);
      console.log(`   ✓ Retrieved ${bySat.length} SAT-eligible contracts`);

      mergeAwards(byAmount);
      amountOnlyCount = allAwards.length;
      mergeAwards(byDate);
      uniqueFromDate = allAwards.length - amountOnlyCount;
      const beforeSat = allAwards.length;
      mergeAwards(bySat);
      uniqueFromSat = allAwards.length - beforeSat;

      // KEYWORD UNION (#59): merge award samples on top of NAICS pass (legacy NAICS mode).
      const searchKeywords = Array.isArray(rawSearchKeywords)
        ? rawSearchKeywords.map((k) => String(k).trim()).filter((k) => k.length >= 3).slice(0, 6)
        : [];
      if (searchKeywords.length > 0) {
        const beforeKw = allAwards.length;
        const kwPages = Math.min(maxPagesPerSort, 15);
        for (const kw of searchKeywords) {
          const kwFilters = { ...filters };
          delete kwFilters.naics_codes;
          delete kwFilters.psc_codes;
          kwFilters.keywords = [kw.slice(0, 80)];
          console.log(`   Keyword pass: "${kw}"...`);
          const kwByAmount = await fetchBatch('Award Amount', 'desc', kwPages, kwFilters);
          const kwByDate = await fetchBatch('Award Date', 'desc', Math.min(kwPages, 10), kwFilters);
          mergeAwards(kwByAmount);
          mergeAwards(kwByDate);
        }
        console.log(`✅ Keyword union: +${allAwards.length - beforeKw} contracts from ${searchKeywords.length} terms`);
      }
    }

    console.log(
      `✅ Sampling complete: ${allAwards.length} unique contracts (${amountOnlyCount} by $, +${uniqueFromDate} recent, +${uniqueFromSat} SAT-eligible)`,
    );

    // Track if we applied a fallback to show users what changed
    let wasAutoAdjusted = false;
    let fallbackMessage: string | null = null;

    // Helper function to fetch with specific filters
    async function fetchWithFilters(searchFilters: any, maxPagesOverride?: number): Promise<any[]> {
      const results: any[] = [];
      const fetchLimit = 100;
      const maxPagesToFetch = maxPagesOverride || 10;

      for (let page = 1; page <= maxPagesToFetch; page++) {
        try {
          const response = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filters: searchFilters,
              fields,
              page,
              limit: fetchLimit,
              order: 'desc',
              sort: 'Award Amount'
            }),
            signal: AbortSignal.timeout(30000)
          });

          if (!response.ok) break;
          const data = await response.json();

          if (data && data.results) {
            results.push(...data.results);
            if (data.results.length < fetchLimit) break;
          } else {
            break;
          }

          if (page < maxPagesToFetch) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          console.error(`Error fetching page ${page}:`, error);
          break;
        }
      }

      return results;
    }

    // Helper function to count unique contracting offices from awards
    // Uses the same logic as aggregation to count office-level entities (commands, offices)
    const MIN_AGENCIES_TARGET = 20;
    function countUniqueAgencies(awards: any[]): number {
      const uniqueOffices = new Set<string>();
      for (const award of awards) {
        const awardingAgency = award['Awarding Agency'] || 'Unknown';
        const subAgency = award['Awarding Sub Agency'] || awardingAgency;
        // For DoD, the Awarding Office contains the command (e.g., "Naval Sea Systems Command")
        const awardingOffice = award['Awarding Office'] || subAgency;
        // Create the same key format as aggregation
        const officeKey = `${subAgency}|${awardingOffice}`;
        uniqueOffices.add(officeKey);
      }
      return uniqueOffices.size;
    }

    // Check if we need to expand (fewer than 20 unique agencies)
    let currentAgencyCount = countUniqueAgencies(allAwards);
    console.log(`📊 Initial search: ${allAwards.length} contracts, ${currentAgencyCount} unique agencies`);

    // Progressive expansion strategy:
    // 1. First try: User's specific set-aside in user's state
    // 2. Second try: Small Business set-aside in user's state (more results, same location)
    // 3. Then expand geographically: Bordering States → Extended Region → Nationwide
    // Expand until we have at least 20 unique agencies

    // Track if we've already broadened to Small Business
    let broadenedToSmallBusiness = false;
    const originalSetAsideCodes = [...(filters.set_aside_type_codes || [])];
    const smallBusinessCodes = ['SBA', 'SBP', 'SMALL BUSINESS SET-ASIDE', 'TOTAL SMALL BUSINESS SET-ASIDE (FAR 19.5)'];

    // Check if user is already searching for Small Business (no need to broaden)
    const isAlreadySmallBusiness = businessType === 'Small Business';

    if (currentAgencyCount < MIN_AGENCIES_TARGET && userState) {
      console.log(`⚠️ Only ${currentAgencyCount} agencies found (target: ${MIN_AGENCIES_TARGET}). Attempting progressive expansion...`);
      console.log('   NAICS:', naicsCode || 'none');
      console.log('   Business Type:', businessType || 'none');
      console.log('   Initial State:', userState);

      const stateTiers = getStatesByTier(userState);

      // Step 1.5: Before geographic expansion, try Small Business set-aside in SAME state
      // This keeps opportunities localized while expanding the pool
      if (currentAgencyCount < MIN_AGENCIES_TARGET && !isAlreadySmallBusiness && setAsideTypeCodes.length > 0) {
        console.log(`🔄 Step 1.5: Trying Small Business set-aside in ${userState} (before geographic expansion)...`);

        const smallBizLocalFilters = { ...filters };
        smallBizLocalFilters.set_aside_type_codes = smallBusinessCodes;
        // Keep location to just user's state
        smallBizLocalFilters.place_of_performance_locations = [{
          country: 'USA',
          state: userState
        }];

        const smallBizLocalResults = await fetchWithFilters(smallBizLocalFilters, 25);
        if (smallBizLocalResults.length > 0) {
          const smallBizAgencyCount = countUniqueAgencies(smallBizLocalResults);
          console.log(`   Found ${smallBizLocalResults.length} contracts, ${smallBizAgencyCount} agencies with Small Business in ${userState}`);

          if (smallBizAgencyCount >= currentAgencyCount) {
            // Use these broader results but stay in same state
            allAwards.length = 0;
            allAwards.push(...smallBizLocalResults);
            currentAgencyCount = smallBizAgencyCount;
            broadenedToSmallBusiness = true;
            wasAutoAdjusted = true;
            fallbackMessage = `Showing Small Business opportunities in ${userState} (${currentAgencyCount} agencies found).`;
            console.log(`✅ Step 1.5: Using Small Business results - ${currentAgencyCount} agencies in ${userState}`);

            // Update filters for subsequent geographic expansion
            filters.set_aside_type_codes = smallBusinessCodes;
          }
        }
      }

      // Tier 2: Expand to bordering states
      if (currentAgencyCount < MIN_AGENCIES_TARGET) {
        const tier2States = stateTiers.tier2;
        console.log(`🔄 Tier 2: Expanding to bordering states (${tier2States.length} states: ${tier2States.join(', ')})...`);

        const tier2Filters = { ...filters };
        tier2Filters.place_of_performance_locations = tier2States.map(state => ({
          country: 'USA',
          state: state
        }));

        const tier2Results = await fetchWithFilters(tier2Filters, 25);
        if (tier2Results.length > 0) {
          // Replace with broader results (they include the original state)
          allAwards.length = 0;
          allAwards.push(...tier2Results);
          currentLocationTier = 2;
          currentAgencyCount = countUniqueAgencies(allAwards);
          wasAutoAdjusted = true;
          fallbackMessage = `Expanded to ${tier2States.length} neighboring states (${currentAgencyCount} agencies found).`;
          console.log(`✅ Tier 2: ${tier2Results.length} contracts, ${currentAgencyCount} agencies`);
        }
      }

      // Tier 3: Expand to extended region (~100-200 mile radius)
      if (currentAgencyCount < MIN_AGENCIES_TARGET) {
        const tier3States = stateTiers.tier3;
        console.log(`🔄 Tier 3: Expanding to extended region (${tier3States.length} states: ${tier3States.join(', ')})...`);

        const tier3Filters = { ...filters };
        tier3Filters.place_of_performance_locations = tier3States.map(state => ({
          country: 'USA',
          state: state
        }));

        const tier3Results = await fetchWithFilters(tier3Filters, 35);
        if (tier3Results.length > 0) {
          allAwards.length = 0;
          allAwards.push(...tier3Results);
          currentLocationTier = 3;
          currentAgencyCount = countUniqueAgencies(allAwards);
          wasAutoAdjusted = true;
          fallbackMessage = `Expanded to ${tier3States.length}-state region (${currentAgencyCount} agencies found).`;
          console.log(`✅ Tier 3: ${tier3Results.length} contracts, ${currentAgencyCount} agencies`);
        }
      }

      // Tier 4: Nationwide search
      if (currentAgencyCount < MIN_AGENCIES_TARGET) {
        console.log('🔄 Tier 4: Expanding to nationwide search...');

        const nationwideFilters = { ...filters };
        delete nationwideFilters.place_of_performance_locations;

        const nationwideResults = await fetchWithFilters(nationwideFilters, 50);
        if (nationwideResults.length > 0) {
          allAwards.length = 0;
          allAwards.push(...nationwideResults);
          currentLocationTier = 4;
          currentAgencyCount = countUniqueAgencies(allAwards);
          wasAutoAdjusted = true;
          fallbackMessage = `Showing nationwide results (${currentAgencyCount} agencies found).`;
          console.log(`✅ Tier 4: ${nationwideResults.length} contracts, ${currentAgencyCount} agencies`);
        }
      }
    }

    // If still fewer than target agencies after location expansion, try relaxing set-aside restrictions further
    if (currentAgencyCount < MIN_AGENCIES_TARGET && businessType && naicsCode) {
      console.log(`⚠️ Only ${currentAgencyCount} agencies even nationwide. Trying to relax set-aside restrictions further...`);

      // Try broadening to ALL small business set-asides (8A, WOSB, SDVOSB, etc.)
      // Only if we haven't already broadened or if user is searching for specific certification
      if (!broadenedToSmallBusiness && (businessType === 'Women Owned' || businessType === 'HUBZone' || businessType === '8(a) Certified')) {
        console.log('🔄 Broadening to ALL small business certification types...');
        const broadFilters = { ...filters };
        delete broadFilters.place_of_performance_locations; // Already nationwide
        // Include all SB certification types
        broadFilters.set_aside_type_codes = ['SBA', 'SBP', '8A', '8AN', 'WOSB', 'EDWOSB', 'HZBZ', 'HUBZ', 'SDVOSB', 'VOSB'];

        const broadResults = await fetchWithFilters(broadFilters, 35);
        if (broadResults.length > 0) {
          allAwards.length = 0;
          allAwards.push(...broadResults);
          currentAgencyCount = countUniqueAgencies(allAwards);
          wasAutoAdjusted = true;
          fallbackMessage = `Showing all small business certification types (${currentAgencyCount} agencies found).`;
          console.log(`✅ Broadened to all SB types: ${broadResults.length} contracts, ${currentAgencyCount} agencies`);
        }
      }

      // Last resort: Remove set-aside restriction entirely
      if (currentAgencyCount < MIN_AGENCIES_TARGET) {
        console.log('🔄 Removing set-aside restrictions entirely...');
        const noSetAsideFilters = { ...filters };
        delete noSetAsideFilters.place_of_performance_locations;
        delete noSetAsideFilters.set_aside_type_codes;

        const noSetAsideResults = await fetchWithFilters(noSetAsideFilters, 35);
        if (noSetAsideResults.length > 0) {
          allAwards.length = 0;
          allAwards.push(...noSetAsideResults);
          currentAgencyCount = countUniqueAgencies(allAwards);
          wasAutoAdjusted = true;
          fallbackMessage = `Showing all contracts in this NAICS (${currentAgencyCount} agencies found).`;
          console.log(`✅ All business types: ${noSetAsideResults.length} contracts, ${currentAgencyCount} agencies`);
        }
      }
    }

    // Combine correction messages if any
    if (wasAutoAdjusted && fallbackMessage) {
      naicsCorrectionMessage = naicsCorrectionMessage
        ? `${naicsCorrectionMessage}\n\n${fallbackMessage}`
        : fallbackMessage;
    }

    // Aggregate contracts by contracting office/agency
    const officeSpending: Record<string, any> = {};

    allAwards.forEach((award: any) => {
      const awardingAgency = award['Awarding Agency'] || 'Unknown Agency';
      const rawAwardingSubAgency = award['Awarding Sub Agency'] || awardingAgency;
      // Don't fall back to sub-agency - keep as null/empty if no specific office
      const rawAwardingOffice = award['Awarding Office'] || null;

      const awardingSubAgency = enhanceOfficeName(rawAwardingSubAgency) || rawAwardingSubAgency;
      // If no office provided, use sub-agency for display but track that it's aggregated
      const awardingOffice = rawAwardingOffice
        ? (enhanceOfficeName(rawAwardingOffice) || rawAwardingOffice)
        : awardingSubAgency; // Fall back for aggregation key

      const awardingAgencyCode = award['Awarding Agency Code'] || '';
      const awardingSubAgencyCode = award['Awarding Sub Agency Code'] || '';
      const location = award['Place of Performance State Code'] || null;
      const amount = parseAwardAmount(award['Award Amount']);

      // Track if we have a specific office or just aggregating by sub-agency
      const hasSpecificOffice = !!rawAwardingOffice && rawAwardingOffice !== rawAwardingSubAgency;

      const officeId = award.agency_slug || award.awarding_agency_id || awardingAgency;
      const officeKey = `${officeId}|${awardingSubAgency}|${awardingOffice}`;

      if (!officeSpending[officeKey]) {
        const searchableOfficeCode = awardingSubAgencyCode || awardingAgencyCode || '';

        officeSpending[officeKey] = {
          id: officeKey,
          agencyId: officeId,
          name: awardingOffice,
          contractingOffice: awardingOffice,        // Specific office that awards contracts
          subAgency: awardingSubAgency,             // Intermediate agency (e.g., "Department of the Army")
          parentAgency: awardingAgency,             // Top-level agency (e.g., "Department of Defense")
          hasSpecificOffice: hasSpecificOffice,    // True if we have distinct contracting office data
          agencyCode: awardingAgencyCode,
          subAgencyCode: awardingSubAgencyCode,
          searchableOfficeCode: searchableOfficeCode,
          location: location || 'Unknown',
          officeId: searchableOfficeCode,
          setAsideSpending: 0,
          contractCount: 0,
          satSpending: 0,
          satContractCount: 0,
          microSpending: 0,
          microContractCount: 0,
          // Bidder + vendor tracking added 2026-05-25 for triage card
          // decision intel. bidsTotal/bidsCount drive avgBidders (a
          // proxy for competitive density). uniqueVendorNames captures
          // recipient diversity at this office — high = open door, low
          // = locked relationships. Set is converted to count at the end.
          bidsTotal: 0,
          bidsCount: 0,
          uniqueVendorNames: new Set<string>(),
        };
      }

      officeSpending[officeKey].setAsideSpending += amount;
      officeSpending[officeKey].contractCount += 1;

      // Track Simplified Acquisition Threshold (SAT) and micro-purchase metrics
      if (amount > 0 && amount <= SIMPLIFIED_ACQUISITION_THRESHOLD) {
        officeSpending[officeKey].satSpending += amount;
        officeSpending[officeKey].satContractCount += 1;
      }
      if (amount > 0 && amount <= MICRO_PURCHASE_THRESHOLD) {
        officeSpending[officeKey].microSpending += amount;
        officeSpending[officeKey].microContractCount += 1;
      }

      // Bidder tracking — USAspending sets 'Number of Offers Received'
      // for most contracts but some are blank/null. Only count entries
      // with a positive number so the avg isn't deflated by missing data.
      const offers = Number(award['Number of Offers Received'] || 0);
      if (offers > 0) {
        officeSpending[officeKey].bidsTotal += offers;
        officeSpending[officeKey].bidsCount += 1;
      }

      // Unique vendor tracking — Recipient Name is the prime that won
      // this contract. Aggregating into a Set gives us 'how many
      // distinct primes win at this office?'
      const recipient = award['Recipient Name'];
      if (recipient && typeof recipient === 'string') {
        officeSpending[officeKey].uniqueVendorNames.add(recipient.trim().toUpperCase());
      }
    });

    // Convert to array and sort for small-business entry points.
    // Finalize the bidder + vendor aggregations before any sorting
    // happens. avgBidders is null (not 0) when we have no offer data
    // so the UI can render an honest '—' instead of a misleading 0.
    Object.values(officeSpending).forEach((office: any) => {
      office.avgBidders = office.bidsCount > 0
        ? Math.round((office.bidsTotal / office.bidsCount) * 10) / 10
        : null;
      office.uniqueVendorCount = office.uniqueVendorNames.size;
      delete office.uniqueVendorNames;  // Set isn't JSON-serializable; drop it after counting
      delete office.bidsTotal;          // Internal accumulator, not needed in response
      delete office.bidsCount;
    });

    let agencies = sortAgenciesForSmallBusiness(Object.values(officeSpending));

    let totalSpending = agencies.reduce((sum, a) => sum + a.setAsideSpending, 0);

    console.log(`✅ Aggregated into ${agencies.length} unique agencies from USAspending`);

    // ============================================
    // FPDS INTEGRATION FOR DoD COMMAND-LEVEL DATA
    // ============================================
    // Check for DoD agencies that lack specific contracting office data
    // These show up as "Department of the Navy" or "Department of the Army" without
    // breaking down to NAVFAC, NAVSEA, USACE, etc.

    const dodParentAgencies = [
      'DEPARTMENT OF DEFENSE',
      'DEPT OF DEFENSE',
      'DOD',
    ];

    const dodSubAgencies = [
      'DEPARTMENT OF THE NAVY',
      'DEPT OF THE NAVY',
      'DEPARTMENT OF THE ARMY',
      'DEPT OF THE ARMY',
      'DEPARTMENT OF THE AIR FORCE',
      'DEPT OF THE AIR FORCE',
    ];

    // Find DoD entries that are missing specific office breakdown
    const dodAgenciesNeedingDetail = agencies.filter(agency => {
      const parentUpper = (agency.parentAgency || '').toUpperCase();
      const subUpper = (agency.subAgency || '').toUpperCase();
      const nameUpper = (agency.name || '').toUpperCase();

      // Check if this is a DoD agency
      const isDoD = dodParentAgencies.some(p => parentUpper.includes(p)) ||
                    dodSubAgencies.some(s => subUpper.includes(s) || nameUpper.includes(s));

      if (!isDoD) return false;

      // Check if the "name" is just the sub-agency (meaning no specific office data)
      // e.g., name === "Department of the Navy" instead of "NAVFAC Pacific"
      const hasSpecificOffice = agency.hasSpecificOffice === true;

      return !hasSpecificOffice;
    });

    if (dodAgenciesNeedingDetail.length > 0 && naicsCode) {
      console.log(`\n🎖️ Found ${dodAgenciesNeedingDetail.length} DoD agencies without command-level detail`);
      console.log('   Fetching FPDS data to get specific contracting commands...');

      try {
        // Use the actual 6-digit NAICS codes from filters (not the original input)
        // FPDS requires 6-digit codes, so sector codes like "81000" won't work
        const naicsCodesToQuery = filters.naics_codes || [naicsCode.trim()];

        // Filter to only 6-digit codes for FPDS
        const sixDigitCodes = naicsCodesToQuery.filter((code: string) => code.length === 6);

        if (sixDigitCodes.length === 0) {
          console.log('   ⚠️ No 6-digit NAICS codes available for FPDS query - skipping');
        } else {
          // Query FPDS with the first few 6-digit codes (limit to avoid too many requests)
          const codesToQuery = sixDigitCodes.slice(0, 3);
          console.log(`   📋 Querying FPDS with codes: ${codesToQuery.join(', ')}`);

          // Combine results from multiple NAICS codes
          let combinedAwards: any[] = [];
          const combinedOffices = new Map<string, any>();

          for (const code of codesToQuery) {
            const fpdsResult = await fetchFPDSByNaics(code, { maxRecords: 100 });
            combinedAwards = combinedAwards.concat(fpdsResult.awards);
            for (const [key, office] of fpdsResult.offices) {
              if (combinedOffices.has(key)) {
                const existing = combinedOffices.get(key);
                existing.obligatedAmount += office.obligatedAmount;
                existing.contractCount += office.contractCount;
              } else {
                combinedOffices.set(key, { ...office });
              }
            }
          }

          const fpdsResult = {
            awards: combinedAwards,
            totalCount: combinedAwards.length,
            offices: combinedOffices,
          };

          if (fpdsResult.offices.size > 0) {
            console.log(`   ✅ FPDS returned ${fpdsResult.offices.size} specific contracting offices`);

            // Map FPDS data to agency format
            const fpdsAgencies = mapFPDSToAgencies(fpdsResult);

            // Add FPDS agencies (these have specific command data)
            // Filter to only DoD offices
            const dodFpdsAgencies = fpdsAgencies.filter(a => {
              const parentUpper = (a.parentAgency || '').toUpperCase();
              const subUpper = (a.subAgency || '').toUpperCase();
              // Drop OVERSEAS commands (Eric: "Engineer District Europe" leaked in).
              if (/\b(europe|far east|pacific|japan|korea|germany|italy|overseas)\b/i.test(a.name || '')) return false;
              return dodParentAgencies.some(p => parentUpper.includes(p)) ||
                     dodSubAgencies.some(s => subUpper.includes(s));
            });

            console.log(`   Found ${dodFpdsAgencies.length} specific DoD commands from FPDS`);

            // Merge FPDS commands whenever we got ANY (Eric: multi-NAICS surfaced
            // FEWER FPDS commands than generic DoD rows, so the old ">=" gate
            // SKIPPED the merge → DoD never broke into commands. Now: merge the
            // commands we have + keep generic DoD rows FPDS didn't cover, then
            // let the static expander fill the rest below.)
            if (dodFpdsAgencies.length > 0) {
              // Remove the generic DoD entries and replace with FPDS data
              const genericDoDIds = new Set(dodAgenciesNeedingDetail.map(a => a.id));
              const nonDoDAgencies = agencies.filter(a => !genericDoDIds.has(a.id));

              console.log(`   Replacing ${dodAgenciesNeedingDetail.length} generic DoD entries with ${dodFpdsAgencies.length} specific commands:`);
              dodFpdsAgencies.slice(0, 10).forEach(a => {
                console.log(`     - ${a.name} (${a.subAgency}): $${a.setAsideSpending.toLocaleString()}`);
              });

              // Merge: non-DoD from USAspending + DoD commands from FPDS
              agencies = [
                ...nonDoDAgencies,
                ...dodFpdsAgencies.map(a => ({
                  ...a,
                  hasSpecificOffice: true, // Mark as having specific office data
                })),
              ];

              agencies = sortAgenciesForSmallBusiness(agencies);

              // Recalculate total spending
              totalSpending = agencies.reduce((sum, a) => sum + a.setAsideSpending, 0);

              console.log(`   📊 Final: ${agencies.length} agencies (${nonDoDAgencies.length} non-DoD + ${dodFpdsAgencies.length} DoD commands)`);
            } else {
              // FPDS didn't return enough DoD data - EXPAND using static command data
              console.log(`   ⚠️ FPDS only returned ${dodFpdsAgencies.length} DoD commands (need ${dodAgenciesNeedingDetail.length})`);
              console.log(`   🔄 Expanding generic DoD agencies using static command database...`);

              // Expand each generic DoD agency into specific commands
              const expandedAgencies: any[] = [];
              const genericDoDIds = new Set<string>();

              for (const genericAgency of dodAgenciesNeedingDetail) {
                const expanded = expandGenericDoDAgency(genericAgency, 5);
                if (expanded.length > 0) {
                  expandedAgencies.push(...expanded);
                  genericDoDIds.add(genericAgency.id);
                  console.log(`     Expanded "${genericAgency.subAgency}" into ${expanded.length} commands:`);
                  expanded.forEach(e => console.log(`       - ${e.command}: ${e.name}`));
                }
              }

              if (expandedAgencies.length > 0) {
                // Remove generic DoD entries that were expanded
                const nonExpandedAgencies = agencies.filter(a => !genericDoDIds.has(a.id));

                // Merge: non-expanded agencies + expanded DoD commands
                agencies = [...nonExpandedAgencies, ...expandedAgencies];

                agencies = sortAgenciesForSmallBusiness(agencies);

                // Recalculate total spending
                totalSpending = agencies.reduce((sum, a) => sum + a.setAsideSpending, 0);

                console.log(`   ✅ Expanded to ${expandedAgencies.length} specific DoD commands`);
              } else {
                console.log(`   Keeping original ${dodAgenciesNeedingDetail.length} DoD agencies from USAspending`);
              }
            }
          } else {
            console.log('   ⚠️ FPDS returned no offices for this NAICS code');

            // Still expand using static command data even if FPDS failed
            console.log(`   🔄 Expanding generic DoD agencies using static command database...`);

            const expandedAgencies: any[] = [];
            const genericDoDIds = new Set<string>();

            for (const genericAgency of dodAgenciesNeedingDetail) {
              const expanded = expandGenericDoDAgency(genericAgency, 5);
              if (expanded.length > 0) {
                expandedAgencies.push(...expanded);
                genericDoDIds.add(genericAgency.id);
                console.log(`     Expanded "${genericAgency.subAgency}" into ${expanded.length} commands`);
              }
            }

            if (expandedAgencies.length > 0) {
              const nonExpandedAgencies = agencies.filter(a => !genericDoDIds.has(a.id));
              agencies = [...nonExpandedAgencies, ...expandedAgencies];
              agencies = sortAgenciesForSmallBusiness(agencies);
              totalSpending = agencies.reduce((sum, a) => sum + a.setAsideSpending, 0);
              console.log(`   ✅ Expanded to ${expandedAgencies.length} specific DoD commands`);
            }
          }
        } // end else (sixDigitCodes.length > 0)
      } catch (fpdsError) {
        console.error('   ❌ Error fetching FPDS data:', fpdsError);

        // Even if FPDS fails, expand using static command data
        console.log(`   🔄 Falling back to static command database expansion...`);

        const expandedAgencies: any[] = [];
        const genericDoDIds = new Set<string>();

        for (const genericAgency of dodAgenciesNeedingDetail) {
          const expanded = expandGenericDoDAgency(genericAgency, 5);
          if (expanded.length > 0) {
            expandedAgencies.push(...expanded);
            genericDoDIds.add(genericAgency.id);
          }
        }

        if (expandedAgencies.length > 0) {
          const nonExpandedAgencies = agencies.filter(a => !genericDoDIds.has(a.id));
          agencies = [...nonExpandedAgencies, ...expandedAgencies];
          agencies = sortAgenciesForSmallBusiness(agencies);
          totalSpending = agencies.reduce((sum, a) => sum + a.setAsideSpending, 0);
          console.log(`   ✅ Expanded to ${expandedAgencies.length} specific DoD commands`);
        }
      }
    } else if (dodAgenciesNeedingDetail.length > 0) {
      // No NAICS code provided, but we have generic DoD agencies - expand using static data
      console.log(`\n🎖️ Found ${dodAgenciesNeedingDetail.length} DoD agencies without command-level detail`);
      console.log('   🔄 Expanding using static command database (no NAICS for FPDS)...');

      const expandedAgencies: any[] = [];
      const genericDoDIds = new Set<string>();

      for (const genericAgency of dodAgenciesNeedingDetail) {
        const expanded = expandGenericDoDAgency(genericAgency, 5);
        if (expanded.length > 0) {
          expandedAgencies.push(...expanded);
          genericDoDIds.add(genericAgency.id);
          console.log(`     Expanded "${genericAgency.subAgency}" into ${expanded.length} commands`);
        }
      }

      if (expandedAgencies.length > 0) {
        const nonExpandedAgencies = agencies.filter(a => !genericDoDIds.has(a.id));
        agencies = [...nonExpandedAgencies, ...expandedAgencies];
        agencies = sortAgenciesForSmallBusiness(agencies);
        totalSpending = agencies.reduce((sum, a) => sum + a.setAsideSpending, 0);
        console.log(`   ✅ Expanded to ${expandedAgencies.length} specific DoD commands`);
      }
    }

    console.log(`✅ Final: ${agencies.length} unique agencies, $${totalSpending.toLocaleString()} total spending`);

    // ============================================
    // DOD EXCLUSION FILTER
    // ============================================
    // If user requested civilian agencies only, filter out DOD
    if (excludeDOD) {
      const beforeCount = agencies.length;
      agencies = agencies.filter(agency => {
        const parentUpper = (agency.parentAgency || '').toUpperCase();
        const subUpper = (agency.subAgency || '').toUpperCase();
        const nameUpper = (agency.name || '').toUpperCase();

        // Check if this is a DOD agency
        const isDOD =
          parentUpper.includes('DEPARTMENT OF DEFENSE') ||
          parentUpper.includes('DEPT OF DEFENSE') ||
          parentUpper.includes('DOD') ||
          subUpper.includes('DEPARTMENT OF THE NAVY') ||
          subUpper.includes('DEPARTMENT OF THE ARMY') ||
          subUpper.includes('DEPARTMENT OF THE AIR FORCE') ||
          subUpper.includes('DEFENSE LOGISTICS AGENCY') ||
          subUpper.includes('DEFENSE INFORMATION') ||
          subUpper.includes('DEFENSE CONTRACT') ||
          nameUpper.includes('NAVFAC') ||
          nameUpper.includes('NAVSEA') ||
          nameUpper.includes('USACE') ||
          nameUpper.includes('ARMY CORPS') ||
          nameUpper.includes('AIR FORCE');

        return !isDOD; // Keep only non-DOD agencies
      });

      // Recalculate total spending after filtering
      totalSpending = agencies.reduce((sum, a) => sum + a.setAsideSpending, 0);

      console.log(`🚫 DOD exclusion: Filtered from ${beforeCount} to ${agencies.length} civilian agencies`);
      console.log(`   Civilian agency spending: $${totalSpending.toLocaleString()}`);
    }

    agencies = sortAgenciesForSmallBusiness(agencies).map((agency: any) => {
      const priority = scoreAgencyPriority(agency);
      return {
        ...agency,
        priorityScore: priority.score,
        priorityBreakdown: priority,
      };
    });

    // If still no results after fallback, generate alternative search options
    let alternativeSearches;
    if (agencies.length === 0) {
      console.log('⚠️ No results found even after fallback attempts, generating alternative search options...');
      alternativeSearches = generateAlternativeSearchOptions({
        businessType,
        naicsCode,
        zipCode,
        veteranStatus
      });

      // Estimate results for each alternative (async, but we'll do a few key ones)
      // Limit to first 3 alternatives to avoid too many API calls
      const alternativesToEstimate = alternativeSearches.slice(0, 3);
      const estimatedResults = await Promise.all(
        alternativesToEstimate.map(alt => estimateAlternativeSearchResults(alt.filters))
      );

      alternativesToEstimate.forEach((alt, index) => {
        alt.estimatedResults = estimatedResults[index];
      });
    }

    // Build SAT summary across all agencies
    const satSummary = {
      totalSATSpending: agencies.reduce((sum: number, a: any) => sum + (a.satSpending || 0), 0),
      totalSATContracts: agencies.reduce((sum: number, a: any) => sum + (a.satContractCount || 0), 0),
      totalMicroSpending: agencies.reduce((sum: number, a: any) => sum + (a.microSpending || 0), 0),
      totalMicroContracts: agencies.reduce((sum: number, a: any) => sum + (a.microContractCount || 0), 0),
      totalContracts: agencies.reduce((sum: number, a: any) => sum + (a.contractCount || 0), 0),
      satFriendlyAgencies: agencies.filter((a: any) => a.contractCount > 0 && (a.satContractCount || 0) / a.contractCount > 0.5).length,
    };

    // Normalize uniqueVendorCount to a number on EVERY agency (Eric: DoD office
    // rows from the FPDS replacement path left it undefined → vendors=0/blank).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agencies.forEach((a: any) => { a.uniqueVendorCount = a.uniqueVendorCount ?? 0; });

    return NextResponse.json({
      success: true,
      agencies,
      totalCount: agencies.length,
      totalSpending,
      satSummary,
      naicsCorrectionMessage,
      alternativeSearches,
      wasAutoAdjusted, // Let frontend know if search was auto-broadened
      locationTier: currentLocationTier, // 1=state only, 2=+bordering, 3=+extended, 4=nationwide
      searchedState: userState
    });

  } catch (error) {
    console.error('Error finding agencies:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to find agencies' },
      { status: 500 }
    );
  }
}

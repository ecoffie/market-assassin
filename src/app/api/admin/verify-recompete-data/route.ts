/**
 * Verify Recompete Data Quality
 *
 * Compares local contracts-data.js against live USASpending API to:
 * 1. Verify data accuracy (do contracts still exist in source?)
 * 2. Identify coverage gaps (what NAICS codes are underrepresented?)
 * 3. Find stale data (contracts that have changed or expired)
 * 4. Suggest expansion queries for missing data
 *
 * GET /api/admin/verify-recompete-data?password=...&mode=summary|verify|gaps|expand
 *
 * Modes:
 * - summary: Quick stats on local data (default)
 * - verify: Sample verification against USASpending (spot check 10 contracts)
 * - gaps: Analyze NAICS coverage gaps
 * - expand: Generate expansion queries for missing NAICS
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { INDUSTRY_PRESETS } from '@/lib/industry-presets';

export const maxDuration = 120; // 2 minutes

const USASPENDING_SEARCH_API = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const USASPENDING_AWARD_API = 'https://api.usaspending.gov/api/v2/awards/';

interface LocalContract {
  Recipient: string;
  Agency: string;
  Office?: string;
  NAICS: string;
  State?: string;
  'Total Value': string;
  'Contract Count'?: number;
  Expiration: string;
  'Award ID': string;
  'Start Date': string;
}

interface VerificationResult {
  awardId: string;
  recipient: string;
  localValue: string;
  localExpiration: string;
  usaSpendingMatch: boolean;
  usaSpendingValue?: string;
  usaSpendingExpiration?: string;
  discrepancy?: string;
}

interface NaicsGap {
  naicsCode: string;
  naicsDescription: string;
  localCount: number;
  industry: string | null;
  priority: 'high' | 'medium' | 'low';
  suggestion: string;
}

// Parse local date M/D/YYYY to Date
function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [month, day, year] = parts.map(Number);
  return new Date(year, month - 1, day);
}

// Parse currency string to number
function parseValue(valueStr: string): number {
  if (!valueStr) return 0;
  return parseFloat(valueStr.replace(/[$,\s]/g, '')) || 0;
}

// Fetch local contracts data
async function fetchLocalContracts(baseUrl: string): Promise<LocalContract[]> {
  const response = await fetch(`${baseUrl}/contracts-data.js?v=${Date.now()}`, {
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  const jsonStr = text.replace(/^[^[]*/, '').replace(/;?\s*$/, '');
  return JSON.parse(jsonStr);
}

// Verify a single contract against USASpending using keyword search
async function verifyContract(contract: LocalContract): Promise<VerificationResult> {
  const awardId = contract['Award ID']?.split(' (')[0]?.trim();
  const result: VerificationResult = {
    awardId,
    recipient: contract.Recipient,
    localValue: contract['Total Value'],
    localExpiration: contract.Expiration,
    usaSpendingMatch: false,
  };

  if (!awardId) {
    result.discrepancy = 'Missing Award ID';
    return result;
  }

  try {
    // Use keyword search with the award ID (PIID)
    const response = await fetch(USASPENDING_SEARCH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          award_type_codes: ['A', 'B', 'C', 'D'],
          keywords: [awardId]
        },
        fields: ['Award ID', 'Recipient Name', 'Award Amount', 'End Date', 'generated_internal_id'],
        page: 1,
        limit: 5,
        sort: 'Award Amount',
        order: 'desc'
      }),
      signal: AbortSignal.timeout(10000)
    });

    const data = await response.json();

    if (data.results?.length > 0) {
      // Find exact match by Award ID
      const exactMatch = data.results.find((r: Record<string, unknown>) =>
        String(r['Award ID']).includes(awardId)
      );
      const usaContract = exactMatch || data.results[0];

      result.usaSpendingMatch = true;
      result.usaSpendingValue = `$${Number(usaContract['Award Amount']).toLocaleString()}`;
      result.usaSpendingExpiration = usaContract['End Date'];

      // Check for discrepancies
      const localVal = parseValue(contract['Total Value']);
      const usaVal = Number(usaContract['Award Amount']) || 0;
      if (Math.abs(localVal - usaVal) / Math.max(localVal, usaVal) > 0.1) {
        result.discrepancy = `Value differs: local ${contract['Total Value']} vs USA ${result.usaSpendingValue}`;
      }
    } else {
      result.discrepancy = 'Not found in USASpending (may have expired or been modified)';
    }
  } catch (err) {
    result.discrepancy = `API error: ${err instanceof Error ? err.message : String(err)}`;
  }

  return result;
}

// Analyze NAICS coverage gaps
function analyzeNaicsGaps(contracts: LocalContract[]): NaicsGap[] {
  // Count contracts by NAICS prefix (first 6 digits)
  const naicsCounts = new Map<string, { count: number; description: string }>();

  for (const contract of contracts) {
    if (!contract.NAICS) continue;
    const parts = contract.NAICS.split(' - ');
    const code = parts[0]?.trim();
    const desc = parts.slice(1).join(' - ').trim();
    if (!code) continue;

    const existing = naicsCounts.get(code);
    if (existing) {
      existing.count++;
    } else {
      naicsCounts.set(code, { count: 1, description: desc });
    }
  }

  // Map NAICS to industry presets
  const naicsToIndustry = new Map<string, string>();
  for (const preset of INDUSTRY_PRESETS) {
    for (const code of preset.codes) {
      naicsToIndustry.set(code, preset.name);
    }
  }

  // Calculate gaps - industries with low coverage
  const gaps: NaicsGap[] = [];

  // Check each industry preset
  for (const preset of INDUSTRY_PRESETS) {
    let totalCount = 0;
    const missingCodes: string[] = [];

    for (const code of preset.codes) {
      // Count all contracts matching this prefix
      let codeCount = 0;
      for (const [naics, data] of naicsCounts) {
        if (naics.startsWith(code) || code.startsWith(naics)) {
          codeCount += data.count;
        }
      }
      totalCount += codeCount;
      if (codeCount < 50) {
        missingCodes.push(code);
      }
    }

    if (missingCodes.length > 0 || totalCount < 100) {
      gaps.push({
        naicsCode: preset.codes.join(', '),
        naicsDescription: preset.description,
        localCount: totalCount,
        industry: preset.name,
        priority: totalCount < 50 ? 'high' : totalCount < 200 ? 'medium' : 'low',
        suggestion: `Add NAICS ${missingCodes.join(', ')} to build queries. Current coverage: ${totalCount} contracts.`
      });
    }
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return gaps;
}

// Generate expansion queries for missing NAICS
function generateExpansionQueries(gaps: NaicsGap[]): string[] {
  const queries: string[] = [];

  for (const gap of gaps.filter(g => g.priority === 'high' || g.priority === 'medium')) {
    const codes = gap.naicsCode.split(', ');
    for (const code of codes) {
      queries.push(`# ${gap.industry} - NAICS ${code}
curl -X POST "${USASPENDING_SEARCH_API}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "filters": {
      "award_type_codes": ["A", "B", "C", "D"],
      "naics_codes": [{"description": "", "naics": "${code}"}],
      "time_period": [{"start_date": "2020-01-01", "end_date": "2026-12-31"}]
    },
    "fields": ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "NAICS Code", "End Date", "Place of Performance State Code"],
    "page": 1,
    "limit": 100,
    "sort": "Award Amount",
    "order": "desc"
  }'`);
    }
  }

  return queries;
}

export async function GET(request: NextRequest) {
  const ip = getClientIP(request);
  const rl = await checkAdminRateLimit(ip);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = searchParams.get('mode') || 'summary';
  const baseUrl = `${new URL(request.url).origin}`;

  try {
    // Fetch local contracts
    const contracts = await fetchLocalContracts(baseUrl);
    const now = new Date();

    // Basic stats
    const totalContracts = contracts.length;
    const contractsWithState = contracts.filter(c => c.State).length;

    // NAICS distribution
    const naicsDistribution = new Map<string, number>();
    for (const contract of contracts) {
      if (!contract.NAICS) continue;
      const code = contract.NAICS.split(' - ')[0]?.slice(0, 3) || 'Unknown';
      naicsDistribution.set(code, (naicsDistribution.get(code) || 0) + 1);
    }

    // Expiration analysis
    let expiredCount = 0;
    let expiringWithin30Days = 0;
    let expiringWithin90Days = 0;
    let expiringWithin180Days = 0;
    let futureCount = 0;

    for (const contract of contracts) {
      const expDate = parseLocalDate(contract.Expiration);
      if (!expDate) continue;
      const daysUntil = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil < 0) expiredCount++;
      else if (daysUntil <= 30) expiringWithin30Days++;
      else if (daysUntil <= 90) expiringWithin90Days++;
      else if (daysUntil <= 180) expiringWithin180Days++;
      else futureCount++;
    }

    // Mode-specific processing
    if (mode === 'summary') {
      return NextResponse.json({
        success: true,
        mode: 'summary',
        stats: {
          totalContracts,
          contractsWithState,
          stateCoveragePercent: ((contractsWithState / totalContracts) * 100).toFixed(1) + '%',
          uniqueNaicsPrefixes: naicsDistribution.size,
          expirationBreakdown: {
            alreadyExpired: expiredCount,
            within30Days: expiringWithin30Days,
            within90Days: expiringWithin90Days,
            within180Days: expiringWithin180Days,
            beyond180Days: futureCount,
          },
          topNaicsPrefixes: Array.from(naicsDistribution.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([prefix, count]) => ({ prefix, count })),
        },
        dataAge: 'Check Last-Modified header of /contracts-data.js for data freshness',
      });
    }

    if (mode === 'verify') {
      // Sample 10 random contracts and verify against USASpending
      const sampleSize = Math.min(10, contracts.length);
      const sampleIndices = new Set<number>();
      while (sampleIndices.size < sampleSize) {
        sampleIndices.add(Math.floor(Math.random() * contracts.length));
      }
      const sampleContracts = Array.from(sampleIndices).map(i => contracts[i]);

      const verificationResults: VerificationResult[] = [];
      for (const contract of sampleContracts) {
        const result = await verifyContract(contract);
        verificationResults.push(result);
        // Rate limit: wait 500ms between API calls
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const matchCount = verificationResults.filter(r => r.usaSpendingMatch).length;
      const discrepancyCount = verificationResults.filter(r => r.discrepancy).length;

      return NextResponse.json({
        success: true,
        mode: 'verify',
        stats: {
          sampleSize,
          matchedInUSASpending: matchCount,
          matchRate: ((matchCount / sampleSize) * 100).toFixed(1) + '%',
          discrepanciesFound: discrepancyCount,
        },
        results: verificationResults,
        recommendation: matchCount >= sampleSize * 0.8
          ? 'Data quality is good (80%+ match rate)'
          : 'Consider refreshing data - match rate below 80%',
      });
    }

    if (mode === 'gaps') {
      const gaps = analyzeNaicsGaps(contracts);

      return NextResponse.json({
        success: true,
        mode: 'gaps',
        stats: {
          industriesAnalyzed: INDUSTRY_PRESETS.length,
          highPriorityGaps: gaps.filter(g => g.priority === 'high').length,
          mediumPriorityGaps: gaps.filter(g => g.priority === 'medium').length,
          lowPriorityGaps: gaps.filter(g => g.priority === 'low').length,
        },
        gaps,
        recommendation: gaps.filter(g => g.priority === 'high').length > 0
          ? 'Run mode=expand to get queries for missing data'
          : 'Coverage looks good across all industry presets',
      });
    }

    if (mode === 'expand') {
      const gaps = analyzeNaicsGaps(contracts);
      const queries = generateExpansionQueries(gaps);

      return NextResponse.json({
        success: true,
        mode: 'expand',
        stats: {
          gapsIdentified: gaps.filter(g => g.priority !== 'low').length,
          queriesGenerated: queries.length,
        },
        gaps: gaps.filter(g => g.priority !== 'low'),
        expansionQueries: queries,
        instructions: [
          '1. Run the expansion queries to fetch missing NAICS data',
          '2. Merge results with existing contracts-data.js',
          '3. Run mode=verify to confirm data quality',
          '4. Deploy updated contracts-data.js',
        ],
      });
    }

    return NextResponse.json({
      error: 'Invalid mode. Use: summary, verify, gaps, or expand',
    }, { status: 400 });

  } catch (error) {
    console.error('[VerifyRecompeteData] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}

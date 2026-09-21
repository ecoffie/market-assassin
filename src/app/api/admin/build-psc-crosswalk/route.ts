/**
 * Admin: Build PSC-NAICS Crosswalk Data
 *
 * GET /api/admin/build-psc-crosswalk?password=...
 *
 * Queries USASpending for NAICS→PSC co-occurrence data across federal awards.
 * For each NAICS sector/code, finds which PSC codes appear most frequently on
 * contracts with that NAICS code, and vice versa.
 *
 * Query params:
 * - password: admin password (required)
 * - mode: 'preview' (default) shows plan, 'build' runs full extraction
 * - sectors: comma-separated NAICS sectors to process (default: all)
 * - limit: max NAICS codes per sector (default: 20)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

const USA_SPENDING_API = 'https://api.usaspending.gov/api/v2';

// Top NAICS codes by federal spending volume — covers ~80% of contract dollars
const TARGET_NAICS: Record<string, string[]> = {
  // IT & Telecom (541)
  '541': [
    '541511', '541512', '541513', '541519', // Computer services
    '541330', '541611', '541612', '541614', // Engineering, management consulting
    '541690', '541715', '541720',           // Scientific R&D, testing
    '541810', '541820', '541840', '541850', // Advertising, media
    '541990',                                // Other professional services
  ],
  // Construction (236-238)
  '23': [
    '236210', '236220', '237110', '237120', '237130',
    '237310', '237990', '238210', '238220', '238910', '238990',
  ],
  // Manufacturing - Defense (332-336)
  '33': [
    '332710', '332993', '332994', '333314', '333415',
    '334111', '334118', '334210', '334220', '334290',
    '334511', '334516', '334519', '335999',
    '336411', '336412', '336413', '336414', '336415', '336419',
    '336611', '336612', '336992',
  ],
  // Admin & Support (561)
  '561': [
    '561110', '561210', '561320', '561330', '561410',
    '561421', '561499', '561611', '561612', '561613',
    '561710', '561720', '561730', '561790', '561990',
  ],
  // Healthcare (621-623)
  '62': [
    '621111', '621112', '621210', '621310', '621330',
    '621399', '621410', '621511', '621512', '621610',
    '621910', '621999', '622110', '622210', '622310',
  ],
  // Transportation & Warehousing (481-493)
  '48': [
    '481111', '481112', '481211', '481212', '481219',
    '484110', '484121', '484122', '484210', '484220',
    '488111', '488119', '488190', '488210', '488310',
    '488320', '488330', '488390', '488490', '488510', '488999',
    '492110', '492210', '493110', '493120', '493130', '493190',
  ],
  // Utilities & Energy (221)
  '221': ['221111', '221112', '221113', '221114', '221118', '221121', '221122', '221210', '221310', '221320', '221330'],
  // Educational Services (611)
  '611': ['611110', '611210', '611310', '611410', '611420', '611430', '611519', '611610', '611620', '611630', '611691', '611699', '611710'],
  // Waste Management (562)
  '562': ['562111', '562112', '562119', '562211', '562212', '562213', '562219', '562910', '562920', '562991', '562998'],
  // Scientific R&D (5417)
  '5417': ['541711', '541712', '541713', '541714', '541715', '541720'],
  // Manufacturing - Pharma/Chem (325)
  '325': ['325110', '325120', '325180', '325199', '325211', '325220', '325311', '325320', '325411', '325412', '325413', '325414', '325510', '325520', '325611', '325612', '325998'],
};

interface CoOccurrence {
  code: string;
  description?: string;
  count: number;
}

async function fetchPSCsForNAICS(naicsCode: string): Promise<CoOccurrence[]> {
  // Use spending_by_award to find awards with this NAICS, grouped by PSC
  const response = await fetch(`${USA_SPENDING_API}/search/spending_by_category/psc/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters: {
        naics_codes: [naicsCode],
        time_period: [
          { start_date: '2023-10-01', end_date: '2026-09-30' }, // FY2024-FY2026
        ],
        award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
      },
      category: 'psc',
      limit: 50,
      page: 1,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`USASpending API error ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const results: CoOccurrence[] = [];

  for (const item of data.results || []) {
    if (item.code && item.amount > 0) {
      results.push({
        code: item.code,
        description: item.name || undefined,
        count: Math.round(item.amount), // Using dollar amount as weight
      });
    }
  }

  // Sort by amount descending
  return results.sort((a, b) => b.count - a.count);
}

async function fetchNAICSForPSC(pscCode: string): Promise<CoOccurrence[]> {
  const response = await fetch(`${USA_SPENDING_API}/search/spending_by_category/naics/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters: {
        psc_codes: [pscCode],
        time_period: [
          { start_date: '2023-10-01', end_date: '2026-09-30' },
        ],
        award_type_codes: ['A', 'B', 'C', 'D'],
      },
      category: 'naics',
      limit: 50,
      page: 1,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`USASpending API error ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const results: CoOccurrence[] = [];

  for (const item of data.results || []) {
    if (item.code && item.amount > 0) {
      results.push({
        code: item.code,
        description: item.name || undefined,
        count: Math.round(item.amount),
      });
    }
  }

  return results.sort((a, b) => b.count - a.count);
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

  const mode = searchParams.get('mode') || 'preview';
  const sectorsParam = searchParams.get('sectors');
  const limitPerSector = parseInt(searchParams.get('limit') || '20') || 20;

  // Filter sectors if specified
  const sectorsToProcess = sectorsParam
    ? sectorsParam.split(',').filter(s => TARGET_NAICS[s.trim()])
    : Object.keys(TARGET_NAICS);

  if (mode === 'preview') {
    const totalNaics = sectorsToProcess.reduce(
      (sum, s) => sum + Math.min(TARGET_NAICS[s].length, limitPerSector), 0
    );

    return NextResponse.json({
      summary: {
        mode: 'preview',
        sectors: sectorsToProcess.length,
        totalNaicsCodes: totalNaics,
        estimatedApiCalls: totalNaics, // 1 call per NAICS code
        estimatedTime: `${Math.ceil(totalNaics * 0.4 / 60)} minutes`,
        message: 'Use mode=build to run extraction. Use sectors=541,23 to limit scope.',
      },
      sectors: sectorsToProcess.map(s => ({
        sector: s,
        naicsCodes: TARGET_NAICS[s].slice(0, limitPerSector),
        count: Math.min(TARGET_NAICS[s].length, limitPerSector),
      })),
    });
  }

  // Build mode
  console.log(`[build-psc-crosswalk] Starting build for ${sectorsToProcess.length} sectors...`);

  const naicsToPsc: Record<string, { matches: CoOccurrence[] }> = {};
  const pscToNaicsReverse: Record<string, Map<string, CoOccurrence>> = {};

  let processed = 0;
  let errors = 0;
  const errorDetails: Array<{ naics: string; error: string }> = [];

  for (const sector of sectorsToProcess) {
    const codes = TARGET_NAICS[sector].slice(0, limitPerSector);
    console.log(`[build-psc-crosswalk] Sector ${sector}: ${codes.length} NAICS codes`);

    for (const naicsCode of codes) {
      try {
        const pscMatches = await fetchPSCsForNAICS(naicsCode);

        if (pscMatches.length > 0) {
          // Store NAICS → PSC mapping (top 20)
          naicsToPsc[naicsCode] = {
            matches: pscMatches.slice(0, 20),
          };

          // Build reverse PSC → NAICS mapping
          for (const match of pscMatches.slice(0, 10)) {
            if (!pscToNaicsReverse[match.code]) {
              pscToNaicsReverse[match.code] = new Map();
            }
            const existing = pscToNaicsReverse[match.code].get(naicsCode);
            if (!existing || match.count > existing.count) {
              pscToNaicsReverse[match.code].set(naicsCode, {
                code: naicsCode,
                count: match.count,
              });
            }
          }
        }

        processed++;
        if (processed % 10 === 0) {
          console.log(`[build-psc-crosswalk] Processed ${processed} NAICS codes...`);
        }

        // Rate limit: 400ms between API calls
        await new Promise(resolve => setTimeout(resolve, 400));
      } catch (error: unknown) {
        errors++;
        const message = error instanceof Error ? error.message : String(error);
        errorDetails.push({ naics: naicsCode, error: message });
        console.warn(`[build-psc-crosswalk] Error for ${naicsCode}: ${message}`);

        // Back off on error
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // Convert reverse map to sorted arrays
  const pscToNaics: Record<string, { matches: CoOccurrence[] }> = {};
  for (const [psc, naicsMap] of Object.entries(pscToNaicsReverse)) {
    const sorted = Array.from(naicsMap.values()).sort((a, b) => b.count - a.count);
    pscToNaics[psc] = { matches: sorted.slice(0, 20) };
  }

  // Also do targeted reverse lookups for top PSC codes that appeared
  const topPSCs = Object.keys(pscToNaics)
    .sort((a, b) => {
      const aTotal = pscToNaics[a].matches.reduce((s, m) => s + m.count, 0);
      const bTotal = pscToNaics[b].matches.reduce((s, m) => s + m.count, 0);
      return bTotal - aTotal;
    })
    .slice(0, 30);

  console.log(`[build-psc-crosswalk] Enriching top ${topPSCs.length} PSC codes with direct lookups...`);

  for (const pscCode of topPSCs) {
    try {
      const naicsMatches = await fetchNAICSForPSC(pscCode);
      if (naicsMatches.length > 0) {
        pscToNaics[pscCode] = { matches: naicsMatches.slice(0, 20) };
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    } catch {
      // Non-critical — we already have reverse data
    }
  }

  const outputDatabase = {
    lastUpdated: new Date().toISOString(),
    version: 1,
    naicsToPsc,
    pscToNaics,
  };

  console.log(`[build-psc-crosswalk] Done. ${Object.keys(naicsToPsc).length} NAICS entries, ${Object.keys(pscToNaics).length} PSC entries.`);

  return NextResponse.json({
    summary: {
      mode: 'build',
      naicsProcessed: processed,
      errors,
      naicsEntries: Object.keys(naicsToPsc).length,
      pscEntries: Object.keys(pscToNaics).length,
      topPSCsEnriched: topPSCs.length,
    },
    errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    database: outputDatabase,
    instructions: 'Copy the "database" field content into src/data/psc-naics-crosswalk.json to persist.',
  });
}

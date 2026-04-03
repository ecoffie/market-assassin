/**
 * Refresh Contracts Cron Job
 *
 * Runs weekly to refresh/expand the local contracts-data.js file:
 * 1. Fetches new contracts from USASpending for tracked NAICS codes
 * 2. Merges with existing local data
 * 3. Removes expired contracts
 * 4. Writes updated contracts-data.js
 *
 * Schedule: Sunday 11 PM UTC (weekly)
 * Manual trigger: /api/cron/refresh-contracts?password=...&mode=preview|execute
 *
 * IMPORTANT: This modifies public/contracts-data.js which is deployed as a static file.
 * After execution, a new deployment is needed to update the live file.
 * For Vercel, set VERCEL_DEPLOY_HOOK_URL to auto-trigger deploy after refresh.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { INDUSTRY_PRESETS } from '@/lib/industry-presets';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 300; // 5 minutes

const CRON_SECRET = process.env.CRON_SECRET;
const USASPENDING_SEARCH_API = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

interface LocalContract {
  Recipient: string;
  Agency: string;
  Office?: string;
  NAICS: string;
  State?: string;
  'Total Value': string;
  Expiration: string;
  'Award ID': string;
  'Start Date': string;
}

interface USASpendingContract {
  'Award ID'?: string;
  'Recipient Name'?: string;
  'Awarding Agency'?: string;
  'Awarding Sub Agency'?: string;
  'NAICS Code'?: string;
  'NAICS Description'?: string;
  'Award Amount'?: number;
  'Start Date'?: string;
  'End Date'?: string;
  'Place of Performance State Code'?: string;
}

// Parse local date M/D/YYYY to Date
function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [month, day, year] = parts.map(Number);
  return new Date(year, month - 1, day);
}

// Format date as M/D/YYYY
function formatDate(date: Date): string {
  if (!date || isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

// Format value as currency
function formatCurrency(value: number): string {
  if (!value || typeof value !== 'number') return '$0.00';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Check if date is expired
function isExpired(dateStr: string): boolean {
  if (!dateStr) return true;
  const date = parseLocalDate(dateStr);
  if (!date) return true;
  return date < new Date();
}

// Fetch local contracts from our API
async function fetchLocalContracts(baseUrl: string): Promise<LocalContract[]> {
  try {
    const response = await fetch(`${baseUrl}/contracts-data.js?v=${Date.now()}`, {
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    const jsonStr = text.replace(/^[^[]*/, '').replace(/;?\s*$/, '');
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('[RefreshContracts] Error loading local contracts:', err);
    return [];
  }
}

// Fetch contracts from USASpending for a single NAICS
async function fetchUSASpendingContracts(naicsCode: string): Promise<USASpendingContract[]> {
  // Calculate date range: next 18 months of expirations
  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + 18);

  const formatDateISO = (d: Date) => d.toISOString().split('T')[0];

  try {
    const response = await fetch(USASPENDING_SEARCH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          award_type_codes: ['A', 'B', 'C', 'D'],
          naics_codes: [{ description: '', naics: naicsCode }],
          time_period: [{
            start_date: formatDateISO(startDate),
            end_date: formatDateISO(endDate),
            date_type: 'date_signed',
          }],
        },
        fields: [
          'Award ID',
          'Recipient Name',
          'Awarding Agency',
          'Awarding Sub Agency',
          'NAICS Code',
          'NAICS Description',
          'Award Amount',
          'Start Date',
          'End Date',
          'Place of Performance State Code',
        ],
        page: 1,
        limit: 100,
        sort: 'Award Amount',
        order: 'desc',
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();
    return data.results || [];
  } catch (err) {
    console.error(`[RefreshContracts] Error fetching NAICS ${naicsCode}:`, err);
    return [];
  }
}

// Convert USASpending contract to local format
function convertToLocalFormat(usa: USASpendingContract, naicsCode: string): LocalContract | null {
  if (!usa['Award ID'] || !usa['Recipient Name']) return null;

  // Parse dates
  let expiration = '';
  if (usa['End Date']) {
    const endDate = new Date(usa['End Date']);
    if (!isNaN(endDate.getTime())) {
      expiration = formatDate(endDate);
    }
  }

  let startDate = '';
  if (usa['Start Date']) {
    const start = new Date(usa['Start Date']);
    if (!isNaN(start.getTime())) {
      startDate = formatDate(start);
    }
  }

  // Skip if no expiration or already expired
  if (!expiration || isExpired(expiration)) return null;

  const naicsDisplay = usa['NAICS Code'] && usa['NAICS Description']
    ? `${usa['NAICS Code']} - ${usa['NAICS Description']}`
    : usa['NAICS Code'] || naicsCode;

  return {
    'Award ID': usa['Award ID'],
    Recipient: usa['Recipient Name'] || '',
    Agency: usa['Awarding Agency'] || '',
    Office: usa['Awarding Sub Agency'] || '',
    NAICS: naicsDisplay,
    State: usa['Place of Performance State Code'] || '',
    'Total Value': formatCurrency(usa['Award Amount'] || 0),
    Expiration: expiration,
    'Start Date': startDate,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';

  // Auth: Either Vercel cron, bearer token, or password
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${CRON_SECRET}`;
  const hasPassword = verifyAdminPassword(password);

  if (!isVercelCron && !hasCronSecret && !hasPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit for non-cron requests
  if (!isVercelCron && !hasCronSecret) {
    const ip = getClientIP(request);
    const rl = await checkAdminRateLimit(ip);
    if (!rl.allowed) return rateLimitResponse(rl);
  }

  const startTime = Date.now();
  const baseUrl = new URL(request.url).origin;

  console.log(`[RefreshContracts] Starting in ${mode} mode`);

  try {
    // Load existing contracts
    const existingContracts = await fetchLocalContracts(baseUrl);
    console.log(`[RefreshContracts] Loaded ${existingContracts.length} existing contracts`);

    // Build map of existing contracts by Award ID
    const contractMap = new Map<string, LocalContract>();
    for (const contract of existingContracts) {
      const awardId = contract['Award ID']?.split(' (')[0]?.trim();
      if (awardId) {
        contractMap.set(awardId, contract);
      }
    }

    // Get all unique NAICS codes from industry presets
    const naicsCodes = new Set<string>();
    for (const preset of INDUSTRY_PRESETS) {
      for (const code of preset.codes) {
        naicsCodes.add(code);
      }
    }

    // Also add popular federal contracting NAICS
    const popularNaics = [
      '541512', '541511', '541513', '541519', // IT
      '541611', '541612', '541614', '541618', // Consulting
      '541330', '541310', '541320', // Engineering
      '236220', '236210', '237110', '237310', // Construction
      '238210', '238220', '238160', // Specialty Contractors
      '561210', '561320', '561612', // Admin Services
    ];
    for (const code of popularNaics) {
      naicsCodes.add(code);
    }

    const naicsArray = Array.from(naicsCodes);
    console.log(`[RefreshContracts] Fetching from ${naicsArray.length} NAICS codes`);

    // Preview mode: Just report what would happen
    if (mode === 'preview') {
      // Sample: fetch first 3 NAICS to estimate
      let sampleNew = 0;
      for (const naics of naicsArray.slice(0, 3)) {
        const results = await fetchUSASpendingContracts(naics);
        for (const r of results) {
          const local = convertToLocalFormat(r, naics);
          if (local) {
            const awardId = local['Award ID']?.split(' (')[0]?.trim();
            if (awardId && !contractMap.has(awardId)) {
              sampleNew++;
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Remove expired from existing
      const activeContracts = existingContracts.filter(c => !isExpired(c.Expiration));
      const wouldRemove = existingContracts.length - activeContracts.length;

      return NextResponse.json({
        success: true,
        mode: 'preview',
        currentContracts: existingContracts.length,
        expiredToRemove: wouldRemove,
        naicsToQuery: naicsArray.length,
        estimatedNewContracts: Math.round(sampleNew * naicsArray.length / 3),
        processingTimeMs: Date.now() - startTime,
        message: 'Preview complete. Use mode=execute to run full refresh.',
        executeUrl: `${baseUrl}/api/cron/refresh-contracts?password=${password}&mode=execute`,
      });
    }

    // Execute mode: Full refresh
    let newCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    // Process each NAICS (with rate limiting)
    for (let i = 0; i < naicsArray.length; i++) {
      const naics = naicsArray[i];
      try {
        const results = await fetchUSASpendingContracts(naics);

        for (const r of results) {
          const local = convertToLocalFormat(r, naics);
          if (!local) continue;

          const awardId = local['Award ID']?.split(' (')[0]?.trim();
          if (!awardId) continue;

          const existing = contractMap.get(awardId);
          if (existing) {
            // Preserve State from existing if new doesn't have it
            if (existing.State && !local.State) {
              local.State = existing.State;
            }
            contractMap.set(awardId, local);
            updatedCount++;
          } else {
            contractMap.set(awardId, local);
            newCount++;
          }
        }

        // Rate limiting: 500ms between requests
        if (i < naicsArray.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Progress log every 10 NAICS
        if ((i + 1) % 10 === 0) {
          console.log(`[RefreshContracts] Progress: ${i + 1}/${naicsArray.length} NAICS processed`);
        }
      } catch (err) {
        errors.push(`NAICS ${naics}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Convert map to array
    let merged = Array.from(contractMap.values());

    // Remove expired
    const beforeFilter = merged.length;
    merged = merged.filter(c => !isExpired(c.Expiration));
    const expiredRemoved = beforeFilter - merged.length;

    // Sort by expiration (soonest first)
    merged.sort((a, b) => {
      const dateA = parseLocalDate(a.Expiration)?.getTime() || Date.now() + 999999999999;
      const dateB = parseLocalDate(b.Expiration)?.getTime() || Date.now() + 999999999999;
      return dateA - dateB;
    });

    console.log(`[RefreshContracts] Results: ${newCount} new, ${updatedCount} updated, ${expiredRemoved} expired removed`);
    console.log(`[RefreshContracts] Final count: ${merged.length}`);

    // Log refresh to database
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabase.from('cron_logs').insert({
      job_name: 'refresh-contracts',
      run_date: new Date().toISOString(),
      status: 'success',
      result: {
        previousCount: existingContracts.length,
        newCount,
        updatedCount,
        expiredRemoved,
        finalCount: merged.length,
        naicsQueried: naicsArray.length,
        errors: errors.length,
        processingTimeMs: Date.now() - startTime,
      },
    });

    // Note: In production, this would need to:
    // 1. Write to contracts-data.js in the repo
    // 2. Commit and push
    // 3. Trigger deployment
    //
    // For Vercel, we'd need either:
    // a) GitHub Actions workflow to update the file
    // b) Store contracts in database instead of static file
    // c) Use Vercel deploy hook after manual file update
    //
    // For now, return the data for manual update

    return NextResponse.json({
      success: true,
      mode: 'execute',
      stats: {
        previousCount: existingContracts.length,
        newContracts: newCount,
        updatedContracts: updatedCount,
        expiredRemoved,
        finalCount: merged.length,
        naicsQueried: naicsArray.length,
        errorsCount: errors.length,
      },
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      processingTimeMs: Date.now() - startTime,
      message: `Refresh complete. ${newCount} new contracts found. Run merge-xlsx-contracts.js locally to update the data file.`,
      // Include first 100 new contracts for review
      sampleNewContracts: merged.filter(c => {
        const awardId = c['Award ID']?.split(' (')[0]?.trim();
        return awardId && !existingContracts.some(e => e['Award ID']?.split(' (')[0]?.trim() === awardId);
      }).slice(0, 100),
    });

  } catch (error) {
    console.error('[RefreshContracts] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      processingTimeMs: Date.now() - startTime,
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}

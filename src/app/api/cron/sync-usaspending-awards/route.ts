/**
 * Cron: Sync USASpending Contract Awards to Local Cache
 *
 * GET /api/cron/sync-usaspending-awards
 *
 * Fetches recent contract awards from USASpending.gov and stores in Supabase.
 * This supplements SAM.gov data with winner names and award amounts.
 *
 * Runs weekly on Sunday at 11 PM ET via Vercel cron.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const USASPENDING_API = 'https://api.usaspending.gov/api/v2/search/spending_by_award';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// Popular NAICS codes for GovCon
const TARGET_NAICS = [
  '541512', // Computer Systems Design
  '541511', // Custom Software Development
  '541611', // Management Consulting
  '541330', // Engineering Services
  '541990', // Other Professional Services
  '561210', // Facilities Support
  '541519', // Other Computer Services
  '518210', // Data Processing
  '541715', // R&D Physical Sciences
  '541714', // R&D Biotechnology
];

interface USASpendingAward {
  internal_id: number;
  'Award ID': string;
  'Recipient Name': string;
  'Award Amount': number;
  'Awarding Agency': string;
  'Awarding Sub Agency': string;
  'Contract Award Type': string;
  'NAICS Code': string | null;
  'NAICS Description': string | null;
  'Place of Performance State Code': string;
  'Start Date': string;
  'End Date': string;
  Description: string;
  generated_internal_id: string;
}

async function fetchAwardsForNaics(naics: string, fiscalYear: number): Promise<USASpendingAward[]> {
  const payload = {
    filters: {
      time_period: [
        {
          start_date: `${fiscalYear - 1}-10-01`,
          end_date: `${fiscalYear}-09-30`,
        },
      ],
      award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
      naics_codes: {
        require: [naics],
      },
    },
    fields: [
      'Award ID',
      'Recipient Name',
      'Award Amount',
      'Awarding Agency',
      'Awarding Sub Agency',
      'Contract Award Type',
      'NAICS Code',
      'NAICS Description',
      'Place of Performance State Code',
      'Start Date',
      'End Date',
      'Description',
      'generated_internal_id',
    ],
    limit: 100,
    page: 1,
    sort: 'Award Amount',
    order: 'desc',
    subawards: false,
  };

  const response = await fetch(USASPENDING_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`USASpending API error: ${response.status}`);
  }

  const data = await response.json();
  return data.results || [];
}

function mapToDbRecord(award: USASpendingAward, naics: string) {
  return {
    award_id: award['Award ID'],
    recipient_name: award['Recipient Name'],
    award_amount: award['Award Amount'],
    awarding_agency: award['Awarding Agency'],
    awarding_sub_agency: award['Awarding Sub Agency'],
    contract_type: award['Contract Award Type'],
    naics_code: award['NAICS Code'] || naics,
    naics_description: award['NAICS Description'],
    pop_state: award['Place of Performance State Code'],
    start_date: award['Start Date'],
    end_date: award['End Date'],
    description: award.Description?.substring(0, 5000) || null,
    usaspending_id: award.generated_internal_id,
    synced_at: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const dryRun = searchParams.get('dry_run') === 'true';
  const naicsParam = searchParams.get('naics'); // Optional: specific NAICS codes

  const isAuthorized =
    password === ADMIN_PASSWORD || cronSecret === process.env.CRON_SECRET;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const fiscalYear = new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  const naicsList = naicsParam ? naicsParam.split(',') : TARGET_NAICS;

  let totalFetched = 0;
  let totalUpserted = 0;
  const errors: string[] = [];
  const results: Record<string, number> = {};

  console.log(`[sync-usaspending] Starting sync for FY${fiscalYear}, NAICS: ${naicsList.join(', ')}`);

  for (const naics of naicsList) {
    try {
      // Rate limit: wait 500ms between requests
      if (totalFetched > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const awards = await fetchAwardsForNaics(naics, fiscalYear);
      totalFetched += awards.length;
      results[naics] = awards.length;

      if (!dryRun && awards.length > 0) {
        const records = awards.map((a) => mapToDbRecord(a, naics));

        const { error: upsertError } = await getSupabase()
          .from('usaspending_awards')
          .upsert(records, { onConflict: 'award_id', ignoreDuplicates: false });

        if (upsertError) {
          errors.push(`NAICS ${naics}: ${upsertError.message}`);
          console.error(`[sync-usaspending] Upsert error for ${naics}:`, upsertError);
        } else {
          totalUpserted += records.length;
        }
      }

      console.log(`[sync-usaspending] NAICS ${naics}: ${awards.length} awards`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`NAICS ${naics}: ${errMsg}`);
      console.error(`[sync-usaspending] Error fetching ${naics}:`, err);
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log(
    `[sync-usaspending] Completed: ${totalFetched} fetched, ${totalUpserted} upserted, ${duration}s`
  );

  return NextResponse.json({
    success: errors.length === 0,
    dryRun,
    fiscalYear,
    stats: {
      totalFetched,
      totalUpserted,
      naicsQueried: naicsList.length,
      durationSeconds: duration,
      errorsCount: errors.length,
    },
    resultsByNaics: results,
    errors: errors.slice(0, 10),
    topAwards: await getTopAwards(),
  });
}

// Helper: Get sample top awards for response
async function getTopAwards() {
  const { data } = await getSupabase()
    .from('usaspending_awards')
    .select('recipient_name, award_amount, awarding_agency, naics_code')
    .order('award_amount', { ascending: false })
    .limit(5);

  return data || [];
}

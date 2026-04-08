/**
 * Recompete Sync Agent
 *
 * Syncs expiring federal contracts from USASpending to recompete_opportunities table.
 * Part of Federal Market Intelligence System - Phase 4.
 *
 * GET /api/admin/sync-recompete?password=...
 *   Returns current sync status and stats
 *
 * POST /api/admin/sync-recompete?password=...
 *   Triggers a new sync run
 *   Optional params:
 *     ?naics=541512,541611    Filter by NAICS codes (comma-separated)
 *     ?months=18              Contracts expiring within N months (default: 18)
 *     ?minValue=100000        Minimum contract value (default: 100000)
 *     ?limit=500              Max contracts to sync (default: 500)
 *     ?dryRun=true            Preview without saving
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// Default NAICS codes to sync (IT, Engineering, Consulting)
const DEFAULT_NAICS = [
  '541512', // Computer Systems Design
  '541511', // Custom Computer Programming
  '541611', // Administrative Management Consulting
  '541330', // Engineering Services
  '541990', // Other Professional Services
  '541519', // Other Computer Related Services
  '518210', // Data Processing Services
  '561210', // Facilities Support Services
  '541715', // R&D Physical/Engineering/Life Sciences
  '541714', // R&D Biotechnology
];

interface USASpendingContract {
  generated_unique_award_id: string;
  award_id_piid: string;
  recipient_name: string;
  recipient_uei: string;
  awarding_agency_name: string;
  awarding_sub_agency_name: string;
  awarding_office_name: string;
  awarding_office_code: string;
  funding_agency_name: string;
  naics_code: string;
  naics_description: string;
  product_or_service_code: string;
  product_or_service_code_description: string;
  award_description: string;
  total_obligated_amount: number;
  base_and_exercised_options_value: number;
  potential_total_value_of_award: number;
  period_of_performance_start_date: string;
  period_of_performance_current_end_date: string;
  period_of_performance_potential_end_date: string;
  last_modified_date: string;
  primary_place_of_performance_state_code: string;
  primary_place_of_performance_city_name: string;
  primary_place_of_performance_zip: string;
  type_of_contract_pricing: string;
  type_of_set_aside: string;
  extent_competed: string;
  number_of_offers_received: number;
}

async function fetchExpiringContracts(params: {
  naicsCodes: string[];
  monthsAhead: number;
  minValue: number;
  limit: number;
}): Promise<USASpendingContract[]> {
  const { naicsCodes, monthsAhead, minValue, limit } = params;

  // Calculate date range for contracts expiring in the future
  const today = new Date();
  const futureDate = new Date();
  futureDate.setMonth(futureDate.getMonth() + monthsAhead);

  const todayStr = today.toISOString().split('T')[0];
  const futureStr = futureDate.toISOString().split('T')[0];

  // Use the new awards endpoint (same as MCP tool)
  // Make parallel requests per NAICS code
  const allContracts: USASpendingContract[] = [];

  for (const naics of naicsCodes) {
    const requestBody = {
      filters: {
        award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only (required!)
        naics_codes: [naics],
        time_period: [
          {
            start_date: '2020-01-01',
            end_date: todayStr,
          },
        ],
      },
      fields: [
        'Award ID',
        'Recipient Name',
        'Recipient UEI',
        'Awarding Agency',
        'Awarding Sub Agency',
        'Awarding Office Name',
        'Funding Agency',
        'NAICS Code',
        'NAICS Description',
        'Product or Service Code',
        'Award Description',
        'Award Amount',
        'Start Date',
        'End Date',
        'Place of Performance State Code',
        'Place of Performance City Name',
        'Contract Award Type',
        'Type of Set Aside',
        'Extent Competed',
      ],
      page: 1,
      limit: Math.min(limit, 100),
      sort: 'Award Amount',
      order: 'desc',
    };

    console.log(`[Recompete Sync] Fetching NAICS ${naics} from USASpending...`);

    const response = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`USASpending API error for NAICS ${naics}:`, response.status, errorText);
      continue; // Skip this NAICS, try others
    }

    const data = await response.json();
    console.log(`[Recompete Sync] NAICS ${naics}: Got ${data.results?.length || 0} results`);

    for (const award of data.results || []) {
      const endDateStr = award['End Date'];
      const totalValue = parseFloat(award['Award Amount'] || '0');

      if (!endDateStr) continue;
      if (totalValue < minValue) continue;

      const contractEndDate = new Date(endDateStr);

      // Only include contracts expiring in our window (future, but within monthsAhead)
      if (contractEndDate > today && contractEndDate <= futureDate) {
        allContracts.push({
          generated_unique_award_id: award['Award ID'] || `award-${Date.now()}-${Math.random()}`,
          award_id_piid: award['Award ID'],
          recipient_name: award['Recipient Name'] || 'Unknown',
          recipient_uei: award['Recipient UEI'],
          awarding_agency_name: award['Awarding Agency'] || 'Unknown',
          awarding_sub_agency_name: award['Awarding Sub Agency'],
          awarding_office_name: award['Awarding Office Name'],
          awarding_office_code: '',
          funding_agency_name: award['Funding Agency'],
          naics_code: award['NAICS Code'] || naics,
          naics_description: award['NAICS Description'],
          product_or_service_code: award['Product or Service Code'],
          product_or_service_code_description: '',
          award_description: award['Award Description'],
          total_obligated_amount: totalValue,
          base_and_exercised_options_value: 0,
          potential_total_value_of_award: totalValue,
          period_of_performance_start_date: award['Start Date'],
          period_of_performance_current_end_date: endDateStr,
          period_of_performance_potential_end_date: '',
          last_modified_date: '',
          primary_place_of_performance_state_code: award['Place of Performance State Code'],
          primary_place_of_performance_city_name: award['Place of Performance City Name'],
          primary_place_of_performance_zip: '',
          type_of_contract_pricing: award['Contract Award Type'],
          type_of_set_aside: award['Type of Set Aside'],
          extent_competed: award['Extent Competed'],
          number_of_offers_received: 0,
        });
      }
    }

    // Small delay between requests to be nice to the API
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Deduplicate by Award ID
  const seen = new Set<string>();
  const contracts = allContracts.filter(c => {
    if (seen.has(c.award_id_piid)) return false;
    seen.add(c.award_id_piid);
    return true;
  });

  console.log(`[Recompete Sync] Total: ${contracts.length} unique contracts expiring between ${todayStr} and ${futureStr}`);
  return contracts;
}

// Helper to convert empty strings to null for date fields
function toDateOrNull(value: string | null | undefined): string | null {
  if (!value || value.trim() === '') return null;
  return value;
}

function transformToRecompeteOpportunity(contract: USASpendingContract) {
  return {
    contract_id: contract.generated_unique_award_id,
    award_id: contract.award_id_piid,
    piid: contract.award_id_piid,
    incumbent_name: contract.recipient_name || 'Unknown',
    incumbent_uei: contract.recipient_uei || null,
    awarding_agency: contract.awarding_agency_name || 'Unknown',
    awarding_sub_agency: contract.awarding_sub_agency_name || null,
    awarding_office: contract.awarding_office_name || null,
    awarding_office_code: contract.awarding_office_code || null,
    funding_agency: contract.funding_agency_name || null,
    naics_code: contract.naics_code || null,
    naics_description: contract.naics_description || null,
    psc_code: contract.product_or_service_code || null,
    psc_description: contract.product_or_service_code_description || null,
    description: contract.award_description || null,
    total_obligation: contract.total_obligated_amount,
    base_and_exercised_options: contract.base_and_exercised_options_value || null,
    potential_total_value: contract.potential_total_value_of_award || null,
    period_of_performance_start: toDateOrNull(contract.period_of_performance_start_date),
    period_of_performance_current_end: toDateOrNull(contract.period_of_performance_current_end_date),
    period_of_performance_potential_end: toDateOrNull(contract.period_of_performance_potential_end_date),
    last_modified_date: toDateOrNull(contract.last_modified_date),
    place_of_performance_state: contract.primary_place_of_performance_state_code || null,
    place_of_performance_city: contract.primary_place_of_performance_city_name || null,
    place_of_performance_zip: contract.primary_place_of_performance_zip || null,
    contract_type: contract.type_of_contract_pricing || null,
    set_aside_type: contract.type_of_set_aside || null,
    competition_type: contract.extent_competed || null,
    number_of_offers: contract.number_of_offers_received || null,
    data_source: 'usaspending',
    source_url: `https://www.usaspending.gov/award/${contract.generated_unique_award_id}`,
    last_synced_at: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get latest sync run
  const { data: lastRun, error: runError } = await supabase
    .from('recompete_sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  // Get stats
  const { data: stats } = await supabase
    .from('recompete_stats')
    .select('*')
    .single();

  return NextResponse.json({
    success: true,
    lastSync: lastRun || null,
    stats: stats || null,
    endpoints: {
      trigger: 'POST /api/admin/sync-recompete?password=...',
      status: 'GET /api/admin/sync-recompete?password=...',
      api: '/api/recompete',
    },
  });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Parse parameters
  const naicsParam = searchParams.get('naics');
  const monthsParam = searchParams.get('months') || '18';
  const minValueParam = searchParams.get('minValue') || '100000';
  const limitParam = searchParams.get('limit') || '500';
  const dryRun = searchParams.get('dryRun') === 'true';

  const naicsCodes = naicsParam ? naicsParam.split(',').map(n => n.trim()) : DEFAULT_NAICS;
  const monthsAhead = parseInt(monthsParam, 10) || 18;
  const minValue = parseFloat(minValueParam) || 100000;
  const limit = Math.min(parseInt(limitParam, 10) || 500, 1000);

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Create sync run record
  const { data: syncRun, error: createError } = await supabase
    .from('recompete_sync_runs')
    .insert({
      status: 'running',
      naics_filter: naicsCodes,
      months_ahead: monthsAhead,
      min_value: minValue,
    })
    .select()
    .single();

  if (createError) {
    console.error('Failed to create sync run:', createError);
    return NextResponse.json({
      success: false,
      error: 'Failed to create sync run',
      details: createError.message,
    }, { status: 500 });
  }

  const runId = syncRun.id;
  const errors: string[] = [];
  let contractsFetched = 0;
  let contractsInserted = 0;
  let contractsUpdated = 0;
  let contractsUnchanged = 0;

  try {
    console.log(`[Recompete Sync ${runId}] Starting sync with NAICS: ${naicsCodes.join(', ')}`);

    // Fetch contracts from USASpending
    const contracts = await fetchExpiringContracts({
      naicsCodes,
      monthsAhead,
      minValue,
      limit,
    });

    contractsFetched = contracts.length;
    console.log(`[Recompete Sync ${runId}] Fetched ${contractsFetched} contracts from USASpending`);

    if (dryRun) {
      // Update sync run with results
      await supabase
        .from('recompete_sync_runs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          contracts_fetched: contractsFetched,
          contracts_inserted: 0,
          contracts_updated: 0,
          contracts_unchanged: contractsFetched,
          errors,
          result: {
            dryRun: true,
            sampleContracts: contracts.slice(0, 5).map(c => ({
              id: c.generated_unique_award_id,
              incumbent: c.recipient_name,
              agency: c.awarding_agency_name,
              value: c.total_obligated_amount,
              endDate: c.period_of_performance_current_end_date,
            })),
          },
        })
        .eq('id', runId);

      return NextResponse.json({
        success: true,
        dryRun: true,
        runId,
        contractsFetched,
        sampleContracts: contracts.slice(0, 10).map(c => ({
          id: c.generated_unique_award_id,
          incumbent: c.recipient_name,
          agency: c.awarding_agency_name,
          naics: c.naics_code,
          value: c.total_obligated_amount,
          endDate: c.period_of_performance_current_end_date,
          state: c.primary_place_of_performance_state_code,
        })),
      });
    }

    // Upsert contracts to database
    for (const contract of contracts) {
      const opportunity = transformToRecompeteOpportunity(contract);

      // Check if exists
      const { data: existing } = await supabase
        .from('recompete_opportunities')
        .select('id, total_obligation, period_of_performance_current_end')
        .eq('contract_id', opportunity.contract_id)
        .single();

      if (existing) {
        // Check if update needed
        const needsUpdate =
          existing.total_obligation !== opportunity.total_obligation ||
          existing.period_of_performance_current_end !== opportunity.period_of_performance_current_end;

        if (needsUpdate) {
          const { error: updateError } = await supabase
            .from('recompete_opportunities')
            .update(opportunity)
            .eq('id', existing.id);

          if (updateError) {
            errors.push(`Update failed for ${opportunity.contract_id}: ${updateError.message}`);
          } else {
            contractsUpdated++;
          }
        } else {
          contractsUnchanged++;
        }
      } else {
        // Insert new
        const { error: insertError } = await supabase
          .from('recompete_opportunities')
          .insert(opportunity);

        if (insertError) {
          errors.push(`Insert failed for ${opportunity.contract_id}: ${insertError.message}`);
        } else {
          contractsInserted++;
        }
      }
    }

    console.log(`[Recompete Sync ${runId}] Completed: ${contractsInserted} inserted, ${contractsUpdated} updated, ${contractsUnchanged} unchanged`);

    // Update sync run
    await supabase
      .from('recompete_sync_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        contracts_fetched: contractsFetched,
        contracts_inserted: contractsInserted,
        contracts_updated: contractsUpdated,
        contracts_unchanged: contractsUnchanged,
        errors: errors.length > 0 ? errors : null,
        result: {
          naicsCodes,
          monthsAhead,
          minValue,
          limit,
        },
      })
      .eq('id', runId);

    return NextResponse.json({
      success: true,
      runId,
      contractsFetched,
      contractsInserted,
      contractsUpdated,
      contractsUnchanged,
      errors: errors.length > 0 ? errors : undefined,
      stats: {
        naicsCodes,
        monthsAhead,
        minValue,
        limit,
      },
    });
  } catch (error) {
    console.error(`[Recompete Sync ${runId}] Error:`, error);

    // Update sync run with error
    await supabase
      .from('recompete_sync_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        contracts_fetched: contractsFetched,
        contracts_inserted: contractsInserted,
        contracts_updated: contractsUpdated,
        contracts_unchanged: contractsUnchanged,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      })
      .eq('id', runId);

    return NextResponse.json({
      success: false,
      runId,
      error: error instanceof Error ? error.message : 'Sync failed',
      contractsFetched,
      contractsInserted,
      contractsUpdated,
    }, { status: 500 });
  }
}

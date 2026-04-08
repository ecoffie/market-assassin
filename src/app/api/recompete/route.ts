/**
 * Recompete Intelligence API
 *
 * Returns expiring federal contracts for recompete opportunity tracking.
 * Part of Federal Market Intelligence System - Phase 4.
 *
 * GET /api/recompete
 *   ?naics=541512           Filter by NAICS code
 *   ?agency=DOD             Filter by agency (name or abbreviation)
 *   ?state=FL               Filter by place of performance state
 *   ?months=18              Contracts expiring within N months (default: 18)
 *   ?minValue=1000000       Minimum contract value
 *   ?maxValue=50000000      Maximum contract value
 *   ?incumbent=Booz         Search by incumbent name
 *   ?setAside=SDVOSB        Filter by set-aside type
 *   ?likelihood=high        Filter by recompete likelihood (high, medium, low)
 *   ?limit=50               Results per page (default: 50, max: 200)
 *   ?offset=0               Pagination offset
 *   ?sort=value             Sort field (value, date, agency, incumbent)
 *   ?order=desc             Sort order (asc, desc)
 *
 * GET /api/recompete?stats=true
 *   Returns summary statistics
 *
 * GET /api/recompete?id={contractId}
 *   Returns single contract details
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Agency name normalization
const agencyAliases: Record<string, string[]> = {
  'DEPARTMENT OF DEFENSE': ['DOD', 'DEFENSE', 'PENTAGON'],
  'DEPARTMENT OF THE NAVY': ['NAVY', 'USN', 'DON'],
  'DEPARTMENT OF THE ARMY': ['ARMY', 'USA'],
  'DEPARTMENT OF THE AIR FORCE': ['AIR FORCE', 'USAF', 'AF'],
  'DEPARTMENT OF VETERANS AFFAIRS': ['VA', 'VETERANS'],
  'DEPARTMENT OF HEALTH AND HUMAN SERVICES': ['HHS', 'HEALTH'],
  'GENERAL SERVICES ADMINISTRATION': ['GSA'],
  'DEPARTMENT OF HOMELAND SECURITY': ['DHS', 'HOMELAND'],
  'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION': ['NASA'],
  'DEPARTMENT OF ENERGY': ['DOE', 'ENERGY'],
  'DEFENSE LOGISTICS AGENCY': ['DLA'],
  'ENVIRONMENTAL PROTECTION AGENCY': ['EPA'],
};

function normalizeAgencyName(input: string): string[] {
  const upper = input.toUpperCase().trim();

  // Check if input is an alias
  for (const [fullName, aliases] of Object.entries(agencyAliases)) {
    if (aliases.includes(upper) || fullName.includes(upper)) {
      return [fullName, ...aliases];
    }
  }

  // Return as-is for partial matching
  return [input];
}

interface RecompeteOpportunity {
  id: string;
  contract_id: string;
  award_id: string;
  incumbent_name: string;
  incumbent_uei: string;
  awarding_agency: string;
  awarding_sub_agency: string;
  awarding_office: string;
  naics_code: string;
  naics_description: string;
  psc_code: string;
  description: string;
  total_obligation: number;
  potential_total_value: number;
  period_of_performance_start: string;
  period_of_performance_current_end: string;
  place_of_performance_state: string;
  place_of_performance_city: string;
  set_aside_type: string;
  competition_type: string;
  number_of_offers: number;
  options_exercised: number;
  options_remaining: number;
  estimated_recompete_date: string;
  lead_time_months: number;
  recompete_likelihood: string;
  last_synced_at: string;
}

interface RecompeteStats {
  total_contracts: number;
  total_value: number;
  high_likelihood: number;
  medium_likelihood: number;
  low_likelihood: number;
  expiring_6_months: number;
  expiring_12_months: number;
  expiring_18_months: number;
  agencies: number;
  incumbents: number;
  naics_codes: number;
  last_sync: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Parse parameters
  const naicsParam = searchParams.get('naics');
  const agencyParam = searchParams.get('agency');
  const stateParam = searchParams.get('state');
  const monthsParam = searchParams.get('months') || '18';
  const minValueParam = searchParams.get('minValue');
  const maxValueParam = searchParams.get('maxValue');
  const incumbentParam = searchParams.get('incumbent');
  const setAsideParam = searchParams.get('setAside');
  const likelihoodParam = searchParams.get('likelihood');
  const limitParam = searchParams.get('limit') || '50';
  const offsetParam = searchParams.get('offset') || '0';
  const sortParam = searchParams.get('sort') || 'value';
  const orderParam = searchParams.get('order') || 'desc';
  const statsParam = searchParams.get('stats');
  const idParam = searchParams.get('id');

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Return stats if requested
  if (statsParam === 'true') {
    const { data: stats, error } = await supabase
      .from('recompete_stats')
      .select('*')
      .single();

    if (error) {
      // If view doesn't exist yet, return empty stats
      return NextResponse.json({
        success: true,
        stats: {
          total_contracts: 0,
          total_value: 0,
          high_likelihood: 0,
          medium_likelihood: 0,
          low_likelihood: 0,
          expiring_6_months: 0,
          expiring_12_months: 0,
          expiring_18_months: 0,
          agencies: 0,
          incumbents: 0,
          naics_codes: 0,
          last_sync: null,
          message: 'No data synced yet. Run /api/admin/sync-recompete to populate.',
        },
      });
    }

    return NextResponse.json({
      success: true,
      stats,
    });
  }

  // Return single contract if ID provided
  if (idParam) {
    const { data: contract, error } = await supabase
      .from('recompete_opportunities')
      .select('*')
      .eq('contract_id', idParam)
      .single();

    if (error || !contract) {
      return NextResponse.json(
        { success: false, error: 'Contract not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      contract,
    });
  }

  // Build query
  let query = supabase
    .from('recompete_opportunities')
    .select('*', { count: 'exact' });

  // Filter: contracts expiring in the future
  const monthsAhead = parseInt(monthsParam, 10) || 18;
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + monthsAhead);
  query = query
    .gt('period_of_performance_current_end', new Date().toISOString().split('T')[0])
    .lte('period_of_performance_current_end', maxDate.toISOString().split('T')[0]);

  // NAICS filter
  if (naicsParam) {
    // Support prefix matching (e.g., 541 matches 541512)
    if (naicsParam.length < 6) {
      query = query.like('naics_code', `${naicsParam}%`);
    } else {
      query = query.eq('naics_code', naicsParam);
    }
  }

  // Agency filter
  if (agencyParam) {
    const agencyNames = normalizeAgencyName(agencyParam);
    // Use ilike for partial matching
    query = query.or(
      agencyNames.map((name) => `awarding_agency.ilike.%${name}%`).join(',')
    );
  }

  // State filter
  if (stateParam) {
    query = query.eq('place_of_performance_state', stateParam.toUpperCase());
  }

  // Value filters
  if (minValueParam) {
    const minValue = parseFloat(minValueParam);
    if (!isNaN(minValue)) {
      query = query.gte('total_obligation', minValue);
    }
  }
  if (maxValueParam) {
    const maxValue = parseFloat(maxValueParam);
    if (!isNaN(maxValue)) {
      query = query.lte('total_obligation', maxValue);
    }
  }

  // Incumbent search
  if (incumbentParam) {
    query = query.ilike('incumbent_name', `%${incumbentParam}%`);
  }

  // Set-aside filter
  if (setAsideParam) {
    query = query.ilike('set_aside_type', `%${setAsideParam}%`);
  }

  // Likelihood filter
  if (likelihoodParam && ['high', 'medium', 'low'].includes(likelihoodParam)) {
    query = query.eq('recompete_likelihood', likelihoodParam);
  }

  // Sorting
  const sortField = {
    value: 'total_obligation',
    date: 'period_of_performance_current_end',
    agency: 'awarding_agency',
    incumbent: 'incumbent_name',
    lead_time: 'lead_time_months',
  }[sortParam] || 'total_obligation';

  query = query.order(sortField, { ascending: orderParam === 'asc' });

  // Pagination
  const limit = Math.min(parseInt(limitParam, 10) || 50, 200);
  const offset = parseInt(offsetParam, 10) || 0;
  query = query.range(offset, offset + limit - 1);

  // Execute query
  const { data: contracts, count, error } = await query;

  if (error) {
    console.error('Recompete query error:', error);

    // Check if table doesn't exist yet
    if (error.message?.includes('does not exist')) {
      return NextResponse.json({
        success: false,
        error: 'Recompete table not initialized. Run migration first.',
        migration: 'supabase/migrations/20260405_recompete_intelligence.sql',
      }, { status: 500 });
    }

    return NextResponse.json(
      { success: false, error: 'Database query failed' },
      { status: 500 }
    );
  }

  // Calculate summary for response
  const totalValue = contracts?.reduce(
    (sum, c) => sum + (c.total_obligation || 0),
    0
  ) || 0;

  const likelyhoodCounts = {
    high: contracts?.filter((c) => c.recompete_likelihood === 'high').length || 0,
    medium: contracts?.filter((c) => c.recompete_likelihood === 'medium').length || 0,
    low: contracts?.filter((c) => c.recompete_likelihood === 'low').length || 0,
  };

  // Get top incumbents from results
  const incumbentCounts: Record<string, number> = {};
  contracts?.forEach((c) => {
    const name = c.incumbent_name || 'Unknown';
    incumbentCounts[name] = (incumbentCounts[name] || 0) + 1;
  });
  const topIncumbents = Object.entries(incumbentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  return NextResponse.json({
    success: true,
    query: {
      naics: naicsParam,
      agency: agencyParam,
      state: stateParam,
      months: monthsAhead,
      minValue: minValueParam,
      maxValue: maxValueParam,
      incumbent: incumbentParam,
      setAside: setAsideParam,
      likelihood: likelihoodParam,
    },
    pagination: {
      limit,
      offset,
      total: count || 0,
      hasMore: (offset + limit) < (count || 0),
    },
    summary: {
      resultCount: contracts?.length || 0,
      totalValue,
      totalValueFormatted: `$${(totalValue / 1000000).toFixed(1)}M`,
      byLikelihood: likelyhoodCounts,
      topIncumbents,
    },
    contracts: contracts || [],
    endpoints: {
      stats: '/api/recompete?stats=true',
      byNaics: '/api/recompete?naics=541512',
      byAgency: '/api/recompete?agency=DOD',
      byState: '/api/recompete?state=FL',
      highValue: '/api/recompete?minValue=10000000',
      highLikelihood: '/api/recompete?likelihood=high',
      syncData: '/api/admin/sync-recompete?password=...',
    },
  });
}

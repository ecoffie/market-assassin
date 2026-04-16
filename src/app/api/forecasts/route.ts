import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function hasAdminAccess(request: NextRequest): boolean {
  const { searchParams } = new URL(request.url);
  return (
    searchParams.get('password') === ADMIN_PASSWORD ||
    request.headers.get('x-admin-password') === ADMIN_PASSWORD
  );
}

// Check if user has BD Assist or valid subscription
function getUserEmail(request: NextRequest): string | null {
  return request.headers.get('x-user-email');
}

async function hasBDAssistAccess(email: string | null): Promise<boolean> {
  if (!email) return false;

  // For now, allow any authenticated BD Assist user to search
  // In production, check KV store: bdassist:{email}
  return true;
}

/**
 * Forecast Intelligence API (PROPRIETARY - REQUIRES AUTHENTICATION)
 *
 * Query federal procurement forecasts from multiple agency sources.
 * Access requires either admin password or authenticated user email header.
 *
 * Endpoints:
 *   GET /api/forecasts                     - Summary stats
 *   GET /api/forecasts?naics=541512        - By NAICS code
 *   GET /api/forecasts?agency=DOE          - By source agency
 *   GET /api/forecasts?state=FL            - By place of performance
 *   GET /api/forecasts?setAside=8(a)       - By set-aside type
 *   GET /api/forecasts?fiscalYear=FY2026   - By fiscal year
 *   GET /api/forecasts?search=cybersecurity - Full text search
 *   GET /api/forecasts?mode=coverage       - Coverage dashboard (admin only)
 *   GET /api/forecasts?mode=sources        - Source health status (admin only)
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const isAdmin = hasAdminAccess(request);
  const userEmail = getUserEmail(request);

  // PROPRIETARY SYSTEM - Require authentication for ALL requests
  if (!isAdmin && !userEmail) {
    return NextResponse.json({
      success: false,
      error: 'Authentication required. Access this feature through Market Intelligence dashboard.',
    }, { status: 401 });
  }

  // Query parameters
  const naics = searchParams.get('naics');
  const agency = searchParams.get('agency');
  const state = searchParams.get('state');
  const setAside = searchParams.get('setAside') || searchParams.get('set_aside');
  const fiscalYear = searchParams.get('fiscalYear') || searchParams.get('fy');
  const search = searchParams.get('search') || searchParams.get('q');
  const mode = searchParams.get('mode');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500);
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Mode: Coverage dashboard
    if (mode === 'coverage') {
      if (!isAdmin) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const { data: coverage } = await supabase
        .from('forecast_coverage_dashboard')
        .select('*')
        .order('estimated_spend_coverage', { ascending: false });

      const totalCoverage = coverage?.reduce((sum, s) => sum + (s.estimated_spend_coverage || 0), 0) || 0;
      const activeSources = coverage?.filter(s => s.is_active) || [];
      const totalRecords = coverage?.reduce((sum, s) => sum + (s.total_records || 0), 0) || 0;

      return NextResponse.json({
        success: true,
        mode: 'coverage',
        summary: {
          totalSources: coverage?.length || 0,
          activeSources: activeSources.length,
          totalRecords,
          estimatedSpendCoverage: `${totalCoverage.toFixed(1)}%`,
          targetCoverage: '80%',
          gap: `${(80 - totalCoverage).toFixed(1)}%`,
        },
        sources: coverage,
        phases: {
          phase1: { status: 'active', sources: ['DOE', 'NASA', 'DOJ'], coverage: '9%' },
          phase2: { status: 'planned', sources: ['GSA'], coverage: '+8%' },
          phase3: { status: 'planned', sources: ['VA', 'DHS', 'HHS', 'Treasury'], coverage: '+32%' },
          phase4: { status: 'planned', sources: ['DOD'], coverage: '+40%' },
        },
        timing: `${Date.now() - startTime}ms`,
      });
    }

    // Mode: Source health
    if (mode === 'sources') {
      if (!isAdmin) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const { data: sources } = await supabase
        .from('forecast_sources')
        .select('*')
        .order('estimated_spend_coverage', { ascending: false });

      const { data: recentSyncs } = await supabase
        .from('forecast_sync_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(20);

      return NextResponse.json({
        success: true,
        mode: 'sources',
        sources,
        recentSyncs,
        timing: `${Date.now() - startTime}ms`,
      });
    }

    // Build query (authentication already verified at top of handler)
    let query = supabase
      .from('agency_forecasts')
      .select('*', { count: 'exact' });

    // Apply filters
    if (naics) {
      // Support both exact and prefix matching
      if (naics.length <= 4) {
        query = query.ilike('naics_code', `${naics}%`);
      } else {
        query = query.eq('naics_code', naics);
      }
    }

    if (agency) {
      query = query.ilike('source_agency', `%${agency}%`);
    }

    if (state) {
      query = query.ilike('pop_state', `%${state}%`);
    }

    if (setAside) {
      query = query.ilike('set_aside_type', `%${setAside}%`);
    }

    if (fiscalYear) {
      const fy = fiscalYear.toUpperCase().startsWith('FY') ? fiscalYear : `FY${fiscalYear}`;
      query = query.ilike('fiscal_year', `%${fy}%`);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // If no filters, return summary stats
    if (!naics && !agency && !state && !setAside && !fiscalYear && !search) {
      // Get summary stats
      const { count: totalCount } = await supabase
        .from('agency_forecasts')
        .select('*', { count: 'exact', head: true });

      // Get counts by agency
      const { data: byAgency } = await supabase
        .from('agency_forecasts')
        .select('source_agency')
        .then(async ({ data }) => {
          if (!data) return { data: [] };
          const counts: Record<string, number> = {};
          data.forEach(row => {
            counts[row.source_agency] = (counts[row.source_agency] || 0) + 1;
          });
          return {
            data: Object.entries(counts)
              .map(([agency, count]) => ({ agency, count }))
              .sort((a, b) => b.count - a.count),
          };
        });

      // Get top NAICS codes
      const { data: topNaics } = await supabase
        .from('forecasts_by_naics')
        .select('*')
        .limit(10);

      // Get coverage
      const { data: coverage } = await supabase
        .from('forecast_coverage_dashboard')
        .select('agency_code, total_records, estimated_spend_coverage, health_status')
        .eq('is_active', true);

      const totalCoverage = coverage?.reduce((sum, s) => sum + (s.estimated_spend_coverage || 0), 0) || 0;

      return NextResponse.json({
        success: true,
        summary: {
          totalForecasts: totalCount || 0,
          activeSources: coverage?.length || 0,
          estimatedSpendCoverage: `${totalCoverage.toFixed(1)}%`,
        },
        byAgency: byAgency || [],
        topNaics: topNaics || [],
        coverage: coverage || [],
        usage: {
          endpoints: [
            'GET /api/forecasts?naics=541512',
            'GET /api/forecasts?agency=DOE',
            'GET /api/forecasts?state=FL',
            'GET /api/forecasts?setAside=8(a)',
            'GET /api/forecasts?search=cybersecurity',
            'GET /api/forecasts?mode=coverage',
          ],
          filters: {
            naics: '4-6 digit NAICS code (prefix matching for 4 digits)',
            agency: 'Source agency code (DOE, NASA, DOJ, etc.)',
            state: 'Place of performance state code',
            setAside: 'Set-aside type (8(a), SDVOSB, WOSB, HUBZone, etc.)',
            fiscalYear: 'Fiscal year (FY2026 or 2026)',
            search: 'Full text search in title/description',
          },
          adminOnly: [
            'GET /api/forecasts?mode=coverage&password=xxx',
            'GET /api/forecasts?mode=sources&password=xxx',
            'GET /api/forecasts?naics=541512&password=xxx',
          ],
        },
        timing: `${Date.now() - startTime}ms`,
      });
    }

    // Execute query with pagination
    query = query
      .order('anticipated_award_date', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);

    const { data: forecasts, count, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    // Build response
    const response = {
      success: true,
      query: {
        naics,
        agency,
        state,
        setAside,
        fiscalYear,
        search,
      },
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
      forecasts: forecasts?.map(f => ({
        id: f.id,
        title: f.title,
        description: f.description?.substring(0, 200),
        agency: f.source_agency,
        department: f.department,
        office: f.contracting_office || f.program_office,
        naics: f.naics_code,
        naicsDescription: f.naics_description,
        psc: f.psc_code,
        fiscalYear: f.fiscal_year,
        quarter: f.anticipated_quarter,
        awardDate: f.anticipated_award_date,
        valueMin: f.estimated_value_min,
        valueMax: f.estimated_value_max,
        valueRange: f.estimated_value_range,
        setAside: f.set_aside_type,
        contractType: f.contract_type,
        incumbent: f.incumbent_name,
        state: f.pop_state,
        status: f.status,
        contact: isAdmin && f.poc_email ? { name: f.poc_name, email: f.poc_email } : null,
        lastSynced: f.last_synced_at,
      })) || [],
      timing: `${Date.now() - startTime}ms`,
    };

    // Add aggregations for filtered results
    if (forecasts && forecasts.length > 0) {
      const setAsideCounts: Record<string, number> = {};
      const agencyCounts: Record<string, number> = {};
      let totalValueMin = 0;
      let totalValueMax = 0;

      forecasts.forEach(f => {
        if (f.set_aside_type) {
          setAsideCounts[f.set_aside_type] = (setAsideCounts[f.set_aside_type] || 0) + 1;
        }
        agencyCounts[f.source_agency] = (agencyCounts[f.source_agency] || 0) + 1;
        if (f.estimated_value_min) totalValueMin += f.estimated_value_min;
        if (f.estimated_value_max) totalValueMax += f.estimated_value_max;
      });

      Object.assign(response, {
        aggregations: {
          bySetAside: Object.entries(setAsideCounts)
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count),
          byAgency: Object.entries(agencyCounts)
            .map(([agency, count]) => ({ agency, count }))
            .sort((a, b) => b.count - a.count),
          estimatedValueRange: {
            min: totalValueMin,
            max: totalValueMax,
            formatted: `$${(totalValueMin / 1e6).toFixed(1)}M - $${(totalValueMax / 1e6).toFixed(1)}M`,
          },
        },
      });
    }

    return NextResponse.json(response);

  } catch (error) {
    console.error('Forecast API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timing: `${Date.now() - startTime}ms`,
      },
      { status: 500 }
    );
  }
}

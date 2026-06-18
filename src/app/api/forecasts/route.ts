import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { formatDodaacOffice } from '@/lib/gov-contacts/dodaac';
import { loadDodaacNames } from '@/lib/gov-contacts/dodaac-directory';

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
      const naicsTerms = naics.split(/[, ]+/).map(term => term.trim()).filter(Boolean);
      // Support both exact and prefix matching
      if (naicsTerms.length > 1) {
        query = query.or(naicsTerms.map(term => (
          term.length <= 4 ? `naics_code.ilike.${term}%` : `naics_code.eq.${term}`
        )).join(','));
      } else if (naicsTerms[0]) {
        const term = naicsTerms[0];
        if (term.length <= 4) {
          query = query.ilike('naics_code', `${term}%`);
        } else {
          query = query.eq('naics_code', term);
        }
      }
    }

    if (agency) {
      const agencyTerms = agency.split(',').map(term => term.trim()).filter(Boolean);
      if (agencyTerms.length > 1) {
        query = query.or(agencyTerms.map(term => `source_agency.ilike.%${term}%`).join(','));
      } else if (agencyTerms[0]) {
        query = query.ilike('source_agency', `%${agencyTerms[0]}%`);
      }
    }

    if (state) {
      // pop_state holds FULL names ("FLORIDA"), but the UI may send a 2-letter code.
      // Map 2-letter → full name so the ilike matches; pass through full names as-is.
      const STATE_NAMES: Record<string, string> = {
        AL: 'ALABAMA', AK: 'ALASKA', AZ: 'ARIZONA', AR: 'ARKANSAS', CA: 'CALIFORNIA',
        CO: 'COLORADO', CT: 'CONNECTICUT', DE: 'DELAWARE', FL: 'FLORIDA', GA: 'GEORGIA',
        HI: 'HAWAII', ID: 'IDAHO', IL: 'ILLINOIS', IN: 'INDIANA', IA: 'IOWA', KS: 'KANSAS',
        KY: 'KENTUCKY', LA: 'LOUISIANA', ME: 'MAINE', MD: 'MARYLAND', MA: 'MASSACHUSETTS',
        MI: 'MICHIGAN', MN: 'MINNESOTA', MS: 'MISSISSIPPI', MO: 'MISSOURI', MT: 'MONTANA',
        NE: 'NEBRASKA', NV: 'NEVADA', NH: 'NEW HAMPSHIRE', NJ: 'NEW JERSEY', NM: 'NEW MEXICO',
        NY: 'NEW YORK', NC: 'NORTH CAROLINA', ND: 'NORTH DAKOTA', OH: 'OHIO', OK: 'OKLAHOMA',
        OR: 'OREGON', PA: 'PENNSYLVANIA', RI: 'RHODE ISLAND', SC: 'SOUTH CAROLINA',
        SD: 'SOUTH DAKOTA', TN: 'TENNESSEE', TX: 'TEXAS', UT: 'UTAH', VT: 'VERMONT',
        VA: 'VIRGINIA', WA: 'WASHINGTON', WV: 'WEST VIRGINIA', WI: 'WISCONSIN', WY: 'WYOMING',
        DC: 'DISTRICT OF COLUMBIA',
      };
      const s = state.trim().toUpperCase();
      const term = s.length === 2 && STATE_NAMES[s] ? STATE_NAMES[s] : s;
      query = query.ilike('pop_state', `%${term}%`);
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

      // Get counts by agency - paginate through all records to get accurate counts
      const agencyCounts: Record<string, number> = {};
      let agencyOffset = 0;
      const agencyPageSize = 1000;
      while (true) {
        const { data: agencyPage } = await supabase
          .from('agency_forecasts')
          .select('source_agency')
          .range(agencyOffset, agencyOffset + agencyPageSize - 1);

        if (!agencyPage || agencyPage.length === 0) break;

        agencyPage.forEach(row => {
          agencyCounts[row.source_agency] = (agencyCounts[row.source_agency] || 0) + 1;
        });

        if (agencyPage.length < agencyPageSize) break;
        agencyOffset += agencyPageSize;
      }

      const byAgency = Object.entries(agencyCounts)
        .map(([agency, count]) => ({ agency, count }))
        .sort((a, b) => b.count - a.count);

      // Get top NAICS codes
      const { data: topNaics } = await supabase
        .from('forecasts_by_naics')
        .select('*')
        .limit(10);

      // Get coverage from forecast_sources (the actual table)
      const { data: coverage } = await supabase
        .from('forecast_sources')
        .select('agency_code, total_records, estimated_spend_coverage, is_active')
        .eq('is_active', true);

      // If no active sources in forecast_sources, count directly from byAgency
      const activeSources = coverage?.length || byAgency.length;
      const totalCoverage = coverage?.reduce((sum, s) => sum + (s.estimated_spend_coverage || 0), 0) || 0;

      // DoD has 0 formal forecasts, so the default "All agencies" view showed
      // nothing for the biggest buyer (Eric QA 2026-06-05). Surface recent DoD
      // early signals (SAM Sources Sought / RFIs) here too, so they appear on
      // the landing view — labeled as early signals, with decoded offices.
      const dodaacNames = await loadDodaacNames();
      const since = new Date(Date.now() - 180 * 86400000).toISOString();
      const { data: sigData } = await supabase
        .from('sam_opportunities')
        .select('solicitation_number, title, description, naics_code, department, office, posted_date, response_deadline, set_aside_description, notice_type')
        .ilike('department', '%defense%')
        .in('notice_type', ['Sources Sought', 'Special Notice', 'Presolicitation'])
        .gte('posted_date', since)
        .order('posted_date', { ascending: false })
        .limit(40);
      const defaultDodSignals = (sigData || []).map((s) => ({
        id: `sam:${s.solicitation_number}`,
        title: s.title,
        description: String(s.description || '').substring(0, 200),
        agency: 'Department of Defense',
        department: s.department,
        office: formatDodaacOffice(String(s.solicitation_number || ''), dodaacNames) || s.office || null,
        naics: s.naics_code,
        setAside: s.set_aside_description,
        status: 'early_signal',
        lastSynced: s.posted_date,
        signalType: 'dod_early_signal' as const,
        noticeType: s.notice_type,
        solicitationNumber: s.solicitation_number,
        responseDeadline: s.response_deadline,
      }));

      return NextResponse.json({
        success: true,
        summary: {
          totalForecasts: totalCount || 0,
          activeSources,
          estimatedSpendCoverage: `${totalCoverage.toFixed(1)}%`,
        },
        byAgency,
        forecasts: defaultDodSignals,
        dodEarlySignalCount: defaultDodSignals.length,
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

    // DoD EARLY SIGNALS (Option B, docs/PRD-dod-forecast-coverage.md): the
    // agency_forecasts table has ZERO DoD rows, but DoD posts Sources Sought /
    // RFIs / Special Notices on SAM 6-12 months pre-RFP — real forward signal
    // we already ingest in sam_opportunities. Surface those in the forecast
    // feed when DoD is in scope, clearly labeled as "early signal" (not a
    // formal LRAF). Honest interim until component scrapers land (Option A).
    // DoD early signals come from sam_opportunities, which lacks clean pop_state /
    // set_aside_type fields — so we CANNOT honor a state or set-aside filter on them.
    // When the user has set either filter, skip the injection entirely rather than
    // pollute the results with unfiltered DoD signals (the bug the harness caught:
    // state=ZZ returned 60 unfiltered DoD signals, making a no-match look like 60 hits).
    const dodInScope = !state && !setAside && (
      !agency
      || agency.toLowerCase().includes('def')
      || agency.toLowerCase().includes('dod')
      || agency.toLowerCase().includes('army')
      || agency.toLowerCase().includes('navy')
      || agency.toLowerCase().includes('air force')
    );
    // Lookback window for DoD early signals (how far back the Sources Sought
    // can have been POSTED). Default 180d; ?lookbackDays= overrides. We also
    // include items with no/expired deadline when within the window so a useful
    // early signal isn't dropped just because its short response window closed.
    const lookbackDays = Math.min(Math.max(parseInt(searchParams.get('lookbackDays') || '180', 10) || 180, 30), 730);
    let dodSignals: Array<Record<string, unknown>> = [];
    // Office names for DoDAAC codes (directory table) — so forecast offices read
    // "10th Contracting Squadron", not "FA7000".
    const dodaacNames = dodInScope ? await loadDodaacNames() : new Map<string, string>();
    if (dodInScope) {
      const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
      let sig = supabase
        .from('sam_opportunities')
        .select('solicitation_number, title, description, naics_code, department, office, posted_date, response_deadline, set_aside_description, notice_type')
        .ilike('department', '%defense%')
        .in('notice_type', ['Sources Sought', 'Special Notice', 'Presolicitation'])
        .gte('posted_date', since)
        .order('posted_date', { ascending: false })
        .limit(60);
      if (naics) {
        const term = naics.split(/[, ]+/)[0].trim();
        sig = term.length <= 4 ? sig.ilike('naics_code', `${term}%`) : sig.eq('naics_code', term);
      }
      if (search) sig = sig.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
      const { data: sigData } = await sig;
      dodSignals = sigData || [];

      // RELEASE DETECTION (Eric: "how do we know if they let out the
      // solicitation?"): a Sources Sought whose RFP already dropped shows up
      // again under the SAME solicitation_number as a Solicitation / Combined /
      // Award. Flag those so the user knows the stage — still pre-RFP (shape it)
      // vs already released (go bid). One batched lookup, not N+1.
      const solNums = dodSignals.map(s => s.solicitation_number).filter(Boolean) as string[];
      if (solNums.length > 0) {
        const { data: followOns } = await supabase
          .from('sam_opportunities')
          .select('solicitation_number, notice_type')
          .in('solicitation_number', solNums)
          .in('notice_type', ['Solicitation', 'Combined Synopsis/Solicitation', 'Award Notice']);
        const released = new Map<string, string>();
        for (const f of (followOns || []) as { solicitation_number: string; notice_type: string }[]) {
          released.set(f.solicitation_number, f.notice_type);
        }
        dodSignals = dodSignals.map(s => ({
          ...s,
          rfpReleased: released.has(s.solicitation_number as string),
          rfpStage: released.get(s.solicitation_number as string) || null,
        }));
      }
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
      forecasts: [
        ...(forecasts?.map(f => ({
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
          signalType: 'forecast' as const,
        })) || []),
        // DoD early signals from SAM, mapped into the same shape + flagged.
        ...dodSignals.map(s => ({
          id: `sam:${s.solicitation_number}`,
          title: s.title,
          description: String(s.description || '').substring(0, 200),
          agency: 'Department of Defense',
          department: s.department,
          // Use the DoDAAC-decoded office when the solicitation # allows it.
          office: formatDodaacOffice(String(s.solicitation_number || ''), dodaacNames) || s.office || null,
          naics: s.naics_code,
          naicsDescription: null,
          psc: null,
          fiscalYear: null,
          quarter: null,
          awardDate: null,
          valueMin: null,
          valueMax: null,
          valueRange: null,
          setAside: s.set_aside_description,
          contractType: null,
          incumbent: null,
          state: null,
          status: 'early_signal',
          contact: null,
          lastSynced: s.posted_date,
          // Label so the UI can distinguish a real LRAF forecast from an early
          // SAM signal (Sources Sought / Special Notice).
          signalType: 'dod_early_signal' as const,
          noticeType: s.notice_type,
          solicitationNumber: s.solicitation_number,
          responseDeadline: s.response_deadline,
          rfpReleased: !!s.rfpReleased,
          rfpStage: s.rfpStage || null,
        })),
      ],
      dodEarlySignalCount: dodSignals.length,
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

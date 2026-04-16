import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { ForecastRecord, ScraperResult } from '@/lib/forecasts/types';
import {
  FORECAST_SOURCE_POLICY,
  getSchedulerEnabledForecastSources,
} from '@/lib/forecasts/source-policy';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function mapForecastRecordToDbRecord(record: ForecastRecord) {
  return {
    source_agency: record.source_agency,
    source_type: record.source_type,
    source_url: record.source_url,
    external_id: record.external_id,
    title: record.title,
    description: record.description,
    department: record.department,
    bureau: record.bureau,
    contracting_office: record.contracting_office,
    program_office: record.program_office,
    naics_code: record.naics_code,
    naics_description: record.naics_description,
    psc_code: record.psc_code,
    psc_description: record.psc_description,
    fiscal_year: record.fiscal_year,
    anticipated_quarter: record.anticipated_quarter,
    anticipated_award_date: record.anticipated_award_date,
    solicitation_date: record.solicitation_date,
    performance_end_date: record.performance_end_date,
    estimated_value_min: record.estimated_value_min,
    estimated_value_max: record.estimated_value_max,
    estimated_value_range: record.estimated_value_range,
    contract_type: record.contract_type,
    set_aside_type: record.set_aside_type,
    competition_type: record.competition_type,
    incumbent_name: record.incumbent_name,
    incumbent_contract_number: record.incumbent_contract_number,
    poc_name: record.poc_name,
    poc_email: record.poc_email,
    poc_phone: record.poc_phone,
    pop_state: record.pop_state,
    pop_city: record.pop_city,
    pop_zip: record.pop_zip,
    pop_country: record.pop_country || 'USA',
    status: record.status || 'forecast',
    raw_data: record.raw_data ? JSON.parse(record.raw_data) : null,
    last_synced_at: new Date().toISOString(),
  };
}

async function persistScraperResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  agencyCode: string,
  result: ScraperResult
) {
  if (result.records.length === 0) {
    await supabase.from('forecast_sync_runs').insert({
      source_agency: agencyCode,
      source_type: 'puppeteer',
      run_type: 'full',
      status: result.success ? 'completed' : 'failed',
      records_fetched: 0,
      records_added: 0,
      completed_at: new Date().toISOString(),
      error_message: result.errors[0] || null,
      metadata: {
        timing: result.timing,
        errors: result.errors,
      },
    });
    return { persisted: 0, error: null as string | null };
  }

  const dbRecords = result.records.map(mapForecastRecordToDbRecord);
  const { error } = await supabase
    .from('agency_forecasts')
    .upsert(dbRecords, {
      onConflict: 'source_agency,external_id',
      ignoreDuplicates: false,
    });

  await supabase.from('forecast_sync_runs').insert({
    source_agency: agencyCode,
    source_type: 'puppeteer',
    run_type: 'full',
    status: error ? 'failed' : 'completed',
    records_fetched: result.records.length,
    records_added: error ? 0 : result.records.length,
    completed_at: new Date().toISOString(),
    error_message: error?.message || null,
    metadata: {
      timing: result.timing,
      errors: result.errors,
    },
  });

  if (!error) {
    await supabase.rpc('update_forecast_source_stats', { p_agency_code: agencyCode });
  }

  return {
    persisted: error ? 0 : result.records.length,
    error: error?.message || null,
  };
}

/**
 * Admin endpoint to run forecast scrapers (Phase 3)
 *
 * GET /api/admin/run-forecast-scraper?password=xxx - Show available scrapers
 * POST /api/admin/run-forecast-scraper?password=xxx&agency=DHS - Run specific scraper
 * POST /api/admin/run-forecast-scraper?password=xxx&agency=all - Run all scrapers
 *
 * Agency options: DHS, HHS, Treasury, VA, all
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    message: 'Forecast Scraper Admin API',
    sourcePolicy: Object.values(FORECAST_SOURCE_POLICY),
    availableScrapers: Object.values(FORECAST_SOURCE_POLICY).map(source => ({
      agency: source.code,
      name: source.name,
      stage: source.stage,
      schedulerEnabled: source.schedulerEnabled,
      manualOnly: source.manualOnly,
      rationale: source.rationale,
    })),
    usage: {
      runOne: 'POST ?password=xxx&agency=DHS',
      runAll: 'POST ?password=xxx&agency=all',
      runScheduledSet: 'POST ?password=xxx&agency=scheduled',
      dryRun: 'POST ?password=xxx&agency=DHS&dryRun=true (scrape but do not save)',
    },
    note: 'Puppeteer scrapers require the server to have puppeteer installed. Consider running locally or via a dedicated scraping service.',
  });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const agency = searchParams.get('agency');
  const dryRun = searchParams.get('dryRun') === 'true';
  const force = searchParams.get('force') === 'true';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!agency) {
    return NextResponse.json({
      error: 'Missing agency parameter',
      validOptions: ['DHS', 'GSA', 'HHS', 'Treasury', 'EPA', 'USDA', 'VA', 'DOD', 'all', 'scheduled'],
    }, { status: 400 });
  }

  const startTime = Date.now();

  try {
    // Dynamic import to avoid loading puppeteer at build time
    const scraperModule = await import('@/lib/forecasts/scrapers');
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

    const results: Record<string, {
      success: boolean;
      records: number;
      persisted: number;
      errors: string[];
      timing: number;
    }> = {};

    if (agency.toLowerCase() === 'all' || agency.toLowerCase() === 'scheduled') {
      // Run all scrapers
      const allowedSources = agency.toLowerCase() === 'scheduled'
        ? getSchedulerEnabledForecastSources().map(source => source.code)
        : Object.keys(scraperModule.SCRAPERS);
      const allResults = await scraperModule.runAllScrapers();

      for (const [key, result] of Object.entries(allResults.results)) {
        if (!allowedSources.includes(key)) continue;
        let persisted = 0;
        let persistenceError: string | null = null;
        if (!dryRun) {
          const persistence = await persistScraperResult(getSupabase(), key, result);
          persisted = persistence.persisted;
          persistenceError = persistence.error;
        }

        const combinedErrors = persistenceError ? [...result.errors, `Database save error: ${persistenceError}`] : result.errors;
        results[key] = {
          success: result.success,
          records: result.records.length,
          persisted,
          errors: combinedErrors,
          timing: result.timing,
        };
      }
    } else {
      // Run specific scraper
      const agencyUpper = agency.toUpperCase() as keyof typeof scraperModule.SCRAPERS;
      const policy = FORECAST_SOURCE_POLICY[agencyUpper as string];

      if (!scraperModule.SCRAPERS[agencyUpper]) {
        return NextResponse.json({
          error: `Unknown agency: ${agency}`,
          validOptions: Object.keys(scraperModule.SCRAPERS),
        }, { status: 400 });
      }

      if (policy?.stage === 'disabled' && !force) {
        return NextResponse.json({
          success: false,
          error: `${agencyUpper} is disabled by source policy`,
          policy,
          guidance: 'Use force=true only if you intentionally want to override source policy.',
        }, { status: 409 });
      }

      const result = await scraperModule.runScraper(agencyUpper);
      let persisted = 0;
      let persistenceError: string | null = null;
      if (!dryRun) {
        const persistence = await persistScraperResult(getSupabase(), agencyUpper, result);
        persisted = persistence.persisted;
        persistenceError = persistence.error;
      }

      results[agencyUpper] = {
        success: result.success,
        records: result.records.length,
        persisted,
        errors: persistenceError ? [...result.errors, `Database save error: ${persistenceError}`] : result.errors,
        timing: result.timing,
      };
    }

    const totalTiming = Date.now() - startTime;
    const totalRecords = Object.values(results).reduce((sum, r) => sum + r.records, 0);
    const totalPersisted = Object.values(results).reduce((sum, r) => sum + r.persisted, 0);

    return NextResponse.json({
      success: true,
      dryRun,
      totalRecords,
      totalPersisted,
      totalTiming: `${totalTiming}ms`,
      results,
      message: dryRun
        ? 'Dry run complete - no data saved'
        : totalPersisted > 0
        ? `Scraped and saved ${totalPersisted} records`
        : 'Scrape complete but no records found',
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: String(error),
      timing: `${Date.now() - startTime}ms`,
      hint: 'Puppeteer may not be installed or may require different launch args for this environment',
    }, { status: 500 });
  }
}

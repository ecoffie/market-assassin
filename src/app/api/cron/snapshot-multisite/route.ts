/**
 * Multisite Aggregation Cron Job
 *
 * Fetches opportunities from multiple sources and stores them in
 * the aggregated_opportunities table.
 *
 * Query Parameters:
 * - source: Which source to scrape (required unless mode=all)
 * - mode: 'single' (default) or 'all' (scrape all enabled sources)
 * - password: Admin password for manual triggering
 *
 * Sources:
 * - Tier 1: dla_dibbs, navy_neco, unison, acq_gateway
 * - Tier 2: nih_reporter, darpa_baa, nsf_sbir
 * - Tier 3: DOE Labs (ornl, lanl, snl, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import crypto from 'crypto';

// Import scrapers
import {
  searchNIHProjects,
  checkNIHHealth,
  NIH_SOURCE_ID,
  searchSBIRSolicitations,
  searchSBIRAwards,
  checkSBIRHealth,
  SBIR_SOURCE_ID,
} from '@/lib/scrapers';

import {
  fetchDARPAOpportunities,
  checkDARPAGrantsHealth,
} from '@/lib/scrapers/apis/grantsgov-darpa';

import type {
  ScrapedOpportunity,
  ScrapeResult,
  ScrapeLogEntry,
  SourceId,
} from '@/lib/scrapers/types';

// ============================================================================
// CONFIGURATION
// ============================================================================

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// Supabase client
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================================================
// CRON HANDLER
// ============================================================================

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Verify cron secret OR admin password
  const headersList = await headers();
  const cronSecret = headersList.get('x-vercel-cron-secret');
  const isVercelCron = cronSecret === process.env.CRON_SECRET;

  const password = request.nextUrl.searchParams.get('password');
  const isAdmin = password === ADMIN_PASSWORD;

  if (!isVercelCron && !isAdmin) {
    return NextResponse.json(
      { error: 'Unauthorized. Use Vercel cron or provide password.' },
      { status: 401 }
    );
  }

  // Parse parameters
  const sourceParam = request.nextUrl.searchParams.get('source') as SourceId | null;
  const mode = request.nextUrl.searchParams.get('mode') || 'single';
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100');
  const dryRun = request.nextUrl.searchParams.get('dry_run') === 'true';

  // Determine which sources to scrape
  let sourcesToScrape: SourceId[] = [];

  if (mode === 'all') {
    // Get all enabled sources from database
    const supabase = getSupabase();
    const { data: sources } = await supabase
      .from('multisite_sources')
      .select('id')
      .eq('is_enabled', true);

    sourcesToScrape = sources?.map(s => s.id as SourceId) || [];
  } else if (sourceParam) {
    sourcesToScrape = [sourceParam];
  } else {
    return NextResponse.json(
      { error: 'Missing required parameter: source (or use mode=all)' },
      { status: 400 }
    );
  }

  // Results collector
  const results: Record<string, ScrapeResult | { error: string }> = {};
  let totalNew = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;

  // Process each source
  for (const sourceId of sourcesToScrape) {
    const sourceStartTime = Date.now();

    try {
      // Create log entry
      const logEntry: ScrapeLogEntry = {
        sourceId,
        startedAt: new Date().toISOString(),
        status: 'running',
        opportunitiesFound: 0,
        opportunitiesNew: 0,
        opportunitiesUpdated: 0,
        opportunitiesUnchanged: 0,
        triggeredBy: isVercelCron ? 'cron' : 'manual',
        params: { limit }
      };

      // Log start
      const logId = await logScrapeStart(logEntry);

      // Execute scraper based on source
      let result: ScrapeResult;

      switch (sourceId) {
        case 'nih_reporter':
          result = await searchNIHProjects({ limit });
          break;

        case 'nsf_sbir':
          // SBIR.gov covers all agencies including NSF
          result = await searchSBIRSolicitations({ limit });
          break;

        case 'darpa_baa':
          result = await fetchDARPAOpportunities({ limit });
          break;

        default:
          result = {
            success: false,
            source: sourceId,
            opportunities: [],
            totalFound: 0,
            newCount: 0,
            updatedCount: 0,
            unchangedCount: 0,
            errors: [{ code: 'NOT_IMPLEMENTED', message: `Scraper for ${sourceId} not yet implemented`, retryable: false }],
            durationMs: Date.now() - sourceStartTime,
            scrapedAt: new Date().toISOString()
          };
      }

      // Store opportunities (unless dry run)
      if (!dryRun && result.success && result.opportunities.length > 0) {
        const upsertResult = await upsertOpportunities(result.opportunities);
        result.newCount = upsertResult.newCount;
        result.updatedCount = upsertResult.updatedCount;
        result.unchangedCount = upsertResult.unchangedCount;
      }

      // Update totals
      totalNew += result.newCount;
      totalUpdated += result.updatedCount;
      totalUnchanged += result.unchangedCount;

      // Log completion
      await logScrapeComplete(logId, {
        status: result.success ? 'success' : 'failed',
        opportunitiesFound: result.totalFound,
        opportunitiesNew: result.newCount,
        opportunitiesUpdated: result.updatedCount,
        opportunitiesUnchanged: result.unchangedCount,
        errorMessage: result.errors?.[0]?.message,
        durationMs: Date.now() - sourceStartTime
      });

      // Update source health
      await updateSourceHealth(sourceId, result.success, result.totalFound, Date.now() - sourceStartTime);

      results[sourceId] = result;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Multisite Cron] Error scraping ${sourceId}:`, message);

      results[sourceId] = {
        error: message
      };

      // Update source health for failure
      await updateSourceHealth(sourceId, false, 0, Date.now() - sourceStartTime, message);
    }
  }

  // Return response
  const totalDurationMs = Date.now() - startTime;

  return NextResponse.json({
    success: true,
    mode,
    dryRun,
    sources: sourcesToScrape,
    results,
    summary: {
      totalSources: sourcesToScrape.length,
      totalNew,
      totalUpdated,
      totalUnchanged,
      durationMs: totalDurationMs
    },
    timestamp: new Date().toISOString()
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Upsert opportunities to database
 */
async function upsertOpportunities(
  opportunities: ScrapedOpportunity[]
): Promise<{ newCount: number; updatedCount: number; unchangedCount: number }> {
  const supabase = getSupabase();

  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const opp of opportunities) {
    // Generate content hash for change detection
    const contentHash = generateContentHash(opp);

    // Check if opportunity already exists
    const { data: existing } = await supabase
      .from('aggregated_opportunities')
      .select('id, content_hash')
      .eq('source', opp.source)
      .eq('external_id', opp.externalId)
      .single();

    if (!existing) {
      // New opportunity - insert
      const { error } = await supabase
        .from('aggregated_opportunities')
        .insert({
          source: opp.source,
          external_id: opp.externalId,
          source_url: opp.sourceUrl,
          title: opp.title,
          description: opp.description,
          agency: opp.agency,
          sub_agency: opp.subAgency,
          naics_code: opp.naicsCode,
          psc_code: opp.pscCode,
          set_aside: opp.setAside,
          opportunity_type: opp.opportunityType,
          posted_date: opp.postedDate,
          close_date: opp.closeDate,
          response_date: opp.responseDate,
          estimated_value: opp.estimatedValue,
          place_of_performance_state: opp.placeOfPerformance?.state,
          place_of_performance_city: opp.placeOfPerformance?.city,
          place_of_performance_zip: opp.placeOfPerformance?.zip,
          contact_name: opp.contact?.name,
          contact_email: opp.contact?.email,
          contact_phone: opp.contact?.phone,
          contracting_office: opp.contractingOffice,
          document_urls: opp.documentUrls || [],
          status: opp.status,
          raw_data: opp.rawData,
          content_hash: contentHash,
          scraped_at: opp.scrapedAt
        });

      if (!error) {
        newCount++;
      } else {
        console.error(`[Multisite] Insert error for ${opp.externalId}:`, error.message);
      }
    } else if (existing.content_hash !== contentHash) {
      // Existing opportunity changed - update
      const { error } = await supabase
        .from('aggregated_opportunities')
        .update({
          title: opp.title,
          description: opp.description,
          agency: opp.agency,
          sub_agency: opp.subAgency,
          naics_code: opp.naicsCode,
          psc_code: opp.pscCode,
          set_aside: opp.setAside,
          opportunity_type: opp.opportunityType,
          posted_date: opp.postedDate,
          close_date: opp.closeDate,
          response_date: opp.responseDate,
          estimated_value: opp.estimatedValue,
          place_of_performance_state: opp.placeOfPerformance?.state,
          place_of_performance_city: opp.placeOfPerformance?.city,
          place_of_performance_zip: opp.placeOfPerformance?.zip,
          contact_name: opp.contact?.name,
          contact_email: opp.contact?.email,
          contact_phone: opp.contact?.phone,
          contracting_office: opp.contractingOffice,
          document_urls: opp.documentUrls || [],
          status: opp.status,
          raw_data: opp.rawData,
          content_hash: contentHash,
          scraped_at: opp.scrapedAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (!error) {
        updatedCount++;
      }
    } else {
      // No change
      unchangedCount++;
    }
  }

  return { newCount, updatedCount, unchangedCount };
}

/**
 * Generate content hash for change detection
 */
function generateContentHash(opp: ScrapedOpportunity): string {
  const content = JSON.stringify({
    title: opp.title,
    description: opp.description,
    agency: opp.agency,
    naicsCode: opp.naicsCode,
    setAside: opp.setAside,
    closeDate: opp.closeDate,
    estimatedValue: opp.estimatedValue,
    status: opp.status
  });

  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 64);
}

/**
 * Log scrape start
 */
async function logScrapeStart(entry: ScrapeLogEntry): Promise<string | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('scrape_log')
    .insert({
      source_id: entry.sourceId,
      started_at: entry.startedAt,
      status: 'running',
      triggered_by: entry.triggeredBy,
      params: entry.params
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Multisite] Failed to log scrape start:', error.message);
    return null;
  }

  return data?.id || null;
}

/**
 * Log scrape completion
 */
async function logScrapeComplete(
  logId: string | null,
  updates: Partial<ScrapeLogEntry> & { durationMs?: number }
): Promise<void> {
  if (!logId) return;

  const supabase = getSupabase();

  await supabase
    .from('scrape_log')
    .update({
      completed_at: new Date().toISOString(),
      duration_ms: updates.durationMs,
      status: updates.status,
      opportunities_found: updates.opportunitiesFound,
      opportunities_new: updates.opportunitiesNew,
      opportunities_updated: updates.opportunitiesUpdated,
      opportunities_unchanged: updates.opportunitiesUnchanged,
      error_message: updates.errorMessage
    })
    .eq('id', logId);
}

/**
 * Update source health metrics
 */
async function updateSourceHealth(
  sourceId: SourceId,
  success: boolean,
  count: number,
  responseTimeMs: number,
  errorMessage?: string
): Promise<void> {
  const supabase = getSupabase();

  if (success) {
    await supabase
      .from('multisite_sources')
      .update({
        last_scrape_at: new Date().toISOString(),
        last_scrape_status: 'success',
        last_scrape_count: count,
        last_scrape_duration_ms: responseTimeMs,
        consecutive_failures: 0,
        avg_response_time_ms: responseTimeMs, // TODO: Calculate rolling average
        total_scrapes: supabase.rpc('increment', { row_id: sourceId }),
        total_opportunities_found: supabase.rpc('add_count', { row_id: sourceId, add_value: count }),
        last_error: null,
        last_error_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', sourceId);
  } else {
    await supabase
      .from('multisite_sources')
      .update({
        last_scrape_at: new Date().toISOString(),
        last_scrape_status: 'failed',
        last_scrape_duration_ms: responseTimeMs,
        consecutive_failures: supabase.rpc('increment_failures', { source_id: sourceId }),
        last_error: errorMessage,
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', sourceId);
  }
}

// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================

export async function POST(request: NextRequest) {
  // Admin-only endpoint to check source health
  const { password, source } = await request.json();

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!source) {
    return NextResponse.json({ error: 'Missing source parameter' }, { status: 400 });
  }

  let healthResult;

  switch (source) {
    case 'nih_reporter':
      healthResult = await checkNIHHealth();
      break;
    case 'nsf_sbir':
      healthResult = await checkSBIRHealth();
      break;
    case 'darpa_baa':
      healthResult = await checkDARPAGrantsHealth();
      break;
    default:
      healthResult = { healthy: false, message: `Health check not implemented for ${source}` };
  }

  return NextResponse.json({
    source,
    ...healthResult,
    timestamp: new Date().toISOString()
  });
}

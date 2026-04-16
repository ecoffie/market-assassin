/**
 * Cron: Sync SAM.gov Opportunities to Local Cache
 *
 * GET /api/cron/sync-sam-opportunities
 *
 * Fetches all active opportunities from SAM.gov and stores in Supabase.
 * Runs daily at 2 AM ET via Vercel cron.
 *
 * Strategy:
 * - Fetch opportunities in batches of 1000 (SAM.gov max)
 * - Page through all results until exhausted
 * - Upsert to prevent duplicates
 * - Mark stale opportunities as inactive
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const SAM_API_KEY = (process.env.SAM_API_KEY || '').trim();
const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2';

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

// Helper: Format date for SAM.gov API (MM/dd/yyyy)
function formatDateForSam(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

// Helper: Parse SAM.gov date to ISO
function parseSamDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return null;
  }
}

interface SamOpportunity {
  noticeId: string;
  title: string;
  solicitationNumber?: string;
  naicsCode?: string;
  classificationCode?: string;
  description?: string;
  department?: { name?: string };
  fullParentPathName?: string;
  subtierAgency?: { name?: string };
  office?: { name?: string };
  postedDate?: string;
  responseDeadLine?: string;
  responseDeadline?: string;
  archiveDate?: string;
  typeOfSetAside?: string;
  typeOfSetAsideDescription?: string;
  type?: string;
  active?: boolean | string;
  placeOfPerformance?: {
    city?: { name?: string };
    state?: { code?: string };
    zip?: string;
    country?: { code?: string };
  };
  uiLink?: string;
  lastModifiedDate?: string;
}

async function fetchOpportunitiesPage(offset: number, limit: number): Promise<{ opportunities: SamOpportunity[], total: number }> {
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const params = new URLSearchParams({
    api_key: SAM_API_KEY,
    limit: String(limit),
    offset: String(offset),
    postedFrom: formatDateForSam(thirtyDaysAgo),
    postedTo: formatDateForSam(today),
  });

  const url = `${SAM_API_BASE}/search?${params.toString()}`;

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`SAM.gov API error: ${response.status} - ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  return {
    opportunities: data.opportunitiesData || [],
    total: data.totalRecords || 0,
  };
}

function mapToDbRecord(opp: SamOpportunity) {
  return {
    notice_id: opp.noticeId,
    solicitation_number: opp.solicitationNumber || null,
    title: opp.title || 'Untitled',
    description: opp.description?.substring(0, 10000) || null,
    naics_code: opp.naicsCode || null,
    psc_code: opp.classificationCode || null,
    department: opp.department?.name || opp.fullParentPathName?.split('.')[0] || null,
    sub_tier: opp.subtierAgency?.name || null,
    office: opp.office?.name || null,
    agency_hierarchy: opp.fullParentPathName || null,
    posted_date: parseSamDate(opp.postedDate),
    response_deadline: parseSamDate(opp.responseDeadLine || opp.responseDeadline),
    archive_date: parseSamDate(opp.archiveDate),
    last_modified: parseSamDate(opp.lastModifiedDate),
    set_aside_code: opp.typeOfSetAside || null,
    set_aside_description: opp.typeOfSetAsideDescription || null,
    notice_type: opp.type || null,
    active: opp.active === true || opp.active === 'Yes',
    pop_city: opp.placeOfPerformance?.city?.name || null,
    pop_state: opp.placeOfPerformance?.state?.code || null,
    pop_zip: opp.placeOfPerformance?.zip || null,
    pop_country: opp.placeOfPerformance?.country?.code || 'USA',
    ui_link: opp.uiLink || null,
    raw_data: opp,
    synced_at: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const limitParam = searchParams.get('limit');
  const dryRun = searchParams.get('dry_run') === 'true';

  // Auth: password or cron secret
  const isAuthorized = password === ADMIN_PASSWORD ||
    cronSecret === process.env.CRON_SECRET;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!SAM_API_KEY) {
    return NextResponse.json({ error: 'SAM_API_KEY not configured' }, { status: 500 });
  }

  const startTime = Date.now();
  const maxRecords = limitParam ? parseInt(limitParam) : 50000; // Default 50K max
  const batchSize = 1000; // SAM.gov max per request

  // Create sync run record
  let syncRunId: string | null = null;
  if (!dryRun) {
    const { data: syncRun } = await getSupabase()
      .from('sam_sync_runs')
      .insert({ status: 'running', started_at: new Date().toISOString() })
      .select('id')
      .single();
    syncRunId = syncRun?.id || null;
  }

  let totalFetched = 0;
  let newRecords = 0;
  let updatedRecords = 0;
  let apiCallsMade = 0;
  let offset = 0;
  let totalAvailable = 0;
  const errors: string[] = [];

  try {
    console.log(`[sync-sam] Starting sync, max records: ${maxRecords}, dry run: ${dryRun}`);

    // Fetch first page to get total
    const firstPage = await fetchOpportunitiesPage(0, batchSize);
    apiCallsMade++;
    totalAvailable = firstPage.total;
    console.log(`[sync-sam] Total opportunities available: ${totalAvailable}`);

    // Process first page
    const firstBatch = firstPage.opportunities.map(mapToDbRecord);
    totalFetched += firstBatch.length;

    if (!dryRun && firstBatch.length > 0) {
      const { error: upsertError } = await getSupabase()
        .from('sam_opportunities')
        .upsert(firstBatch, { onConflict: 'notice_id', ignoreDuplicates: false });

      if (upsertError) {
        errors.push(`Upsert error: ${upsertError.message}`);
        console.error('[sync-sam] Upsert error:', upsertError);
      } else {
        newRecords += firstBatch.length;
      }
    }

    offset = batchSize;

    // Continue fetching remaining pages
    while (offset < totalAvailable && totalFetched < maxRecords) {
      console.log(`[sync-sam] Fetching offset ${offset}...`);

      // Rate limit: wait 200ms between requests
      await new Promise(resolve => setTimeout(resolve, 200));

      try {
        const page = await fetchOpportunitiesPage(offset, batchSize);
        apiCallsMade++;

        if (page.opportunities.length === 0) {
          console.log('[sync-sam] No more opportunities, stopping');
          break;
        }

        const batch = page.opportunities.map(mapToDbRecord);
        totalFetched += batch.length;

        if (!dryRun && batch.length > 0) {
          const { error: upsertError } = await getSupabase()
            .from('sam_opportunities')
            .upsert(batch, { onConflict: 'notice_id', ignoreDuplicates: false });

          if (upsertError) {
            errors.push(`Batch ${offset}: ${upsertError.message}`);
          } else {
            updatedRecords += batch.length;
          }
        }

        offset += batchSize;
      } catch (pageError) {
        errors.push(`Offset ${offset}: ${pageError instanceof Error ? pageError.message : 'Unknown'}`);
        // Continue to next batch even if one fails
        offset += batchSize;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    // Update sync run record (before stale cleanup so we have the count)
    // Note: deleted_records will be updated after stale cleanup
    if (syncRunId && !dryRun) {
      await getSupabase()
        .from('sam_sync_runs')
        .update({
          completed_at: new Date().toISOString(),
          status: errors.length > 0 ? 'completed_with_errors' : 'completed',
          total_fetched: totalFetched,
          new_records: newRecords,
          updated_records: updatedRecords,
          duration_seconds: duration,
          api_calls_made: apiCallsMade,
          error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        })
        .eq('id', syncRunId);
    }

    console.log(`[sync-sam] Completed: ${totalFetched} fetched, ${newRecords + updatedRecords} upserted, ${apiCallsMade} API calls, ${duration}s`);

    // STALE RECORD CLEANUP: Mark old records as inactive if not synced in 7+ days
    let staleRecordsMarked = 0;
    if (!dryRun) {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: staleData, error: staleError } = await getSupabase()
        .from('sam_opportunities')
        .update({ active: false })
        .lt('synced_at', sevenDaysAgo.toISOString())
        .eq('active', true)
        .select('id');

      if (staleError) {
        errors.push(`Stale cleanup error: ${staleError.message}`);
        console.error('[sync-sam] Stale cleanup error:', staleError);
      } else {
        staleRecordsMarked = staleData?.length || 0;
        console.log(`[sync-sam] Marked ${staleRecordsMarked} stale records as inactive`);
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      stats: {
        totalAvailable,
        totalFetched,
        newRecords,
        updatedRecords,
        staleRecordsMarked,
        apiCallsMade,
        durationSeconds: duration,
        errorsCount: errors.length,
      },
      errors: errors.slice(0, 10),
      syncRunId,
    });

  } catch (err) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.error('[sync-sam] Fatal error:', err);

    // Update sync run as failed
    if (syncRunId && !dryRun) {
      await getSupabase()
        .from('sam_sync_runs')
        .update({
          completed_at: new Date().toISOString(),
          status: 'failed',
          total_fetched: totalFetched,
          duration_seconds: duration,
          api_calls_made: apiCallsMade,
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq('id', syncRunId);
    }

    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stats: {
        totalFetched,
        apiCallsMade,
        durationSeconds: duration,
      },
    }, { status: 500 });
  }
}

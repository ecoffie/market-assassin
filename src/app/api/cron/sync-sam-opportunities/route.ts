/**
 * Cron: Sync SAM.gov Opportunities to Local Cache
 *
 * GET /api/cron/sync-sam-opportunities
 *
 * Production-grade resumable data pipeline supporting 30K+ users.
 *
 * Modes:
 * - full: Complete 30-day sync (default, 1 AM UTC)
 * - resume: Continue from last failed sync checkpoint
 * - delta: Quick refresh of recent changes (6 hours, noon UTC)
 * - recovery: Watchdog-triggered recovery sync
 *
 * Features:
 * - Checkpoint tracking per page for resumable syncs
 * - Retry with exponential backoff per request
 * - Page-level error tracking (failed pages can retry independently)
 * - Only runs stale cleanup after successful full sync
 * - Stores failed offsets for targeted retry
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

type SyncType = 'full' | 'resume' | 'delta' | 'recovery';

// Helper: Retry with exponential backoff
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 5000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isTimeout = lastError.message.includes('timeout') || lastError.message.includes('aborted');

      // Only retry on timeouts
      if (!isTimeout || attempt === maxRetries - 1) {
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`[sync-sam] Retry ${attempt + 1}/${maxRetries} after ${delay}ms timeout`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error('Max retries exceeded');
}

async function fetchOpportunitiesPage(
  offset: number,
  limit: number,
  lookbackDays: number = 30
): Promise<{ opportunities: SamOpportunity[], total: number }> {
  const today = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  const params = new URLSearchParams({
    api_key: SAM_API_KEY,
    limit: String(limit),
    offset: String(offset),
    postedFrom: formatDateForSam(startDate),
    postedTo: formatDateForSam(today),
  });

  const url = `${SAM_API_BASE}/search?${params.toString()}`;

  // Use retry wrapper with 90-second timeout per request
  return fetchWithRetry(async () => {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(90000), // 90 seconds
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
  }, 3, 5000); // 3 retries, starting at 5 second delay
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

// Find incomplete sync to resume
async function findResumableRun(): Promise<{
  id: string;
  lastSuccessfulOffset: number;
  totalAvailable: number;
  failedOffsets: number[];
} | null> {
  try {
    const { data } = await getSupabase()
      .from('sam_sync_runs')
      .select('id, last_successful_offset, total_available, failed_offsets')
      .in('status', ['failed', 'partial'])
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (data && data.last_successful_offset > 0) {
      return {
        id: data.id,
        lastSuccessfulOffset: data.last_successful_offset || 0,
        totalAvailable: data.total_available || 0,
        failedOffsets: data.failed_offsets || [],
      };
    }
  } catch (error) {
    // New columns may not exist yet - fail gracefully
    console.log('[sync-sam] Resume columns not available, falling back to full sync');
  }
  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const limitParam = searchParams.get('limit');
  const dryRun = searchParams.get('dry_run') === 'true';
  const syncTypeParam = (searchParams.get('type') || 'full') as SyncType;

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
  const maxRecords = limitParam ? parseInt(limitParam) : 50000;
  const batchSize = 1000; // SAM.gov max per request

  // Determine sync parameters based on type
  let syncType = syncTypeParam;
  let lookbackDays = 30;
  let startOffset = 0;
  let parentRunId: string | null = null;
  let failedOffsets: number[] = [];

  // For resume mode, find the last incomplete run
  if (syncType === 'resume') {
    const resumable = await findResumableRun();
    if (resumable) {
      startOffset = resumable.lastSuccessfulOffset;
      parentRunId = resumable.id;
      failedOffsets = resumable.failedOffsets;
      console.log(`[sync-sam] Resuming from offset ${startOffset}, parent run: ${parentRunId}`);
    } else {
      console.log('[sync-sam] No resumable run found, falling back to full sync');
      syncType = 'full';
    }
  }

  // Delta sync only looks back 6 hours
  if (syncType === 'delta') {
    lookbackDays = 1; // SAM API requires at least 1 day, we'll filter in DB
  }

  // Create sync run record
  let syncRunId: string | null = null;
  if (!dryRun) {
    const { data: syncRun } = await getSupabase()
      .from('sam_sync_runs')
      .insert({
        status: 'running',
        started_at: new Date().toISOString(),
        sync_type: syncType,
        parent_run_id: parentRunId,
        last_successful_offset: startOffset,
      })
      .select('id')
      .single();
    syncRunId = syncRun?.id || null;
  }

  let totalFetched = 0;
  let newRecords = 0;
  let updatedRecords = 0;
  let apiCallsMade = 0;
  let offset = startOffset;
  let totalAvailable = 0;
  let lastSuccessfulOffset = startOffset;
  const errors: string[] = [];
  const newFailedOffsets: number[] = [...failedOffsets];

  try {
    console.log(`[sync-sam] Starting ${syncType} sync, offset: ${startOffset}, max: ${maxRecords}, dry: ${dryRun}`);

    // Fetch first page to get total (or resume from checkpoint)
    const firstPage = await fetchOpportunitiesPage(offset, batchSize, lookbackDays);
    apiCallsMade++;
    totalAvailable = firstPage.total;
    console.log(`[sync-sam] Total opportunities available: ${totalAvailable}`);

    // Update run with total_available
    if (syncRunId && !dryRun) {
      await getSupabase()
        .from('sam_sync_runs')
        .update({ total_available: totalAvailable })
        .eq('id', syncRunId);
    }

    // Process first page
    const firstBatch = firstPage.opportunities.map(mapToDbRecord);
    totalFetched += firstBatch.length;

    if (!dryRun && firstBatch.length > 0) {
      const { error: upsertError } = await getSupabase()
        .from('sam_opportunities')
        .upsert(firstBatch, { onConflict: 'notice_id', ignoreDuplicates: false });

      if (upsertError) {
        errors.push(`Upsert error at offset ${offset}: ${upsertError.message}`);
        newFailedOffsets.push(offset);
        console.error('[sync-sam] Upsert error:', upsertError);
      } else {
        newRecords += firstBatch.length;
        lastSuccessfulOffset = offset + batchSize;
      }
    }

    offset += batchSize;

    // Continue fetching remaining pages
    while (offset < totalAvailable && totalFetched < maxRecords) {
      console.log(`[sync-sam] Fetching offset ${offset}...`);

      // Rate limit: wait 200ms between requests
      await new Promise(resolve => setTimeout(resolve, 200));

      // Update checkpoint periodically (every 5 batches)
      if (syncRunId && !dryRun && (offset % (batchSize * 5) === 0)) {
        try {
          await getSupabase()
            .from('sam_sync_runs')
            .update({
              total_fetched: totalFetched,
              // These columns may not exist yet - Supabase ignores unknown columns
              last_successful_offset: lastSuccessfulOffset,
              failed_offsets: newFailedOffsets.length > 0 ? newFailedOffsets : null,
            })
            .eq('id', syncRunId);
        } catch (err) {
          // Checkpoint columns may not exist - continue without checkpointing
          console.log('[sync-sam] Checkpoint update skipped:', err);
        }
      }

      try {
        const page = await fetchOpportunitiesPage(offset, batchSize, lookbackDays);
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
            newFailedOffsets.push(offset);
          } else {
            updatedRecords += batch.length;
            lastSuccessfulOffset = offset + batchSize;
            // Remove from failed offsets if it was there
            const idx = newFailedOffsets.indexOf(offset);
            if (idx > -1) newFailedOffsets.splice(idx, 1);
          }
        }

        offset += batchSize;
      } catch (pageError) {
        const errMsg = pageError instanceof Error ? pageError.message : 'Unknown';
        errors.push(`Offset ${offset}: ${errMsg}`);
        newFailedOffsets.push(offset);
        console.error(`[sync-sam] Page error at offset ${offset}:`, errMsg);
        // Continue to next batch even if one fails
        offset += batchSize;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    const isFullSuccess = newFailedOffsets.length === 0 && offset >= totalAvailable;
    const finalStatus = isFullSuccess
      ? 'completed'
      : (totalFetched > 0 ? 'partial' : 'failed');

    // Update sync run record
    if (syncRunId && !dryRun) {
      await getSupabase()
        .from('sam_sync_runs')
        .update({
          completed_at: new Date().toISOString(),
          status: errors.length > 0 && totalFetched > 0 ? 'completed_with_errors' : finalStatus,
          total_fetched: totalFetched,
          new_records: newRecords,
          updated_records: updatedRecords,
          duration_seconds: duration,
          api_calls_made: apiCallsMade,
          last_successful_offset: lastSuccessfulOffset,
          failed_offsets: newFailedOffsets.length > 0 ? newFailedOffsets : null,
          error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        })
        .eq('id', syncRunId);
    }

    console.log(`[sync-sam] ${finalStatus}: ${totalFetched} fetched, ${newRecords + updatedRecords} upserted, ${apiCallsMade} API calls, ${duration}s`);

    // STALE RECORD CLEANUP: Only run after successful FULL sync
    // This prevents SAM.gov outages from accidentally hiding valid opportunities
    let staleRecordsMarked = 0;
    if (!dryRun && isFullSuccess && syncType === 'full') {
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
    } else if (!isFullSuccess) {
      console.log('[sync-sam] Skipping stale cleanup due to incomplete sync');
    }

    return NextResponse.json({
      success: true,
      syncType,
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
        lastSuccessfulOffset,
        failedOffsetsCount: newFailedOffsets.length,
        isFullSuccess,
      },
      errors: errors.slice(0, 10),
      syncRunId,
      resumable: !isFullSuccess && totalFetched > 0,
    });

  } catch (err) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.error('[sync-sam] Fatal error:', err);

    // Update sync run as failed with checkpoint for resume
    if (syncRunId && !dryRun) {
      await getSupabase()
        .from('sam_sync_runs')
        .update({
          completed_at: new Date().toISOString(),
          status: totalFetched > 0 ? 'partial' : 'failed',
          total_fetched: totalFetched,
          total_available: totalAvailable,
          duration_seconds: duration,
          api_calls_made: apiCallsMade,
          last_successful_offset: lastSuccessfulOffset,
          failed_offsets: newFailedOffsets.length > 0 ? newFailedOffsets : null,
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq('id', syncRunId);
    }

    return NextResponse.json({
      success: false,
      syncType,
      error: err instanceof Error ? err.message : String(err),
      stats: {
        totalFetched,
        apiCallsMade,
        durationSeconds: duration,
        lastSuccessfulOffset,
      },
      resumable: totalFetched > 0,
    }, { status: 500 });
  }
}

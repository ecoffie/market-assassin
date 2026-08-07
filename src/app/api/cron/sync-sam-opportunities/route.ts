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
import { getAllDistinctSAMKeys } from '@/lib/sam/utils';
// Opportunity DNA — compute + persist the genome on ingest so NEW opps carry their strand keys the
// moment they land (the backfill covers the existing corpus; this keeps every new row fresh). Uses
// the SAME computeGenome() + genomeKeys() as the map decorate + backfill — one source of truth, no
// lib-duplicate drift. The three derived flags are computed exactly as the map decorate does.
import { computeGenome, genomeKeys } from '@/lib/opportunities/genome';
import { setGroupKey } from '@/lib/opportunities/map-data';
import { sapBuyerTier } from '@/lib/opportunities/sap-friendly-agencies';
import { isRepeatBuyer } from '@/lib/opportunities/repeat-buyer';
import { dodaacFromSolicitation } from '@/lib/opportunities/early-signal-pins';
import { loadDodaacEarlySignal } from '@/lib/gov-contacts/dodaac-directory';

// The DoDAAC early-signal band map, loaded ONCE per sync run (an async precomputed lookup — same as
// the map decorate). mapToDbRecord stays a pure sync fn by reading this run-scoped closure rather
// than awaiting per-row. Null-safe: an unloaded map → postsEarly is simply never set (no fabrication).
let _earlySignalForRun: Map<string, { band: string; pct: number }> | null = null;
// Whether the opportunity_dna columns exist on this DB (probed once per run). If the migration hasn't
// landed yet, an upsert naming a non-existent column HARD-ERRORS the whole batch (not a nulled read —
// PostgREST rejects the write). So we stamp the genome ONLY when the columns are present; the deploy
// is then safe to ship before/independent of the hand-run migration, and the backfill fills the gap.
let _dnaColumnsExist = false;

// THE PAGING LOOP NEEDS TIME. Without these exports this route inherited Vercel's
// DEFAULT function timeout, and every "full" sync was killed ~8 seconds in — after
// exactly ONE page. Measured 2026-08-03: total_available 23,192, total_fetched 1,000,
// status 'partial', last_successful_offset stuck at 1000, api_calls_made 2. The 09:00
// 'resume' run then inherited the same ceiling and fetched 0.
//
// The loop condition was never the bug (maxRecords=50000, batchSize=1000, so it was
// good for ~23 pages) and neither was the cron_jobs timeout_ms=290000 — that governs
// the DISPATCHER's wait, not the function's own execution limit. Only this export does.
//
// Net effect: ~22,000 of ~23,000 available opportunities were never ingested on any
// given night, which is why daily posting counts looked like a collapse in federal
// procurement (165 on a Monday vs ~900 on prior weekdays) when it was really a
// truncated fetch.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2';

// All distinct SAM keys for 429 fail-over. SAM.gov throttles at 1,000/day PER
// KEY; with N keys we try the next one when the current is "Message throttled
// out", turning a daily outage into a non-event. `samKeyIndex` advances on 429.
const SAM_KEYS = getAllDistinctSAMKeys();
let samKeyIndex = 0;
function currentSamKey(): string {
  return SAM_KEYS[samKeyIndex] || '';
}
/** Advance to the next key after a 429. Returns false if no keys remain to try. */
function advanceSamKey(): boolean {
  if (samKeyIndex >= SAM_KEYS.length - 1) return false;
  samKeyIndex++;
  console.warn(`[SAM sync] key ${samKeyIndex} throttled → failing over to key ${samKeyIndex + 1}/${SAM_KEYS.length}`);
  return true;
}

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
  // Additional fields the sync now extracts so users get the full SAM
  // record without leaving Mindy.
  resourceLinks?: string[] | unknown[];
  pointOfContact?: unknown[];
  officeAddress?: unknown;
  fairOpportunity?: unknown;
  additionalInfoLink?: string;
  additionalInfoText?: string;
  // Present on Award Notices (and a few Justification / Combined Synopsis rows).
  // amount arrives as a STRING and can be "" -- see the extraction below.
  award?: {
    date?: string;
    amount?: string | number;
    number?: string;
    awardee?: {
      name?: string;
      ueiSAM?: string;
      cageCode?: string;
      location?: unknown;
    };
  };
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

/**
 * SAM's `offset` is a PAGE NUMBER, not a record offset.
 *
 * Proven against the live API 2026-08-04 (23,937 records, limit=1000):
 *   offset=0  → 1000 rows      offset=22 → 1000 rows
 *   offset=1  → 1000 rows      offset=23 →  937 rows  ← exact remainder of 23,937
 *   offset=20 → 1000 rows      offset=24 →    0 rows  ← past the end
 *   offset=1000 → 0 rows
 *
 * If it were a record offset, offset=1 would return records 1..1000 (overlapping
 * page 0 by 999) and offset=23 would return a full page. It returns neither.
 *
 * This changed on 2026-07-29. Before that the same code made 24 calls and fetched
 * 23,546 records; from that date every run made exactly 2 calls and fetched exactly
 * 1,000, because the loop advanced `offset += 1000` and so asked for PAGE 1000 —
 * which SAM answers with HTTP 200 and an empty array. The loop's `length === 0`
 * break then exited cleanly, so the run recorded status 'partial' with ZERO errors,
 * null failed_offsets and null error_message. Nothing alerted, for seven days,
 * while ~23,000 opportunities a day went un-ingested.
 *
 * The parameter is named `page` here so this can never be re-read as a byte offset.
 */
async function fetchOpportunitiesPage(
  page: number,
  limit: number,
  lookbackDays: number = 30
): Promise<{ opportunities: SamOpportunity[], total: number }> {
  const today = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  const buildUrl = () => {
    const params = new URLSearchParams({
      api_key: currentSamKey(),
      limit: String(limit),
      offset: String(page), // SAM reads this as a page index — see the note above

      postedFrom: formatDateForSam(startDate),
      postedTo: formatDateForSam(today),
    });
    return `${SAM_API_BASE}/search?${params.toString()}`;
  };

  // Use retry wrapper with 90-second timeout per request. On a 429 (quota
  // throttle) we fail over to the NEXT key before retrying — a throttled key
  // never recovers same-day, so retrying it is pointless; the next key may have
  // quota left. If all keys are throttled, the error propagates (resumable).
  return fetchWithRetry(async () => {
    const response = await fetch(buildUrl(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(90000), // 90 seconds
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      if (response.status === 429 && advanceSamKey()) {
        // Retry immediately with the next key (don't count the throttle as a
        // backoff-worthy transient — it's a hard per-key daily cap).
        const retry = await fetch(buildUrl(), {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(90000),
        });
        if (retry.ok) {
          const d = await retry.json();
          return { opportunities: d.opportunitiesData || [], total: d.totalRecords || 0 };
        }
        const retryErr = await retry.text().catch(() => 'Unknown error');
        throw new Error(`SAM.gov API error: ${retry.status} - ${retryErr.substring(0, 200)}`);
      }
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
  const record: Record<string, unknown> = {
    notice_id: opp.noticeId,
    solicitation_number: opp.solicitationNumber || null,
    title: opp.title || 'Untitled',
    // NOTE: `description` is deliberately NOT set here. opp.description from the SAM
    // /search list endpoint is a LINK (.../noticedesc?...), not the body text, so
    // storing it made body search useless. Omitting it from the upsert means:
    //  - new notices insert with description = NULL (column default), and
    //  - re-syncs of existing notices DON'T clobber text the backfill already wrote
    //    (upsert only sets the columns present in the record).
    // The backfill-descriptions cron claims null/link rows and fills real text from
    // raw_data.description (the link, still stored below) within minutes.
    naics_code: opp.naicsCode || null,
    psc_code: opp.classificationCode || null,
    department: opp.department?.name || opp.fullParentPathName?.split('.')[0] || null,
    // SAM's subtierAgency.name is null for most DoD notices, which left sub_tier 100%
    // null and made Navy/Army/AF/DLA slicing impossible. Fall back to position 2 of the
    // hierarchy path (the service branch / sub-agency), same pattern as department above.
    sub_tier: opp.subtierAgency?.name || opp.fullParentPathName?.split('.')[1]?.trim() || null,
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
    points_of_contact: Array.isArray(opp.pointOfContact) ? opp.pointOfContact : [],
    office_address: opp.officeAddress ?? null,
    fair_opportunity: opp.fairOpportunity ?? null,
    additional_info_link: opp.additionalInfoLink || null,
    additional_info_text: opp.additionalInfoText || null,
    raw_data: opp,
    synced_at: new Date().toISOString(),
  };

  // Award Notices carry the winner inline under opp.award -- name, ueiSAM, cageCode,
  // amount, date. The blob was always stored in raw_data but the typed columns were
  // never mapped, so awardee_name/uei/amount/date sat 100% NULL across ~31K award
  // notices while the data sat right there in the row. Extract them so new notices
  // land queryable and awardee_uei joins straight to the BigQuery contractor rollup.
  //
  // Set these ONLY when the payload actually has an awardee -- same rule as attachments
  // and description above: an upsert writes every key present in the record, so
  // unconditionally including these would null out good values on the next re-sync of
  // a non-award notice. Empty strings are real in SAM's payload (amount:"", ueiSAM:"").
  const awardee = opp.award?.awardee;
  if (awardee?.name) {
    record.awardee_name = awardee.name;
    const uei = String(awardee.ueiSAM ?? '').trim();
    if (uei) record.awardee_uei = uei;
    const amount = String(opp.award?.amount ?? '').trim();
    if (/^[0-9]+(\.[0-9]+)?$/.test(amount)) record.award_amount = Number(amount);
    const awardDate = String(opp.award?.date ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(awardDate)) record.award_date = awardDate.slice(0, 10);
  }

  // List endpoint often omits resourceLinks. Never wipe enriched attachment
  // metadata (url+name from backfill) by writing [] on every sync pass.
  if (Array.isArray(opp.resourceLinks) && opp.resourceLinks.length > 0) {
    record.attachments = opp.resourceLinks;
  }

  // ── Opportunity DNA — compute + stamp the genome so this new/re-synced row is filter-ready ──────
  // Skip entirely until the migration lands (else the upsert hard-errors on the missing column). Once
  // the columns exist the backfill has run, so the sync just keeps new rows fresh.
  if (!_dnaColumnsExist) return record;
  // The three derived flags mirror the map decorate EXACTLY (sap-friendly buyer tier, repeat-buyer
  // agency×NAICS set, early-signal DoDAAC band). src is always 'SAM' on this cache. A row with no
  // strands persists opportunity_dna_keys = [] (honest — matches no strategy filter, never fabricated).
  const dept = (record.department as string | null) || null;
  const dodaac = dodaacFromSolicitation(record.solicitation_number as string | null);
  const sbf = sapBuyerTier(dept) === 'most' ? 1 : 0;
  const repeatBuyer = isRepeatBuyer(dept, record.naics_code as string | null) ? 1 : 0;
  const postsEarly = (dodaac && _earlySignalForRun?.get(dodaac)?.band === 'high') ? 1 : 0;
  const genome = computeGenome({
    src: 'SAM',
    noticeType: record.notice_type as string | null,
    title: record.title as string | null,
    set: setGroupKey(record.set_aside_code as string | null),
    close: record.response_deadline as string | null,
    sbf, repeatBuyer, postsEarly,
  }, Date.now());
  record.opportunity_dna = genome;
  record.opportunity_dna_keys = genomeKeys(genome);
  record.dna_computed_at = new Date().toISOString();

  return record;
}

// Find incomplete sync to resume
async function findResumableRun(): Promise<{
  id: string;
  lastSuccessfulOffset: number;
  totalAvailable: number;
  failedOffsets: number[];
} | null> {
  try {
    // Surface the error rather than swallowing it. This is the RESUME CHECKPOINT
    // lookup: if a renamed/missing column makes PostgREST fail the whole query,
    // data comes back null, resume silently restarts from offset 0, and the sync
    // re-fetches ground it already covered — burning SAM quota that is already the
    // binding constraint. A silent null here is indistinguishable from "no prior
    // failed run", which is exactly the wrong default.
    // PGRST116 = "no rows" from .single(), which is the legitimate no-checkpoint case.
    const { data, error } = await getSupabase()
      .from('sam_sync_runs')
      .select('id, last_successful_offset, total_available, failed_offsets')
      .in('status', ['failed', 'partial'])
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[sync-sam] checkpoint lookup FAILED — resuming from offset 0:', error.message);
    }

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

  if (SAM_KEYS.length === 0) {
    return NextResponse.json({ error: 'No SAM API keys configured (SAM_API_KEY / SAM_API_KEY_1..N / SAM_API_KEY_BACKUP)' }, { status: 500 });
  }
  // Start each run from the first key so keys whose quota has reset get re-tried
  // (the module-level index can otherwise stay advanced across warm invocations).
  samKeyIndex = 0;

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
  // PAGE, not record offset. `last_successful_offset` in the DB holds RECORD offsets
  // written by the pre-2026-08-04 code (e.g. 1000), so a stored value >= batchSize is a
  // legacy checkpoint and is converted. Without this, resume would ask for page 1000
  // and fetch nothing — the exact bug being fixed.
  let page = startOffset >= batchSize ? Math.floor(startOffset / batchSize) : startOffset;
  if (page !== startOffset) {
    console.log(`[sync-sam] Legacy checkpoint ${startOffset} (record offset) → page ${page}`);
  }
  let totalAvailable = 0;
  let lastSuccessfulPage = page;
  const errors: string[] = [];
  const newFailedOffsets: number[] = [...failedOffsets];

  try {
    console.log(`[sync-sam] Starting ${syncType} sync, page: ${page}, max: ${maxRecords}, dry: ${dryRun}`);

    // Load the DoDAAC early-signal band map ONCE for this run so mapToDbRecord can stamp the
    // Opportunity DNA genome per row without a per-row await. Degrade clean: a load failure → an
    // empty map → postsEarly is simply never set (the genome still computes; no strand is fabricated).
    _earlySignalForRun = await loadDodaacEarlySignal().catch(() => new Map<string, { band: string; pct: number }>());
    // Probe ONCE whether the opportunity_dna columns exist — stamp the genome only if they do, so a
    // deploy before the hand-run migration can't hard-error every upsert on a missing column.
    {
      const { error: dnaProbeErr } = await getSupabase()
        .from('sam_opportunities').select('opportunity_dna_keys').limit(1);
      _dnaColumnsExist = !dnaProbeErr;
      if (!_dnaColumnsExist) console.warn('[sync-sam] opportunity_dna columns absent — skipping genome stamp (run migration 20260804_opportunity_dna)');
    }

    // Fetch first page to get total (or resume from checkpoint)
    const firstPage = await fetchOpportunitiesPage(page, batchSize, lookbackDays);
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
        errors.push(`Upsert error at page ${page}: ${upsertError.message}`);
        newFailedOffsets.push(page);
        console.error('[sync-sam] Upsert error:', upsertError);
      } else {
        newRecords += firstBatch.length;
        lastSuccessfulPage = page + 1;
      }
    }

    page += 1;

    // Continue fetching remaining pages
    // Page count, not record count. 23,937 records at 1000/page = pages 0..23, where
    // page 23 holds the 937-row remainder. Guard on the page bound AND keep the
    // empty-page break below as a belt-and-braces stop.
    const lastPage = Math.max(0, Math.ceil(totalAvailable / batchSize) - 1);
    while (page <= lastPage && totalFetched < maxRecords) {
      console.log(`[sync-sam] Fetching page ${page} of ${lastPage}...`);

      // Rate limit: wait 200ms between requests
      await new Promise(resolve => setTimeout(resolve, 200));

      // Update checkpoint periodically (every 5 batches)
      // CHECKPOINT EVERY PAGE, not every 5. A resumable pipeline whose checkpoint
      // lags 5 pages behind isn't resumable: a run killed on page 3 wrote nothing,
      // so 'resume' restarted from the STALE offset and re-fetched ground already
      // covered — which is how the 09:00 resume run fetched 0 records on 2026-08-03
      // while 22,000 opportunities sat un-ingested. One extra tiny UPDATE per page
      // (~23/night) is nothing next to losing the whole run's progress.
      if (syncRunId && !dryRun) {
        try {
          await getSupabase()
            .from('sam_sync_runs')
            .update({
              total_fetched: totalFetched,
              // These columns may not exist yet - Supabase ignores unknown columns
              last_successful_offset: lastSuccessfulPage,
              failed_offsets: newFailedOffsets.length > 0 ? newFailedOffsets : null,
            })
            .eq('id', syncRunId);
        } catch (err) {
          // Checkpoint columns may not exist - continue without checkpointing
          console.log('[sync-sam] Checkpoint update skipped:', err);
        }
      }

      try {
        const pageResult = await fetchOpportunitiesPage(page, batchSize, lookbackDays);
        apiCallsMade++;

        if (pageResult.opportunities.length === 0) {
          console.log(`[sync-sam] Page ${page} empty, stopping`);
          break;
        }

        const batch = pageResult.opportunities.map(mapToDbRecord);
        totalFetched += batch.length;

        if (!dryRun && batch.length > 0) {
          const { error: upsertError } = await getSupabase()
            .from('sam_opportunities')
            .upsert(batch, { onConflict: 'notice_id', ignoreDuplicates: false });

          if (upsertError) {
            errors.push(`Batch page ${page}: ${upsertError.message}`);
            newFailedOffsets.push(page);
          } else {
            updatedRecords += batch.length;
            lastSuccessfulPage = page + 1;
            // Remove from failed pages if it was there
            const idx = newFailedOffsets.indexOf(page);
            if (idx > -1) newFailedOffsets.splice(idx, 1);
          }
        }

        page += 1;
      } catch (pageError) {
        const errMsg = pageError instanceof Error ? pageError.message : 'Unknown';
        errors.push(`Page ${page}: ${errMsg}`);
        newFailedOffsets.push(page);
        console.error(`[sync-sam] Page error at page ${page}:`, errMsg);
        // Continue to next page even if one fails
        page += 1;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    const isFullSuccess = newFailedOffsets.length === 0 && page > Math.max(0, Math.ceil(totalAvailable / batchSize) - 1);
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
          last_successful_offset: lastSuccessfulPage,
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

      // CHUNKED, because the single-statement version times out.
      //
      // The original did one UPDATE ... WHERE synced_at < now()-7d AND active
      // with .select('id') appended — so Postgres had to rewrite ~15,300 rows AND
      // return every id, in one statement, inside the request. It died with
      // "canceling statement due to statement timeout" on the very first successful
      // sync after the pagination fix (2026-08-04).
      //
      // This bug was INVISIBLE for seven days for a subtle reason: stale cleanup only
      // runs after `isFullSuccess`, and no full sync had succeeded since 2026-07-29.
      // Fixing pagination is what surfaced it. It never regressed — it just finally ran.
      //
      // Chunking by id keeps each statement small (measured: ~200ms per 500 rows) and
      // makes partial progress durable: if a later chunk fails, earlier ones stay
      // committed and tomorrow's run finishes the rest. head:true on the count query
      // avoids dragging 15k ids over the wire just to size the job.
      const STALE_CHUNK = 500;
      const STALE_MAX_CHUNKS = 60; // 30k rows/run ceiling — a backstop, not a target
      const cutoff = sevenDaysAgo.toISOString();
      let staleChunks = 0;
      let staleError: { message: string } | null = null;

      for (; staleChunks < STALE_MAX_CHUNKS; staleChunks++) {
        const { data: batch, error: pickError } = await getSupabase()
          .from('sam_opportunities')
          .select('id')
          .eq('active', true)
          .lt('synced_at', cutoff)
          .limit(STALE_CHUNK);

        if (pickError) { staleError = pickError; break; }
        if (!batch || batch.length === 0) break; // drained

        const { error: markError } = await getSupabase()
          .from('sam_opportunities')
          .update({ active: false })
          .in('id', batch.map((r: { id: string }) => r.id));

        if (markError) { staleError = markError; break; }
        staleRecordsMarked += batch.length;
        if (batch.length < STALE_CHUNK) break; // last partial chunk
      }

      if (staleError) {
        // Report the partial progress, not just the failure — "marked 9,000 then hit
        // an error" is a different situation from "marked nothing".
        errors.push(`Stale cleanup error after ${staleRecordsMarked} rows: ${staleError.message}`);
        console.error('[sync-sam] Stale cleanup error:', staleError);
      } else {
        console.log(`[sync-sam] Marked ${staleRecordsMarked} stale records as inactive in ${staleChunks} chunk(s)`);
        if (staleChunks >= STALE_MAX_CHUNKS) {
          console.warn(`[sync-sam] Stale cleanup hit the ${STALE_MAX_CHUNKS}-chunk ceiling — more remain for the next run`);
        }
      }
    } else if (!isFullSuccess) {
      console.log('[sync-sam] Skipping stale cleanup due to incomplete sync');
    }

    // CHAINED: kick the gov-buyer data sync (entities + gov-POC contacts).
    // It has no Vercel cron slot of its own — the platform caps crons at
    // 100 and we're at the limit (long-term fix: the cron-dispatcher PRD,
    // docs/PRD-cron-dispatcher.md). We chain it here because this daily
    // 'full' run produces the opportunity POC data the contacts pull reads,
    // so ordering is natural. Fire-and-forget: never blocks or fails the
    // opportunities sync.
    if (!dryRun && syncType === 'full') {
      try {
        const origin = new URL(request.url).origin;
        const pw = process.env.ADMIN_PASSWORD;
        // Don't await — let it run independently; log only.
        fetch(`${origin}/api/cron/sync-gov-buyer-data?pull=both&password=${pw}`)
          .then(r => console.log(`[sync-sam] chained gov-buyer sync -> ${r.status}`))
          .catch(e => console.log('[sync-sam] chained gov-buyer sync error:', e?.message));
      } catch (e) {
        console.log('[sync-sam] could not chain gov-buyer sync:', (e as Error)?.message);
      }
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
        lastSuccessfulPage,
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
          last_successful_offset: lastSuccessfulPage,
          failed_offsets: newFailedOffsets.length > 0 ? newFailedOffsets : null,
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq('id', syncRunId);
    }

    // Transient UPSTREAM failure (SAM.gov gateway 5xx / "no healthy upstream")
    // is not OUR bug — it happens most days at the 9am sync rush. Return a SOFT
    // skip (HTTP 200) so the dispatcher records success and the watchdog doesn't
    // alert daily on an external hiccup. Genuine failures (auth/DB/our code)
    // still 500 → still alert. The run stays resumable; next tick retries.
    const msg = err instanceof Error ? err.message : String(err);
    const isUpstreamTransient = /SAM\.gov API error:\s*(502|503|504)\b|no healthy upstream/i.test(msg);
    if (isUpstreamTransient && totalFetched === 0) {
      console.warn('[sync-sam] soft-skip: transient SAM.gov upstream error —', msg);
      return NextResponse.json({
        success: true, // dispatcher/watchdog treat as OK; this is SAM.gov being down, not us
        skipped: true,
        syncType,
        note: 'SAM.gov upstream unavailable (transient) — will retry next run',
        error: msg,
        stats: { totalFetched, apiCallsMade, durationSeconds: duration, lastSuccessfulPage },
        resumable: true,
      }, { status: 200 });
    }

    return NextResponse.json({
      success: false,
      syncType,
      error: msg,
      stats: {
        totalFetched,
        apiCallsMade,
        durationSeconds: duration,
        lastSuccessfulPage,
      },
      resumable: totalFetched > 0,
    }, { status: 500 });
  }
}

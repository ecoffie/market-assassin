/**
 * SOW/PWS catalog backfill (#66) — Eric's "in-between" workaround.
 *
 * For active opps that HAVE attachments but haven't been checked, fetch the
 * attachment filenames (cheap — content-disposition header), detect SOW/PWS/SOO/
 * Combined/Specs, extract the scope text when found, and stamp the catalog
 * columns. Resumable batch: processes BATCH_SIZE least-recently-checked records
 * per invocation with a soft time budget, returns `remaining`, and the dispatcher
 * re-fires until the corpus is fully built. Bounded SAM load.
 *
 * Ships two payoffs from one backfill: a "Has SOW/PWS" feed filter NOW, and the
 * sow_text corpus that powers the semantic "hidden work" search later.
 *
 * Dispatcher cron (NOT vercel.json): INSERT a cron_jobs row pointing here.
 * Manual: GET /api/cron/sow-catalog?limit=20 (also runnable ad-hoc).
 *   ?resweep=1  → re-check the "checked, no SOW" false-negatives (has_sow_doc=false AND sow_text NULL,
 *                 stamped before SOW_RESWEEP_CUTOFF) — recovers rows a swallowed fetch/429 wrongly
 *                 buried. Bounded: a genuine re-check bumps sow_checked_at past the cutoff.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { attachmentUrls, scanAttachmentsForSow } from '@/lib/sam/sow-detect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sb(): any {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const BATCH_SIZE = parseInt(process.env.SOW_CATALOG_BATCH_SIZE || '25', 10);
const SOFT_BUDGET_MS = 90_000;       // leave headroom under maxDuration

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const supabase = sb();
  const apiKey = process.env.SAM_API_KEY || '';
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || String(BATCH_SIZE), 10), 100);

  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'SAM_API_KEY not set' }, { status: 500 });
  }

  // Retention (#66 Phase-6 prep): catalog ACTIVE opps first (biddable now), then
  // fall through to INACTIVE opps that still have their attachment URLs in cache —
  // ~55K expired solicitations whose SOWs we'd otherwise lose. Recovering them now
  // builds the recompete corpus (the incumbent's real scope, searchable later).
  // Both keep sow_text after expiry (the sync upsert never touches sow_* columns).
  // Re-sweep mode (?resweep=1): re-check the rows previously stamped "checked, no SOW found"
  // (has_sow_doc=false AND sow_text IS NULL). Those include false negatives poisoned by a swallowed
  // fetch failure / SAM 429 at check time (the Little Creek bug). This pass re-reads them and — now
  // that scanAttachmentsForSow reports reachedAny/rateLimited — only re-stamps when the check was
  // GENUINE, so a real quota failure is left for retry instead of re-buried. (Eric 2026-08-01.)
  const resweep = request.nextUrl.searchParams.get('resweep') === '1';
  // Resweep bounds itself with a cutoff: only re-check false-negatives stamped BEFORE the fix shipped.
  // A genuine re-check bumps sow_checked_at past the cutoff → the row can't be re-grabbed → no infinite
  // loop even for rows that truly have no SOW.
  const RESWEEP_CUTOFF = process.env.SOW_RESWEEP_CUTOFF || '2026-08-01T00:00:00Z';
  const selectCols = 'id, notice_id, title, attachments';
  const claimable = () => resweep
    ? supabase.from('sam_opportunities').select(selectCols)
        .not('attachments', 'is', null).eq('has_sow_doc', false).is('sow_text', null)
        .lt('sow_checked_at', RESWEEP_CUTOFF)
    : supabase.from('sam_opportunities').select(selectCols)
        .not('attachments', 'is', null).is('sow_checked_at', null);
  const uncheckedWithAttach = claimable;

  // Active backlog first.
  let { data: rows, error } = await uncheckedWithAttach()
    .eq('active', true)
    .order('id', { ascending: true })
    .limit(limit);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  let phase = 'active';
  // Active drained → recover inactive (recompete corpus). newest-expired first
  // (those are the live recompetes; oldest are lowest-value).
  if (!rows || rows.length === 0) {
    const inactive = await uncheckedWithAttach()
      .eq('active', false)
      .order('archive_date', { ascending: false })
      .limit(limit);
    rows = inactive.data;
    phase = 'inactive';
  }

  // Count what's left across BOTH phases (active + inactive) so the dispatcher
  // keeps firing until the whole corpus — current + recompete — is built. In resweep mode this counts
  // the remaining pre-cutoff false-negatives instead.
  let countQ = supabase.from('sam_opportunities').select('*', { count: 'exact', head: true }).not('attachments', 'is', null);
  countQ = resweep
    ? countQ.eq('has_sow_doc', false).is('sow_text', null).lt('sow_checked_at', RESWEEP_CUTOFF)
    : countQ.is('sow_checked_at', null);
  const { count: remainingTotal } = await countQ;

  let processed = 0, sowFound = 0, withText = 0, failed = 0, skippedUnreached = 0;
  let rateLimited = false;
  const checkedAt = new Date().toISOString();

  for (const row of rows || []) {
    if (Date.now() - startedAt > SOFT_BUDGET_MS) break;   // soft budget — never get killed
    if (rateLimited) break;                                // SAM quota hit → stop; leave rest for retry
    const urls = attachmentUrls(row.attachments);
    if (!urls.length) {
      // No real URLs → mark checked so we don't re-pick it forever.
      await supabase.from('sam_opportunities').update({ has_sow_doc: false, sow_checked_at: checkedAt }).eq('id', row.id);
      processed++;
      continue;
    }
    try {
      const scan = await scanAttachmentsForSow(urls, apiKey);
      // ⚠️ HONESTY: only STAMP when the check was GENUINE (at least one attachment fetch succeeded).
      // If SAM 429'd us or every fetch failed, this is "couldn't check", NOT "no SOW" — leave the row
      // UNSTAMPED so it retries. Stamping a quota blip is exactly what buried the Little Creek SOW.
      if (scan.rateLimited) { rateLimited = true; skippedUnreached++; break; }
      if (!scan.reachedAny) { skippedUnreached++; continue; }
      await supabase.from('sam_opportunities').update({
        has_sow_doc: scan.hasSowDoc,
        sow_doc_type: scan.docType,
        sow_filename: scan.filename,
        sow_text: scan.text,
        sow_checked_at: checkedAt,
      }).eq('id', row.id);
      processed++;
      if (scan.hasSowDoc) sowFound++;
      if (scan.text) withText++;
    } catch {
      // An unexpected throw (not a fetch failure — those are swallowed inside the scan) → do NOT stamp;
      // leave for retry. (The old code stamped here, which is how transient failures became permanent.)
      failed++;
    }
  }

  const remaining = Math.max(0, (remainingTotal || 0) - processed);
  return NextResponse.json({
    success: true,
    mode: resweep ? 'resweep' : 'catalog',
    phase,                 // 'active' (biddable now) or 'inactive' (recompete corpus)
    processed, sowFound, withText, failed,
    skippedUnreached,      // rows NOT stamped because the check couldn't reach SAM (retry, not "no SOW")
    rateLimited,           // SAM daily quota hit → run stopped early; unstamped rows retry after reset
    remaining,
    elapsedMs: Date.now() - startedAt,
  });
}

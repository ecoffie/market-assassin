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

  // Next batch: active, has attachments, least-recently-checked (null first).
  const { data: rows, error } = await supabase
    .from('sam_opportunities')
    .select('id, notice_id, title, attachments')
    .eq('active', true)
    .not('attachments', 'is', null)
    .is('sow_checked_at', null)
    .order('id', { ascending: true })
    .limit(limit);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // Count what's left to do (for the dispatcher to know when to stop re-firing).
  const { count: remainingTotal } = await supabase
    .from('sam_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('active', true)
    .not('attachments', 'is', null)
    .is('sow_checked_at', null);

  let processed = 0, sowFound = 0, withText = 0, failed = 0;
  const checkedAt = new Date().toISOString();

  for (const row of rows || []) {
    if (Date.now() - startedAt > SOFT_BUDGET_MS) break;   // soft budget — never get killed
    const urls = attachmentUrls(row.attachments);
    if (!urls.length) {
      // No real URLs → mark checked so we don't re-pick it forever.
      await supabase.from('sam_opportunities').update({ has_sow_doc: false, sow_checked_at: checkedAt }).eq('id', row.id);
      processed++;
      continue;
    }
    try {
      const scan = await scanAttachmentsForSow(urls, apiKey);
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
      // Stamp checked even on failure so a poison record doesn't block the queue;
      // a future full re-sweep can null sow_checked_at to retry.
      await supabase.from('sam_opportunities').update({ sow_checked_at: checkedAt }).eq('id', row.id);
      failed++;
    }
  }

  const remaining = Math.max(0, (remainingTotal || 0) - processed);
  return NextResponse.json({
    success: true,
    processed, sowFound, withText, failed,
    remaining,
    elapsedMs: Date.now() - startedAt,
  });
}

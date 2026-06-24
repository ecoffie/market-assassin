/**
 * SOW corpus embedding backfill (#66 Phase-3 prep) — the MISSING drain.
 *
 * sow-catalog extracts sow_text but never embeds it; recompete-sow only embeds
 * the user's query on demand. So rows with sow_text and no sow_embedding had no
 * automated path to completion — the corpus stalled at ~91% embedded, which caps
 * hidden-match quality (Eric QC 2026-06-16). This cron closes that gap.
 *
 * Drains sam_opportunities where sow_text IS NOT NULL AND sow_embedding IS NULL,
 * embeds via text-embedding-3-small (embedText handles OpenAI 429 with backoff),
 * writes the 1536-d array to sow_embedding (JSONB, read by parseEmbedding).
 * Batched + resumable + soft time budget + active-first, mirroring sow-catalog.
 * Steady-state: as sow-catalog extracts new SOWs, this embeds them.
 *
 * Dispatcher cron (NOT vercel.json): INSERT a cron_jobs row pointing here.
 * Manual: GET /api/cron/embed-sow-corpus?limit=50  (also runnable ad-hoc).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { embedText } from '@/lib/market/embeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sb(): any {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const BATCH_SIZE = parseInt(process.env.SOW_EMBED_BATCH_SIZE || '40', 10);
const SOFT_BUDGET_MS = 90_000; // headroom under maxDuration

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const supabase = sb();
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || String(BATCH_SIZE), 10), 200);

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ success: false, error: 'OPENAI_API_KEY not set' }, { status: 500 });
  }

  // Needs embedding = no vector yet AND has SOME text to embed (SOW scope text OR
  // the notice description). The description fallback (Eric, Jun 24) grows the
  // semantic corpus past the ~10K SOW-attachment ceiling toward the full opp
  // corpus — most opps have a description even without a SOW/PWS attachment.
  const needsEmbed = () => supabase
    .from('sam_opportunities')
    .select('id, notice_id, title, sow_text, description')
    .is('sow_embedding', null)
    .or('sow_text.not.is.null,description.not.is.null');

  // Active (biddable now) first, then fall through to inactive (recompete corpus).
  let phase = 'active';
  let { data: rows, error } = await needsEmbed()
    .eq('active', true)
    .order('id', { ascending: true })
    .limit(limit);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  if (!rows || rows.length === 0) {
    phase = 'inactive';
    ({ data: rows, error } = await needsEmbed()
      .eq('active', false)
      .order('id', { ascending: true })
      .limit(limit));
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows || []) {
    if (Date.now() - startedAt > SOFT_BUDGET_MS) break;
    // Prefer SOW/PWS scope text (richest signal); fall back to the notice
    // description so opps without a SOW attachment still join the corpus.
    const text = (row.sow_text || row.description || '').trim();
    if (text.length < 80) {
      // Nothing meaningful to embed. Stamp an empty-array sentinel so this row
      // isn't re-selected every run (sow_embedding IS NULL is the retry flag).
      // parseEmbedding treats a non-1536 array as null → hidden-match ignores it.
      await supabase.from('sam_opportunities').update({ sow_embedding: [] }).eq('id', row.id).then(() => {}, () => {});
      skipped++;
      continue;
    }
    try {
      const vec = await embedText(text);
      const { error: upErr } = await supabase
        .from('sam_opportunities')
        .update({ sow_embedding: vec })
        .eq('id', row.id);
      if (upErr) { failed++; continue; }
      embedded++;
    } catch {
      // Non-fatal — a poison row shouldn't block the queue. It stays null and is
      // retried next run (we don't stamp a checked-at; the null IS the retry flag).
      failed++;
    }
  }

  // Remaining across BOTH phases so the dispatcher knows when it's truly drained.
  const { count: remaining } = await supabase
    .from('sam_opportunities')
    .select('*', { count: 'exact', head: true })
    .is('sow_embedding', null)
    .or('sow_text.not.is.null,description.not.is.null');

  return NextResponse.json({
    success: true,
    phase,
    processed: (rows || []).length,
    embedded,
    skipped,
    failed,
    remaining: remaining ?? null,
    tookMs: Date.now() - startedAt,
  });
}

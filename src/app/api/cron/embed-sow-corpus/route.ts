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

  // Needs embedding = has extracted scope text but no vector yet.
  const needsEmbed = () => supabase
    .from('sam_opportunities')
    .select('id, notice_id, title, sow_text')
    .not('sow_text', 'is', null)
    .is('sow_embedding', null);

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
    const text = (row.sow_text || '').trim();
    if (!text) {
      // No usable text — stamp an empty vector? No: just skip; nothing to embed.
      // Leaving sow_embedding null is correct (it has no scope to match on).
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
    .not('sow_text', 'is', null)
    .is('sow_embedding', null);

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

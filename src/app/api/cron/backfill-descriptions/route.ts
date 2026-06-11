/**
 * /api/cron/backfill-descriptions
 *
 * Captures real notice BODY TEXT into sam_opportunities.description so body search
 * ("M7 in the body") works. The SAM list endpoint returns description as a LINK; our
 * sync stored the link, so every description was an unusable URL. This resolves the
 * link → text via the shared lib and overwrites description.
 *
 * Batched + resumable, dispatcher-fired (cron_jobs row), uses the prod SAM key
 * server-side. Each run claims a bounded batch of rows still holding a link/null
 * description, processes them with a concurrency pool under a soft time budget, and
 * returns `remaining` so the dispatcher window drains the corpus over several runs.
 * A row stops matching once it has real text → naturally resumable, no new column.
 *
 *   ?mode=preview        → counts only (default-safe; no fetches, no writes)
 *   ?mode=execute        → process one batch
 *   ?inactive=1          → target the inactive (recompete) corpus instead of active
 *   ?limit=N             → rows to claim this run (default 300)
 *   ?concurrency=N       → parallel fetches (default 12)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isDescriptionLink, fetchNoticeDescription } from '@/lib/sam/notice-description';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const LINK_FILTER = 'description.like.http%,description.is.null';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = { id: any; notice_id: string; raw_data: any };

async function processOne(supabase: ReturnType<typeof sb>, row: Row, apiKey: string): Promise<'text' | 'empty' | 'fail'> {
  const rawDesc = row.raw_data?.description;
  const link = isDescriptionLink(rawDesc) ? String(rawDesc) : row.notice_id;
  try {
    const text = await Promise.race([
      fetchNoticeDescription(link, apiKey),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 25_000)),
    ]);
    await supabase.from('sam_opportunities').update({ description: text || '' }).eq('id', row.id);
    return text ? 'text' : 'empty';
  } catch {
    // Store '' so a hanging/404 notice stops matching the link-filter (never re-claimed).
    await supabase.from('sam_opportunities').update({ description: '' }).eq('id', row.id);
    return 'fail';
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'preview';
  const active = url.searchParams.get('inactive') !== '1';
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 300)));
  const concurrency = Math.max(1, Math.min(20, Number(url.searchParams.get('concurrency') || 12)));
  const supabase = sb();
  const apiKey = process.env.SAM_API_KEY || '';

  // Always report how many still need backfill (cheap head count).
  const { count: remaining } = await supabase
    .from('sam_opportunities')
    .select('notice_id', { count: 'exact', head: true })
    .eq('active', active)
    .or(LINK_FILTER);

  if (mode !== 'execute') {
    return NextResponse.json({ success: true, mode: 'preview', target: active ? 'active' : 'inactive', remaining: remaining || 0 });
  }
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'SAM_API_KEY not configured' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('sam_opportunities')
    .select('id, notice_id, raw_data')
    .eq('active', active)
    .or(LINK_FILTER)
    .limit(limit);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  const rows = (data || []) as Row[];

  // Concurrency pool with a soft time budget so we return before the platform kills us.
  const deadline = Date.now() + 240_000; // 4 min soft budget (maxDuration 300)
  let i = 0, text = 0, empty = 0, fail = 0, processed = 0;
  async function worker() {
    while (i < rows.length && Date.now() < deadline) {
      const r = await processOne(supabase, rows[i++], apiKey);
      processed++;
      if (r === 'text') text++; else if (r === 'empty') empty++; else fail++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  return NextResponse.json({
    success: true,
    mode: 'execute',
    target: active ? 'active' : 'inactive',
    claimed: rows.length,
    processed,
    withText: text,
    empty,
    failed: fail,
    remainingAfter: Math.max(0, (remaining || 0) - processed),
  });
}

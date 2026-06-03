/**
 * /api/admin/heal-pursuit-attachments
 *
 * One-shot repair for pursuits whose SAM attachments never landed. Two root
 * causes this heals:
 *   1. notice_id stored as a solicitation number (e.g. "70203926CGASHED")
 *      instead of the canonical SAM UUID — the attachment fetcher keys off the
 *      UUID, so these always came back empty.
 *   2. docs_status stuck at 'fetching' (killed background worker) or sitting at
 *      'none'/'failed' from a fetch that ran before the cache-first fix.
 *
 * For each candidate it re-runs fetchPursuitDocs(), which now resolves the
 * solicitation number → UUID via the SAM cache, heals user_pipeline.notice_id,
 * and pulls attachment URLs straight from sam_opportunities.attachments.
 *
 * GET  ?password=...                      → preview: how many pursuits need healing
 * POST ?password=...&mode=execute         → run the heal
 *   optional &limit=N  (default 50 per run — keep under the function budget)
 *   optional &email=user@example.com      → scope to one user
 *   optional &pipeline_id=<uuid>          → heal a single pursuit
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchPursuitDocs } from '@/lib/sam/fetch-pursuit-docs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

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

const isUuid = (v?: string | null) => !!v && /^[a-f0-9]{32}$/i.test(v.trim());

interface PipelineRow {
  id: string;
  user_email: string | null;
  notice_id: string | null;
  title: string | null;
  docs_status: string | null;
  docs_count: number | null;
}

// A pursuit needs healing if it has a notice_id but either the id isn't a UUID
// (so the fetcher couldn't match it) or no docs landed yet.
function needsHeal(row: PipelineRow): boolean {
  if (!row.notice_id) return false;
  if (!isUuid(row.notice_id)) return true;
  const status = row.docs_status;
  if (status === 'fetching' || status === 'pending' || status === 'failed') return true;
  if (status === 'none' && (row.docs_count || 0) === 0) return true; // re-verify with cache-first fetch
  return false;
}

async function loadCandidates(opts: { email?: string | null; pipelineId?: string | null }): Promise<PipelineRow[]> {
  const sb = getSupabase();
  let query = sb
    .from('user_pipeline')
    .select('id, user_email, notice_id, title, docs_status, docs_count')
    .not('notice_id', 'is', null)
    .limit(2000);
  if (opts.pipelineId) query = query.eq('id', opts.pipelineId);
  else if (opts.email) query = query.eq('user_email', opts.email.toLowerCase());
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data || []) as PipelineRow[]).filter(needsHeal);
}

// Coverage metric: of all pursuits with a SAM notice_id, what fraction reached
// a terminal attachment state, and how many actually have docs. This is the
// "are we at 100%" gauge — once stuck/non-UUID pursuits drop to ~0, Proposal
// Assist has the documents it needs.
async function attachmentCoverage() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('user_pipeline')
    .select('notice_id, docs_status, docs_count')
    .not('notice_id', 'is', null)
    .limit(5000);
  if (error) throw new Error(error.message);
  const rows = (data || []) as PipelineRow[];
  const total = rows.length;
  const byStatus: Record<string, number> = {};
  let nonUuid = 0;
  let withDocs = 0;
  let terminal = 0;
  for (const r of rows) {
    const s = r.docs_status || 'unset';
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (!isUuid(r.notice_id)) nonUuid++;
    if ((r.docs_count || 0) > 0) withDocs++;
    if (s === 'ready' || s === 'none') terminal++;
  }
  const stuck = total - terminal; // fetching/pending/failed/unset
  return {
    totalPursuits: total,
    terminalResolved: terminal,
    resolvedPct: total ? Math.round((terminal / total) * 1000) / 10 : 100,
    withDocs,
    withDocsPct: total ? Math.round((withDocs / total) * 1000) / 10 : 0,
    stuckOrUnresolved: stuck,
    solicitationNumberAsId: nonUuid,
    byStatus,
  };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ?stats=true → attachment coverage gauge (no candidate scan)
  if (url.searchParams.get('stats') === 'true') {
    try {
      return NextResponse.json({ success: true, coverage: await attachmentCoverage() });
    } catch (e) {
      return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  try {
    const candidates = await loadCandidates({
      email: url.searchParams.get('email'),
      pipelineId: url.searchParams.get('pipeline_id'),
    });
    const nonUuid = candidates.filter((c) => !isUuid(c.notice_id)).length;
    return NextResponse.json({
      success: true,
      mode: 'preview',
      candidates: candidates.length,
      breakdown: {
        solicitation_number_as_id: nonUuid,
        stuck_or_empty_uuid: candidates.length - nonUuid,
      },
      sample: candidates.slice(0, 10).map((c) => ({
        id: c.id, notice_id: c.notice_id, title: c.title, docs_status: c.docs_status,
      })),
      hint: 'POST ?password=...&mode=execute&limit=50 to heal',
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (url.searchParams.get('mode') !== 'execute') {
    return NextResponse.json({ success: false, error: 'Pass mode=execute to run the heal' }, { status: 400 });
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);

  try {
    const candidates = await loadCandidates({
      email: url.searchParams.get('email'),
      pipelineId: url.searchParams.get('pipeline_id'),
    });
    const batch = candidates.slice(0, limit);

    const results: Array<{ id: string; title: string | null; before: string | null; status: string; docs: number }> = [];
    let healed = 0;
    let withDocs = 0;

    for (const row of batch) {
      if (!row.notice_id || !row.user_email) continue;
      try {
        const r = await fetchPursuitDocs({
          pipelineId: row.id,
          userEmail: row.user_email,
          noticeId: row.notice_id,
        });
        if (r.status === 'ready') { healed++; withDocs++; }
        else if (r.status === 'none') healed++; // confirmed: genuinely no attachments
        results.push({ id: row.id, title: row.title, before: row.docs_status, status: r.status, docs: r.succeeded });
      } catch (err) {
        results.push({ id: row.id, title: row.title, before: row.docs_status, status: 'error', docs: 0 });
        console.warn(`[heal-pursuit-attachments] ${row.id} threw:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      mode: 'execute',
      totalCandidates: candidates.length,
      processed: batch.length,
      remaining: Math.max(0, candidates.length - batch.length),
      healed,
      withDocs,
      results,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

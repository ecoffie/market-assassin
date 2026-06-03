/**
 * /api/app/proposal/pursuit-docs
 *
 * GET ?email=&pipeline_id=  → list cached docs for a pursuit
 *
 * Consumed by ProposalsPanel when the user opens it from a pursuit
 * (URL ?pursuit_id=X). Returns the rows from pursuit_documents so
 * Proposal Assist can pre-populate the upload state without making
 * the user re-fetch + re-parse the same RFP they already saved.
 *
 * Auth: pipeline_id must belong to the email (RLS-equivalent check
 * in the service-role query). No row leakage across users.
 *
 * Built 2026-05-25 as part of Pursuit Document Pipeline v1.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { fetchPursuitDocsAuto } from '@/lib/grants/fetch-grant-docs';
import { ensureWorkspaceMember } from '@/lib/app/workspace';
import { isValidSamNoticeId } from '@/lib/sam/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;  // POST re-runs the SAM doc fetch (slow on a cold notice)

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

// A pursuit belongs to the caller if their email matches OR it lives in their
// workspace. The pipeline LIST endpoint scopes the same way, so a workspace
// pursuit shows up in the picker — matching only on user_email here 403'd those
// rows ("not your pursuit") even though the user could see them.
async function ownsPursuit(
  row: { user_email?: string | null; workspace_id?: string | null },
  email: string
): Promise<boolean> {
  if (row.user_email?.toLowerCase() === email.toLowerCase()) return true;
  if (row.workspace_id) {
    try {
      const { workspaceId } = await ensureWorkspaceMember(email.toLowerCase());
      if (workspaceId && row.workspace_id === workspaceId) return true;
    } catch {
      // Workspace lookup unavailable — deny.
    }
  }
  return false;
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  const pipelineId = request.nextUrl.searchParams.get('pipeline_id');

  if (!email || !pipelineId) {
    return NextResponse.json(
      { success: false, error: 'email and pipeline_id are required' },
      { status: 400 }
    );
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const supabase = getSupabase();

  // Verify pipeline belongs to email (cheap query, also returns
  // pursuit context for the UI in one round-trip).
  const { data: pipelineRow, error: pipelineErr } = await supabase
    .from('user_pipeline')
    .select('id, user_email, workspace_id, title, agency, notice_id, naics_code, set_aside, response_deadline, docs_status, docs_count, docs_fetched_at, updated_at')
    .eq('id', pipelineId)
    .single();

  if (pipelineErr || !pipelineRow) {
    return NextResponse.json(
      { success: false, error: 'pursuit not found' },
      { status: 404 }
    );
  }
  if (!(await ownsPursuit(pipelineRow, email))) {
    return NextResponse.json(
      { success: false, error: 'not your pursuit' },
      { status: 403 }
    );
  }

  // Self-heal a STUCK fetch. The background fetcher (after()) sets
  // docs_status='fetching' before the slow SAM download/extract. If that
  // serverless invocation was killed mid-flight (Vercel timeout on a big
  // RFP), the row is wedged at 'fetching' forever and the drawer spins
  // endlessly. updated_at is bumped by a trigger whenever the row changes,
  // so 'fetching' + a stale updated_at means the worker is dead. Flip it to
  // 'failed' so the UI shows the Retry affordance instead of an infinite
  // spinner. The user (or the poll) can then re-run the fetch.
  const STALE_FETCH_MS = 3 * 60 * 1000; // 3 min — far longer than a real fetch
  const stuckStatus = pipelineRow.docs_status; // 'fetching' | 'pending' | ...
  if (stuckStatus === 'fetching' || stuckStatus === 'pending') {
    const updatedAt = pipelineRow.updated_at ? new Date(pipelineRow.updated_at).getTime() : 0;
    if (updatedAt && Date.now() - updatedAt > STALE_FETCH_MS) {
      pipelineRow.docs_status = 'failed';
      // Best-effort, conditional on the row still being stuck (so we don't
      // clobber a fetch that just succeeded between read and write). Never
      // block the read on this.
      await supabase
        .from('user_pipeline')
        .update({ docs_status: 'failed' })
        .eq('id', pipelineId)
        .eq('docs_status', stuckStatus)
        .then(() => {}, () => {});
    }
  }

  // Backfill a missing response_deadline from the SAM cache. The save-time
  // backfill (pipeline POST) only runs at creation and only for valid notice
  // IDs; pursuits saved before that, or whose feed lacked a deadline, show
  // "No deadline" even though SAM has the date. Opening the drawer now fixes
  // it. Best-effort — never block the read.
  if (!pipelineRow.response_deadline && isValidSamNoticeId(pipelineRow.notice_id)) {
    try {
      const { data: samRow } = await supabase
        .from('sam_opportunities')
        .select('response_deadline')
        .eq('notice_id', pipelineRow.notice_id)
        .maybeSingle();
      if (samRow?.response_deadline) {
        const d = new Date(samRow.response_deadline);
        if (!Number.isNaN(d.getTime())) {
          pipelineRow.response_deadline = d.toISOString();
          await supabase
            .from('user_pipeline')
            .update({ response_deadline: pipelineRow.response_deadline })
            .eq('id', pipelineId)
            .then(() => {}, () => {});
        }
      }
    } catch { /* non-fatal — drawer just shows "No deadline" as before */ }
  }

  // Pull the cached docs. Order by downloaded_at so the user sees the
  // RFP / SOW (typically the first / largest) before amendments.
  const { data: docs, error: docsErr } = await supabase
    .from('pursuit_documents')
    .select('id, sam_file_id, sam_url, filename, mime_type, size_bytes, page_count, char_count, extracted_text, downloaded_at, extraction_error')
    .eq('pipeline_id', pipelineId)
    .order('size_bytes', { ascending: false });

  if (docsErr) {
    console.warn('[pursuit-docs] docs query failed:', docsErr);
    return NextResponse.json(
      { success: false, error: docsErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    pursuit: {
      id: pipelineRow.id,
      title: pipelineRow.title,
      agency: pipelineRow.agency,
      notice_id: pipelineRow.notice_id,
      naics_code: pipelineRow.naics_code,
      set_aside: pipelineRow.set_aside,
      response_deadline: pipelineRow.response_deadline,
      docs_status: pipelineRow.docs_status,
      docs_count: pipelineRow.docs_count,
      docs_fetched_at: pipelineRow.docs_fetched_at,
    },
    documents: docs || [],
  });
}

/**
 * POST ?email=&pipeline_id=  → re-run the SAM doc fetch for this pursuit.
 *
 * User-facing recovery for pursuits stuck at docs_status='fetching' (the
 * one-time cold fetch can be orphaned by a serverless timeout, leaving
 * the row spinning forever). The drawer's "Retry" link calls this. The
 * fetch is now dedup-backed, so it usually resolves from cache instantly.
 * Pro-gated via the same MI auth + ownership check as GET.
 */
export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  const pipelineId = request.nextUrl.searchParams.get('pipeline_id');

  if (!email || !pipelineId) {
    return NextResponse.json(
      { success: false, error: 'email and pipeline_id are required' },
      { status: 400 }
    );
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const supabase = getSupabase();

  const { data: pipelineRow, error: pipelineErr } = await supabase
    .from('user_pipeline')
    .select('id, user_email, workspace_id, notice_id, title, source, agency')
    .eq('id', pipelineId)
    .single();

  if (pipelineErr || !pipelineRow) {
    return NextResponse.json({ success: false, error: 'pursuit not found' }, { status: 404 });
  }
  if (!(await ownsPursuit(pipelineRow, email))) {
    return NextResponse.json({ success: false, error: 'not your pursuit' }, { status: 403 });
  }
  if (!pipelineRow.notice_id) {
    return NextResponse.json(
      { success: false, error: 'This pursuit has no SAM notice ID, so there are no attachments to fetch. Upload an RFP manually instead.' },
      { status: 400 }
    );
  }

  try {
    const result = await fetchPursuitDocsAuto({
      pipelineId: pipelineRow.id,
      userEmail: email,
      noticeId: pipelineRow.notice_id,
      source: pipelineRow.source,
      title: pipelineRow.title,
      agency: pipelineRow.agency,
    });
    return NextResponse.json({
      success: true,
      fetch: result,                 // { attempted, succeeded, failed, status }
      docs_status: result.status,    // the new terminal status
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Don't leave the row stuck at 'fetching' if THIS run also fails —
    // mark it failed so the UI shows a retry instead of a spinner.
    await supabase.from('user_pipeline')
      .update({ docs_status: 'failed', docs_fetched_at: new Date().toISOString() })
      .eq('id', pipelineRow.id);
    return NextResponse.json({ success: false, error: `Doc fetch failed: ${message}` }, { status: 502 });
  }
}

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
import { fetchPursuitDocs } from '@/lib/sam/fetch-pursuit-docs';
import { ensureWorkspaceMember } from '@/lib/app/workspace';

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
    .select('id, user_email, workspace_id, title, agency, notice_id, naics_code, set_aside, response_deadline, docs_status, docs_count, docs_fetched_at')
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
    .select('id, user_email, workspace_id, notice_id, title')
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
    const result = await fetchPursuitDocs({
      pipelineId: pipelineRow.id,
      userEmail: email,
      noticeId: pipelineRow.notice_id,
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

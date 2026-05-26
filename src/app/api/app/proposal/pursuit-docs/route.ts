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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    .select('id, user_email, title, agency, notice_id, naics_code, set_aside, response_deadline, docs_status, docs_count, docs_fetched_at')
    .eq('id', pipelineId)
    .single();

  if (pipelineErr || !pipelineRow) {
    return NextResponse.json(
      { success: false, error: 'pursuit not found' },
      { status: 404 }
    );
  }
  if (pipelineRow.user_email !== email) {
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

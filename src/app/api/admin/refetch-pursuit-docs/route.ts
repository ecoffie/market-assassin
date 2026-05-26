/**
 * /api/admin/refetch-pursuit-docs
 *
 * Manually trigger the SAM doc-fetch pipeline for a specific pursuit.
 * Used for diagnosis when auto-fetch didn't fire (e.g., pursuit saved
 * before the auto-fetch hook shipped) and as a 'rehydrate' tool.
 *
 * Synchronous — returns the actual fetch result so callers can see
 * what happened instead of guessing from logs.
 *
 * GET / POST  ?password=galata-assassin-2026&pipeline_id=<uuid>
 *   [&email=user@example.com]  — optional; auto-detected from pipeline row if omitted
 *
 * Returns:
 *   {
 *     success: true,
 *     pipeline_id, user_email, notice_id, title,
 *     fetch: { attempted, succeeded, failed, status },
 *     docs: [ { sam_file_id, filename, char_count, extraction_error } ]
 *   }
 *
 * Built 2026-05-25 to diagnose why 'Z--DK - SHADEHILL GATEHOUSE
 * ROOFING' didn't auto-load on Draft Proposal click.
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

async function handle(request: NextRequest) {
  const url = new URL(request.url);
  const password = url.searchParams.get('password');
  const pipelineId = url.searchParams.get('pipeline_id');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!pipelineId) {
    return NextResponse.json({ error: 'pipeline_id is required' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Look up the pursuit to get user_email + notice_id
  const { data: pipelineRow, error: lookupErr } = await supabase
    .from('user_pipeline')
    .select('id, user_email, notice_id, title, docs_status, docs_count, docs_fetched_at')
    .eq('id', pipelineId)
    .single();

  if (lookupErr || !pipelineRow) {
    return NextResponse.json(
      { error: 'Pursuit not found', lookupErr },
      { status: 404 }
    );
  }
  if (!pipelineRow.notice_id) {
    return NextResponse.json(
      {
        error: 'Pursuit has no notice_id — nothing to fetch from SAM',
        pursuit: pipelineRow,
      },
      { status: 400 }
    );
  }

  // Run the fetch synchronously so we can return the result
  const fetchResult = await fetchPursuitDocs({
    pipelineId: pipelineRow.id,
    userEmail: pipelineRow.user_email,
    noticeId: pipelineRow.notice_id,
  });

  // Pull the resulting cached docs for the response
  const { data: docs } = await supabase
    .from('pursuit_documents')
    .select('id, sam_file_id, filename, mime_type, size_bytes, page_count, char_count, extracted_text, extraction_error, downloaded_at')
    .eq('pipeline_id', pipelineId)
    .order('size_bytes', { ascending: false });

  return NextResponse.json({
    success: true,
    pursuit: {
      id: pipelineRow.id,
      user_email: pipelineRow.user_email,
      notice_id: pipelineRow.notice_id,
      title: pipelineRow.title,
      docs_status_before: pipelineRow.docs_status,
      docs_count_before: pipelineRow.docs_count,
      docs_fetched_at_before: pipelineRow.docs_fetched_at,
    },
    fetch: fetchResult,
    documents: (docs || []).map((d: { id: string; sam_file_id: string; filename: string; mime_type: string; size_bytes: number; page_count: number; char_count: number; extracted_text: string | null; extraction_error: string | null }) => ({
      id: d.id,
      sam_file_id: d.sam_file_id,
      filename: d.filename,
      mime_type: d.mime_type,
      size_bytes: d.size_bytes,
      page_count: d.page_count,
      char_count: d.char_count,
      extracted_text_preview: d.extracted_text ? d.extracted_text.slice(0, 200) + '…' : null,
      extraction_error: d.extraction_error,
    })),
  });
}

export const GET = handle;
export const POST = handle;

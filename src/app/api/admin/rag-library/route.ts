/**
 * RAG Library admin API.
 *
 * Three operations behind one endpoint, switched by `op` query param:
 *
 *   ?op=stats        — Doc + chunk counts grouped by doc_type
 *   ?op=search&q=... — Run a live retrieval query (calls the same RPC
 *                      Proposal Assist uses), returns top chunks with
 *                      rank + source attribution
 *   ?op=docs&type=X  — List indexed documents, optional doc_type filter
 *
 * Built 2026-05-26 for the /admin/rag-library page so Eric can spot-
 * check what Mindy will surface for any query before users do.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== (process.env.ADMIN_PASSWORD || 'galata-assassin-2026')) {
    return unauthorized();
  }

  const op = request.nextUrl.searchParams.get('op') || 'stats';
  const supabase = getSupabase();

  // ---- op=stats — counts by doc_type --------------------------------
  if (op === 'stats') {
    // Pull whole table (lightweight) and aggregate. Faster than 12
    // separate count queries.
    const { data: docs, error: docsErr } = await supabase
      .from('mindy_rag_documents')
      .select('doc_type, ingestion_status, text_length, top_level_folder');

    if (docsErr) {
      return NextResponse.json({ success: false, error: docsErr.message }, { status: 500 });
    }

    const { count: chunkCount } = await supabase
      .from('mindy_rag_chunks')
      .select('id', { count: 'exact', head: true });

    const byType: Record<string, { docs: number; chars: number }> = {};
    const byFolder: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    (docs || []).forEach((d: { doc_type: string | null; ingestion_status: string; text_length: number | null; top_level_folder: string | null }) => {
      const t = d.doc_type || 'misc';
      if (!byType[t]) byType[t] = { docs: 0, chars: 0 };
      byType[t].docs++;
      byType[t].chars += d.text_length || 0;

      const f = d.top_level_folder || '(root)';
      byFolder[f] = (byFolder[f] || 0) + 1;

      byStatus[d.ingestion_status] = (byStatus[d.ingestion_status] || 0) + 1;
    });

    return NextResponse.json({
      success: true,
      totals: {
        documents: docs?.length || 0,
        chunks: chunkCount || 0,
        characters: Object.values(byType).reduce((acc, v) => acc + v.chars, 0),
      },
      byType: Object.entries(byType)
        .map(([type, v]) => ({ type, docs: v.docs, chars: v.chars }))
        .sort((a, b) => b.docs - a.docs),
      byFolder: Object.entries(byFolder)
        .map(([folder, docs]) => ({ folder, docs }))
        .sort((a, b) => b.docs - a.docs),
      byStatus,
    });
  }

  // ---- op=search — live retrieval ------------------------------------
  if (op === 'search') {
    const q = request.nextUrl.searchParams.get('q')?.trim() || '';
    const docType = request.nextUrl.searchParams.get('type') || '';
    if (!q) {
      return NextResponse.json({ success: false, error: 'q required' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('get_rag_chunks', {
      q,
      doc_types_filter: docType ? [docType] : null,
      limit_n: 12,
    });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      query: q,
      docTypeFilter: docType || null,
      results: (data || []).map((r: { document_id: string; chunk_index: number; chunk_text: string; doc_title: string; doc_type: string; doc_top_level_folder: string; source_path: string; rank: number }) => ({
        document_id: r.document_id,
        chunk_index: r.chunk_index,
        chunk_text: r.chunk_text,
        chunk_preview: (r.chunk_text || '').slice(0, 300),
        doc_title: r.doc_title,
        doc_type: r.doc_type,
        doc_top_level_folder: r.doc_top_level_folder,
        source_path: r.source_path,
        rank: r.rank,
      })),
    });
  }

  // ---- op=docs — list documents (paginated) --------------------------
  if (op === 'docs') {
    const docType = request.nextUrl.searchParams.get('type') || '';
    const page = parseInt(request.nextUrl.searchParams.get('page') || '0', 10);
    const pageSize = 50;
    let q = supabase
      .from('mindy_rag_documents')
      .select('id, filename, file_extension, doc_type, top_level_folder, title, text_length, word_count, page_count, ingestion_status, ingestion_error, created_at', { count: 'exact' })
      .order('text_length', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (docType) q = q.eq('doc_type', docType);

    const { data, error, count } = await q;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total: count || 0,
      docs: data || [],
    });
  }

  return NextResponse.json({ success: false, error: 'unknown op' }, { status: 400 });
}

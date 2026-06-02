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
import { classifyRagDocCandidate, FORMAT_DOC_TYPES } from '@/lib/rag/doc-classifier';
import { buildLooseRagSearchQuery } from '@/lib/rag/query';

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

interface RagDocRow {
  id?: string;
  source_path?: string | null;
  filename?: string | null;
  file_extension?: string | null;
  doc_type: string | null;
  ingestion_status: string;
  text_length: number | null;
  word_count?: number | null;
  top_level_folder: string | null;
  title?: string | null;
  usage_rights?: string | null;
  has_pii?: boolean | null;
}

interface RagChunkRow {
  doc_type: string | null;
}

interface ReclassCandidate {
  id?: string;
  filename: string | null;
  title: string | null;
  currentDocType: string | null;
  suggestedDocType: string;
  confidence: string;
  reason: string;
  textLength: number | null;
}

async function fetchAllRows<T>(queryFactory: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

function findReclassCandidates(docs: RagDocRow[], typeFilter = ''): ReclassCandidate[] {
  const candidates: ReclassCandidate[] = [];

  docs.forEach((d) => {
    const suggestion = classifyRagDocCandidate({
      filename: d.filename,
      title: d.title,
      sourcePath: d.source_path,
      currentDocType: d.doc_type,
    });
    if (!suggestion || suggestion.suggestedDocType === d.doc_type) return;
    if (typeFilter && suggestion.suggestedDocType !== typeFilter) return;

    candidates.push({
      id: d.id,
      filename: d.filename || null,
      title: d.title || null,
      currentDocType: d.doc_type,
      suggestedDocType: suggestion.suggestedDocType,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      textLength: d.text_length,
    });
  });

  return candidates;
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
    let docs: RagDocRow[];
    let chunks: RagChunkRow[];
    try {
      docs = await fetchAllRows<RagDocRow>((from, to) =>
        supabase
          .from('mindy_rag_documents')
          .select('id, source_path, filename, file_extension, doc_type, ingestion_status, text_length, word_count, top_level_folder, title, usage_rights, has_pii')
          .range(from, to)
      );
      chunks = await fetchAllRows<RagChunkRow>((from, to) =>
        supabase
          .from('mindy_rag_chunks')
          .select('doc_type')
          .range(from, to)
      );
    } catch (err) {
      return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Could not fetch RAG stats' }, { status: 500 });
    }

    const { count: chunkCount } = await supabase
      .from('mindy_rag_chunks')
      .select('id', { count: 'exact', head: true });

    const byType: Record<string, { docs: number; chars: number }> = {};
    const byChunkType: Record<string, number> = {};
    const byFolder: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byUsageRights: Record<string, number> = {};
    const byExtension: Record<string, number> = {};
    const reclassCandidates = findReclassCandidates(docs);

    docs.forEach((d) => {
      const t = d.doc_type || 'misc';
      if (!byType[t]) byType[t] = { docs: 0, chars: 0 };
      byType[t].docs++;
      byType[t].chars += d.text_length || 0;

      const f = d.top_level_folder || '(root)';
      byFolder[f] = (byFolder[f] || 0) + 1;

      byStatus[d.ingestion_status] = (byStatus[d.ingestion_status] || 0) + 1;
      byUsageRights[d.usage_rights || '(blank)'] = (byUsageRights[d.usage_rights || '(blank)'] || 0) + 1;
      byExtension[d.file_extension || '(blank)'] = (byExtension[d.file_extension || '(blank)'] || 0) + 1;

    });

    chunks.forEach((chunk) => {
      const t = chunk.doc_type || 'misc';
      byChunkType[t] = (byChunkType[t] || 0) + 1;
    });

    return NextResponse.json({
      success: true,
      totals: {
        documents: docs.length,
        chunks: chunkCount || chunks.length,
        characters: Object.values(byType).reduce((acc, v) => acc + v.chars, 0),
        piiFlagged: docs.filter((d) => d.has_pii).length,
        reclassCandidates: reclassCandidates.length,
      },
      byType: Object.entries(byType)
        .map(([type, v]) => ({ type, docs: v.docs, chars: v.chars }))
        .sort((a, b) => b.docs - a.docs),
      byChunkType: Object.entries(byChunkType)
        .map(([type, chunks]) => ({ type, chunks }))
        .sort((a, b) => b.chunks - a.chunks),
      formatCoverage: FORMAT_DOC_TYPES.map((type) => ({
        type,
        docs: byType[type]?.docs || 0,
        chunks: byChunkType[type] || 0,
      })),
      byFolder: Object.entries(byFolder)
        .map(([folder, docs]) => ({ folder, docs }))
        .sort((a, b) => b.docs - a.docs),
      byStatus,
      byUsageRights,
      byExtension,
      reclassCandidates: reclassCandidates.slice(0, 50),
    });
  }

  // ---- op=search — live retrieval ------------------------------------
  if (op === 'search') {
    const q = request.nextUrl.searchParams.get('q')?.trim() || '';
    const docType = request.nextUrl.searchParams.get('type') || '';
    if (!q) {
      return NextResponse.json({ success: false, error: 'q required' }, { status: 400 });
    }

    const runSearch = (searchQuery: string) => supabase.rpc('get_rag_chunks', {
      q: searchQuery,
      doc_types_filter: docType ? [docType] : null,
      limit_n: 12,
    });

    let retrievalMode: 'strict' | 'loose' = 'strict';
    let fallbackQuery: string | null = null;
    let { data, error } = await runSearch(q);

    if (!error && (!data || data.length === 0)) {
      const looseQuery = buildLooseRagSearchQuery(q);
      if (looseQuery && looseQuery !== q) {
        fallbackQuery = looseQuery;
        const fallback = await runSearch(looseQuery);
        data = fallback.data;
        error = fallback.error;
        retrievalMode = 'loose';
      }
    }

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      q,
      query: q,
      retrievalMode,
      fallbackQuery,
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

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== (process.env.ADMIN_PASSWORD || 'galata-assassin-2026')) {
    return unauthorized();
  }

  let body: {
    action?: string;
    dryRun?: boolean;
    confirm?: string;
    limit?: number;
    type?: string;
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const action = body.action || 'repair-doc-types';
  if (action !== 'repair-doc-types') {
    return NextResponse.json({ success: false, error: 'unknown action' }, { status: 400 });
  }

  const dryRun = body.dryRun !== false;
  if (!dryRun && body.confirm !== 'repair-rag-doc-types') {
    return NextResponse.json({
      success: false,
      error: 'confirm must be "repair-rag-doc-types" when dryRun is false',
    }, { status: 400 });
  }

  const limit = Number.isFinite(body.limit) && body.limit && body.limit > 0
    ? Math.min(Math.floor(body.limit), 500)
    : Infinity;
  const typeFilter = typeof body.type === 'string' ? body.type : '';
  const supabase = getSupabase();

  let docs: RagDocRow[];
  try {
    docs = await fetchAllRows<RagDocRow>((from, to) =>
      supabase
        .from('mindy_rag_documents')
        .select('id, source_path, filename, file_extension, doc_type, ingestion_status, text_length, word_count, top_level_folder, title, usage_rights, has_pii')
        .range(from, to)
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Could not fetch RAG docs' }, { status: 500 });
  }

  const candidates = findReclassCandidates(docs, typeFilter).slice(0, limit);
  const bySuggestedType = candidates.reduce<Record<string, number>>((acc, candidate) => {
    acc[candidate.suggestedDocType] = (acc[candidate.suggestedDocType] || 0) + 1;
    return acc;
  }, {});

  if (dryRun) {
    return NextResponse.json({
      success: true,
      dryRun: true,
      scanned: docs.length,
      candidates: candidates.length,
      bySuggestedType,
      sample: candidates.slice(0, 50),
    });
  }

  const results: Array<{
    id?: string;
    title: string | null;
    from: string | null;
    to: string;
    documentUpdated: boolean;
    chunksUpdated: number;
    error?: string;
  }> = [];

  for (const candidate of candidates) {
    if (!candidate.id) continue;
    const { error: docError } = await supabase
      .from('mindy_rag_documents')
      .update({ doc_type: candidate.suggestedDocType, updated_at: new Date().toISOString() })
      .eq('id', candidate.id);

    if (docError) {
      results.push({
        id: candidate.id,
        title: candidate.title,
        from: candidate.currentDocType,
        to: candidate.suggestedDocType,
        documentUpdated: false,
        chunksUpdated: 0,
        error: docError.message,
      });
      continue;
    }

    const { count, error: chunkError } = await supabase
      .from('mindy_rag_chunks')
      .update({ doc_type: candidate.suggestedDocType }, { count: 'exact' })
      .eq('document_id', candidate.id);

    results.push({
      id: candidate.id,
      title: candidate.title,
      from: candidate.currentDocType,
      to: candidate.suggestedDocType,
      documentUpdated: true,
      chunksUpdated: count || 0,
      error: chunkError?.message,
    });
  }

  return NextResponse.json({
    success: true,
    dryRun: false,
    scanned: docs.length,
    attempted: candidates.length,
    updatedDocuments: results.filter((result) => result.documentUpdated).length,
    updatedChunks: results.reduce((sum, result) => sum + result.chunksUpdated, 0),
    bySuggestedType,
    results,
  });
}

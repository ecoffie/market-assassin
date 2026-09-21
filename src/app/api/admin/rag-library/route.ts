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
import crypto from 'crypto';
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

interface AdminIngestDoc {
  sourcePath?: string;
  filename?: string;
  fileExtension?: string;
  sizeBytes?: number;
  fileMtime?: string;
  fileSha256?: string;
  docType?: string;
  topLevelFolder?: string | null;
  folderPath?: string | null;
  title?: string | null;
  fullText?: string;
  pageCount?: number | null;
  wordCount?: number;
  topicTags?: string[];
  usageRights?: string;
}

const ADMIN_INGEST_DOC_TYPES = new Set([
  'sources_sought_loi',
  'rfi_response',
  'rfq_response',
  'technical_volume',
  'management_volume',
  'pricing_volume',
  'cap_statement',
  'past_performance',
  'proposal_template',
  'course_material',
  'teaching_handout',
  'webinar_resource',
  'coaching_call',
  'sales_call',
  'misc',
]);

const WORDS_PER_CHUNK = 500;
const OVERLAP_WORDS = 50;

function chunkText(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ');
  if (words.length <= WORDS_PER_CHUNK) return [cleaned];

  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(' '));
    if (i + WORDS_PER_CHUNK >= words.length) break;
    i += WORDS_PER_CHUNK - OVERLAP_WORDS;
  }
  return chunks;
}

function safeDocType(docType: string | undefined): string {
  if (docType && ADMIN_INGEST_DOC_TYPES.has(docType)) return docType;
  return 'misc';
}

function safeSha(doc: AdminIngestDoc): string {
  if (doc.fileSha256 && /^[a-f0-9]{64}$/i.test(doc.fileSha256)) return doc.fileSha256.toLowerCase();
  return crypto.createHash('sha256').update(doc.fullText || '').digest('hex');
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
    if ((d.text_length || 0) < 200) return;
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
  if (password !== (process.env.ADMIN_PASSWORD)) {
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
  if (password !== (process.env.ADMIN_PASSWORD)) {
    return unauthorized();
  }

  let body: {
    action?: string;
    dryRun?: boolean;
    confirm?: string;
    limit?: number;
    type?: string;
    dedupeByHash?: boolean;
    docs?: AdminIngestDoc[];
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const action = body.action || 'repair-doc-types';
  if (!['repair-doc-types', 'upsert-rag-docs'].includes(action)) {
    return NextResponse.json({ success: false, error: 'unknown action' }, { status: 400 });
  }

  if (action === 'upsert-rag-docs') {
    const dryRun = body.dryRun !== false;
    if (!dryRun && body.confirm !== 'upsert-rag-docs') {
      return NextResponse.json({
        success: false,
        error: 'confirm must be "upsert-rag-docs" when dryRun is false',
      }, { status: 400 });
    }

    const docs = Array.isArray(body.docs) ? body.docs.slice(0, 25) : [];
    const dedupeByHash = body.dedupeByHash !== false;
    if (docs.length === 0) {
      return NextResponse.json({ success: false, error: 'docs[] required' }, { status: 400 });
    }

    const normalized = docs.map((doc) => {
      const fullText = (doc.fullText || '').slice(0, 1_500_000);
      const filename = doc.filename || doc.sourcePath?.split('/').pop() || 'untitled';
      const fileExtension = (doc.fileExtension || filename.split('.').pop() || 'txt').toLowerCase();
      const docType = safeDocType(doc.docType);
      const wordCount = Number.isFinite(doc.wordCount) ? Math.floor(doc.wordCount || 0) : fullText.split(/\s+/).filter(Boolean).length;
      return {
        ...doc,
        fullText,
        filename,
        fileExtension,
        docType,
        wordCount,
        fileSha256: safeSha({ ...doc, fullText }),
        sourcePath: doc.sourcePath || `admin-upload:${filename}:${Date.now()}`,
        title: doc.title || filename.replace(/\.[^.]+$/, '').slice(0, 200),
        topicTags: Array.isArray(doc.topicTags) ? doc.topicTags.slice(0, 20) : [],
      };
    });

    const byDocType = normalized.reduce<Record<string, number>>((acc, doc) => {
      acc[doc.docType] = (acc[doc.docType] || 0) + 1;
      return acc;
    }, {});

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        received: normalized.length,
        byDocType,
        sample: normalized.slice(0, 10).map((doc) => ({
          filename: doc.filename,
          docType: doc.docType,
          textLength: doc.fullText.length,
          chunks: chunkText(doc.fullText).length,
          sourcePath: doc.sourcePath,
        })),
      });
    }

    const supabase = getSupabase();
    const results: Array<{
      sourcePath: string;
      filename: string;
      docType: string;
      status: 'inserted_or_updated' | 'deduped_updated' | 'skipped' | 'failed';
      documentId?: string;
      chunksInserted: number;
      error?: string;
    }> = [];

    for (const doc of normalized) {
      try {
        const chunks = chunkText(doc.fullText);
        if (chunks.length === 0) {
          results.push({
            sourcePath: doc.sourcePath,
            filename: doc.filename,
            docType: doc.docType,
            status: 'skipped',
            chunksInserted: 0,
            error: 'empty extracted text',
          });
          continue;
        }

        let existingByHash: { id: string; source_path: string | null } | null = null;
        if (dedupeByHash && doc.fileSha256) {
          const { data: existing } = await supabase
            .from('mindy_rag_documents')
            .select('id, source_path')
            .eq('file_sha256', doc.fileSha256)
            .limit(1)
            .maybeSingle();
          existingByHash = existing || null;
        }

        const row = {
          source_path: existingByHash?.source_path || doc.sourcePath,
          filename: doc.filename,
          file_extension: doc.fileExtension,
          size_bytes: doc.sizeBytes || null,
          file_mtime: doc.fileMtime || null,
          file_sha256: doc.fileSha256,
          doc_type: doc.docType,
          top_level_folder: doc.topLevelFolder || 'proposal-template-corpus',
          folder_path: doc.folderPath || null,
          title: doc.title,
          full_text: doc.fullText,
          text_length: doc.fullText.length,
          page_count: doc.pageCount || null,
          word_count: doc.wordCount,
          topic_tags: doc.topicTags,
          has_pii: false,
          usage_rights: doc.usageRights || 'eric_owned',
          ingestion_status: 'extracted',
          ingestion_error: null,
          ingested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        let documentId = existingByHash?.id;
        if (documentId) {
          const { error: updateError } = await supabase
            .from('mindy_rag_documents')
            .update(row)
            .eq('id', documentId);
          if (updateError) throw updateError;
        } else {
          const { data: upserted, error: upsertError } = await supabase
            .from('mindy_rag_documents')
            .upsert(row, { onConflict: 'source_path' })
            .select('id')
            .single();
          if (upsertError) throw upsertError;
          documentId = upserted.id;
        }

        await supabase.from('mindy_rag_chunks').delete().eq('document_id', documentId);

        const chunkRows = chunks.map((chunk, index) => ({
          document_id: documentId,
          chunk_index: index,
          chunk_text: chunk,
          doc_type: doc.docType,
          doc_title: doc.title,
          doc_top_level_folder: row.top_level_folder,
          source_path: row.source_path,
          word_count: chunk.split(/\s+/).filter(Boolean).length,
          char_count: chunk.length,
        }));

        for (let i = 0; i < chunkRows.length; i += 100) {
          const { error: chunkError } = await supabase
            .from('mindy_rag_chunks')
            .insert(chunkRows.slice(i, i + 100));
          if (chunkError) throw chunkError;
        }

        results.push({
          sourcePath: doc.sourcePath,
          filename: doc.filename,
          docType: doc.docType,
          status: existingByHash ? 'deduped_updated' : 'inserted_or_updated',
          documentId,
          chunksInserted: chunkRows.length,
        });
      } catch (err) {
        results.push({
          sourcePath: doc.sourcePath,
          filename: doc.filename,
          docType: doc.docType,
          status: 'failed',
          chunksInserted: 0,
          error: err instanceof Error ? err.message : 'unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      dryRun: false,
      received: normalized.length,
      byDocType,
      updatedDocuments: results.filter((result) => ['inserted_or_updated', 'deduped_updated'].includes(result.status)).length,
      insertedChunks: results.reduce((sum, result) => sum + result.chunksInserted, 0),
      failed: results.filter((result) => result.status === 'failed').length,
      results,
    });
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

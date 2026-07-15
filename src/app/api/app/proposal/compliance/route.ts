import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';
import { normalizeCategory } from '@/lib/proposal/section-alignment';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import {
  type ComplianceRequirement,
  GROQ_MODEL,
  MAX_INPUT_CHARS,
  mapPool,
  chunkText,
  extractChunk,
  extractComplianceMatrixFromText,
} from '@/lib/proposal/compliance-matrix';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Large packages (13+ docs) ran the chunk extraction serially and blew past the
// default function limit — Eric saw it fail at 88s, then ~200s (Jun 26). Give it
// headroom AND parallelize the chunks below so it finishes in ~30-40s.
export const maxDuration = 300;

interface RequestBody {
  text?: string;
  fileName?: string;
  pipeline_id?: string; // multi-doc mode: extract from base + amendments + Q&A
}

/**
 * Multi-doc extraction with AMENDMENT PRECEDENCE (Eric QC). Pull the pursuit's
 * classified docs (base solicitation + Q&A + amendments in order), extract
 * requirements from each, then merge: a later amendment that revises a base
 * requirement WINS and is flagged `revised`. Returns the current, accurate set.
 * (Stays in the route — it needs a logged-in user's private pursuit_documents; the
 * shared single-doc engine lives in src/lib/proposal/compliance-matrix.ts.)
 */
async function extractMultiDoc(pipelineId: string): Promise<{ requirements: ComplianceRequirement[]; sources: string[]; cached?: boolean } | null> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: docs, error: docsErr } = await supabase
    .from('pursuit_documents')
    .select('filename, doc_kind, extracted_text, downloaded_at, notice_id, doc_source')
    .eq('pipeline_id', pipelineId)
    .in('doc_kind', ['solicitation', 'qa', 'amendment', 'instructions', 'eval_factors', 'sow_pws'])
    .not('extracted_text', 'is', null);
  if (docsErr) console.error('[compliance] docs query error:', docsErr.message);
  if (!docs || docs.length === 0) return null;

  // SHARED CACHE (Eric: scaling — the matrix for a PUBLIC SAM notice is identical
  // for every user bidding it; extract once, serve all). Only cache when the
  // docs are public SAM attachments (a user's OWN uploads stay private). Key on
  // a content hash of the doc set so an amendment landing → new docs → new hash
  // → re-extract automatically.
  const noticeId = docs.find(d => d.notice_id)?.notice_id || '';
  const allPublic = docs.every(d => d.doc_source === 'sam_public');
  const sig = docs.map(d => `${d.filename}:${(d.extracted_text || '').length}`).sort().join('|');
  const contentHash = noticeId && allPublic
    ? crypto.createHash('sha256').update(`${noticeId}::${sig}`).digest('hex')
    : null;

  if (contentHash) {
    const { data: hit, error: hitErr } = await supabase
      .from('compliance_matrix_cache')
      .select('requirements, doc_sources, hits')
      .eq('content_hash', contentHash)
      .maybeSingle();
    if (hitErr) console.error('[compliance] cache query error:', hitErr.message);
    if (hit?.requirements) {
      // count the hit (fire-and-forget) and serve instantly — ~0 tokens.
      supabase.from('compliance_matrix_cache').update({ hits: (hit.hits || 0) + 1 }).eq('content_hash', contentHash).then(() => {});
      return { requirements: hit.requirements as ComplianceRequirement[], sources: (hit.doc_sources as string[]) || [], cached: true };
    }
  }

  // Order: base/scope first, amendments LAST (so they override) by amd number.
  const amdNum = (fn: string) => parseInt((fn.match(/amd[_ -]?(\d+)/i)?.[1]) || '0', 10);
  const ordered = [...docs].sort((a, b) => {
    const aw = a.doc_kind === 'amendment' ? 1000 + amdNum(a.filename || '') : 0;
    const bw = b.doc_kind === 'amendment' ? 1000 + amdNum(b.filename || '') : 0;
    return aw - bw;
  });

  // Merge into a map keyed by a normalized requirement signature. Amendments
  // overwrite a matching base requirement (flag revised); new amendment reqs add.
  const map = new Map<string, ComplianceRequirement>();
  const sources: string[] = [];
  const sigOf = (r: ComplianceRequirement) => (r.requirement || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 60);

  // Build the chunk worklist across ALL docs IN PRECEDENCE ORDER (base first,
  // amendments last). Bounded per-doc AND globally so a 13-doc package can't spawn
  // hundreds of serial LLM calls and time out (Eric, Jun 26). Chunks are then
  // extracted in PARALLEL (bounded) and merged back in order, so amendments still
  // override base requirements.
  const MAX_CHUNKS_PER_DOC = 30;   // 30 × 14K ≈ 420K chars covered per doc
  // High ceiling so coverage isn't cut (a 13-doc package needs ~120 chunks for its
  // 286 requirements — Eric, Jun 26). Speed comes from PARALLELISM below, not from
  // dropping chunks: ~120 chunks ÷ 6 concurrent ≈ 60s vs the old ~300s serial.
  const MAX_TOTAL_CHUNKS = 200;
  const EXTRACT_CONCURRENCY = 6;
  type ChunkTask = { docIndex: number; label: string; isAmendment: boolean; isChange: boolean; filename?: string; chunk: string };
  const tasks: ChunkTask[] = [];
  ordered.forEach((doc, docIndex) => {
    const text = doc.extracted_text || '';
    const label = doc.doc_kind === 'amendment'
      ? `Amendment ${String(amdNum(doc.filename || '')).padStart(4, '0')}`
      : (doc.doc_kind || 'document');
    const isChange = doc.doc_kind === 'amendment' || doc.doc_kind === 'qa';
    const chunks = chunkText(text, 14000).slice(0, MAX_CHUNKS_PER_DOC);
    for (const c of chunks) {
      if (tasks.length >= MAX_TOTAL_CHUNKS) break;
      tasks.push({ docIndex, label, isAmendment: doc.doc_kind === 'amendment', isChange, filename: doc.filename, chunk: c });
    }
  });

  const taskResults = await mapPool(tasks, EXTRACT_CONCURRENCY, (t) => extractChunk(t.filename, t.chunk, t.isChange));

  // Merge in task order (== precedence order) so amendments overwrite base.
  const perDocCount = new Map<number, number>();
  taskResults.forEach((reqs, i) => {
    if (!reqs) return;
    const t = tasks[i];
    perDocCount.set(t.docIndex, (perDocCount.get(t.docIndex) || 0) + reqs.length);
    for (const r of reqs) {
      const sig = sigOf(r);
      if (!sig) continue;
      const tagged = { ...r, source_doc: t.label, revised: t.isAmendment && map.has(sig) };
      map.set(sig, tagged);
    }
  });
  ordered.forEach((_, docIndex) => {
    const count = perDocCount.get(docIndex) || 0;
    if (count) sources.push(`${tasks.find(t => t.docIndex === docIndex)?.label || 'document'} (${count})`);
  });
  const requirements = Array.from(map.values()).map((r, i) => ({ ...r, id: `REQ-${String(i + 1).padStart(3, '0')}` }));
  // Store in the shared cache so the next user bidding this notice is instant +
  // free (only for public SAM doc sets).
  if (contentHash && requirements.length > 0) {
    supabase.from('compliance_matrix_cache').upsert({
      content_hash: contentHash,
      notice_id: noticeId,
      requirements,
      doc_sources: sources,
      req_count: requirements.length,
      model: GROQ_MODEL,
    }, { onConflict: 'content_hash' }).then(() => {}, () => {});
  }

  return { requirements, sources };
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ success: false, error: 'email query param is required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // Any one provider key is enough — callLLM falls through the chain.
  if (!process.env.GROQ_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GROK_API_KEY) {
    return NextResponse.json({ success: false, error: 'AI service not configured' }, { status: 500 });
  }

  // MULTI-DOC mode (Eric QC: amendments revise the base — deadlines/specs — so a
  // base-only matrix is STALE and would pass a non-compliant bid). When a
  // pipeline_id is sent, extract from base solicitation + AMENDMENTS + Q&A, and
  // merge with AMENDMENT PRECEDENCE (later amendments win; flag what changed).
  const sourceText = (body.text || '').trim();
  let multiDocResult: { requirements: ComplianceRequirement[]; sources: string[]; cached?: boolean } | null = null;
  if (body.pipeline_id) {
    multiDocResult = await extractMultiDoc(body.pipeline_id);
  }
  if (!multiDocResult && !sourceText) {
    return NextResponse.json({ success: false, error: 'No source text provided. Upload an RFP first.' }, { status: 400 });
  }

  try {
    let requirements: ComplianceRequirement[];
    let anyOk: boolean;
    let truncated = false;
    let inputChars = 0;
    let originalChars = sourceText.length;

    if (multiDocResult) {
      // Multi-doc chunks each doc fully (no 50K slice) and re-ids; normalize the
      // categories here to preserve the single downstream contract.
      requirements = multiDocResult.requirements.map((r) => ({
        ...r,
        category: normalizeCategory(r.category as string | undefined, r.requirement),
      }));
      anyOk = requirements.length > 0;
      originalChars = 0;
    } else {
      // Single-doc: the shared engine truncates, chunks, extracts in parallel,
      // dedupes, normalizes categories, and re-ids.
      const ex = await extractComplianceMatrixFromText(sourceText, { fileName: body.fileName, userEmail: email });
      requirements = ex.requirements;
      anyOk = ex.ok;
      truncated = ex.truncated;
      inputChars = ex.inputChars;
      originalChars = ex.originalChars;
    }

    if (!anyOk) {
      await logToolError({
        tool: ToolNames.PROPOSAL_ASSIST,
        errorType: 'api_error',
        errorMessage: 'compliance extraction failed on all chunks',
        requestPath: '/api/app/proposal/compliance',
        aiProvider: AIProviders.GROQ,
        aiModel: GROQ_MODEL,
      });
      return NextResponse.json({ success: false, error: 'AI service error. Try again.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      requirements,
      meta: {
        model: GROQ_MODEL,
        inputChars,
        truncated,
        originalChars,
        count: requirements.length,
        sources: multiDocResult?.sources,
        multiDoc: !!multiDocResult,
        cached: multiDocResult?.cached || false,
      },
    });
  } catch (err) {
    console.error('[proposal/compliance] exception:', err);
    const errAsError = err instanceof Error ? err : new Error(String(err));
    await logToolError({
      tool: ToolNames.PROPOSAL_ASSIST,
      errorType: classifyError(errAsError),
      errorMessage: errAsError.message,
      requestPath: '/api/app/proposal/compliance',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    });
    return NextResponse.json({ success: false, error: 'Compliance extraction failed. Try again.' }, { status: 500 });
  }
}

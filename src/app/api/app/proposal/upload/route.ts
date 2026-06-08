import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const SUPABASE_BUCKET = 'pursuit-documents';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
}

type ExtractResult = {
  text: string;
  pageCount?: number;
};

async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return { text: result.text || '', pageCount: result.total };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value || '' };
}

// Pricing schedules are usually .xlsx (Eric: "we DID support xlsx, what
// changed?"). The xlsx lib is already a dependency; flatten every sheet to text
// (CSV per sheet) so pricing line items + CLINs become readable.
async function extractXlsx(buffer: Buffer): Promise<ExtractResult> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) parts.push(`### Sheet: ${sheetName}\n${csv}`);
  }
  return { text: parts.join('\n\n') };
}

function inferKind(name: string, mime: string): 'pdf' | 'docx' | 'txt' | 'xlsx' | null {
  const lower = name.toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    lower.endsWith('.xlsx') || lower.endsWith('.xls')
  ) {
    return 'xlsx';
  }
  if (mime === 'text/plain' || lower.endsWith('.txt')) return 'txt';
  return null;
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ success: false, error: 'email query param is required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Expected multipart/form-data with a "file" field' },
      { status: 400 }
    );
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ success: false, error: 'No file uploaded under "file" field' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { success: false, error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024} MB.` },
      { status: 413 }
    );
  }

  const kind = inferKind(file.name, file.type);
  if (!kind) {
    return NextResponse.json(
      { success: false, error: 'Unsupported file type. Upload PDF, DOCX, XLSX, or TXT.' },
      { status: 415 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    let extract: ExtractResult;
    if (kind === 'pdf') extract = await extractPdf(buffer);
    else if (kind === 'docx') extract = await extractDocx(buffer);
    else if (kind === 'xlsx') extract = await extractXlsx(buffer);
    else extract = { text: buffer.toString('utf-8') };

    const text = (extract.text || '').trim();

    // Optional: persist the uploaded doc to a pursuit. Used by the pipeline
    // drawer's "Upload a document" affordance on pursuits SAM/grants.gov can't
    // serve (archived/forecasted/bad-id notices). Writes a pursuit_documents
    // row with doc_source='user_upload' (NEVER deduped across users — see the
    // doc_source migration) and flips the pursuit to docs_status='ready'.
    const pipelineId = request.nextUrl.searchParams.get('pipeline_id');
    let persisted = false;
    if (pipelineId) {
      try {
        const sb = getSupabase();
        // Ownership check: only attach to a pursuit the caller owns.
        const { data: row } = await sb
          .from('user_pipeline')
          .select('id, user_email, notice_id')
          .eq('id', pipelineId)
          .maybeSingle();
        if (row && (row.user_email || '').toLowerCase() === email.toLowerCase()) {
          const fileId = `upload-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`.slice(0, 120);
          const storagePath = `${email.toLowerCase()}/${pipelineId}/${fileId}`.slice(0, 500);
          let finalStoragePath: string | null = null;
          try {
            const { error: upErr } = await sb.storage.from(SUPABASE_BUCKET)
              .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: true });
            if (!upErr) finalStoragePath = storagePath;
          } catch { /* best-effort */ }

          const { error: insErr } = await sb.from('pursuit_documents').upsert({
            pipeline_id: pipelineId,
            user_email: email.toLowerCase(),
            sam_file_id: fileId,
            sam_url: null,
            notice_id: row.notice_id,
            filename: file.name,
            mime_type: file.type || kind,
            size_bytes: file.size,
            storage_path: finalStoragePath,
            extracted_text: text || null,
            page_count: extract.pageCount ?? null,
            char_count: text.length,
            doc_source: 'user_upload', // private — never deduped to other users
            downloaded_at: new Date().toISOString(),
            extracted_at: new Date().toISOString(),
            extraction_error: null,
          }, { onConflict: 'pipeline_id,sam_file_id' });

          if (!insErr) {
            persisted = true;
            await sb.from('user_pipeline')
              .update({ docs_status: 'ready', docs_fetched_at: new Date().toISOString() })
              .eq('id', pipelineId);
            // Bump docs_count to the real row count for this pursuit.
            const { count } = await sb.from('pursuit_documents')
              .select('id', { count: 'exact', head: true })
              .eq('pipeline_id', pipelineId);
            if (typeof count === 'number') {
              await sb.from('user_pipeline').update({ docs_count: count }).eq('id', pipelineId);
            }
          }
        }
      } catch (err) {
        console.warn('[proposal/upload] pursuit persist failed:', err);
        // Non-fatal — still return the extracted text below.
      }
    }

    return NextResponse.json({
      success: true,
      file: {
        name: file.name,
        size: file.size,
        type: file.type || kind,
      },
      text,
      charCount: text.length,
      pageCount: extract.pageCount,
      persisted,
    });
  } catch (err) {
    console.error('[proposal/upload] parse failed:', err);
    return NextResponse.json(
      { success: false, error: 'Could not extract text from the file. Try a different export.' },
      { status: 500 }
    );
  }
}

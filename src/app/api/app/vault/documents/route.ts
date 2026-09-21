import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { extractPdf, extractDocx, extractTxt } from '@/lib/sam/pdf-extract';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const BUCKET = 'vault-assets';
const MAX_BYTES = 20 * 1024 * 1024; // 20MB

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

// Lazy-ensure bucket exists on first upload (same pattern as
// pursuit-documents pipeline). Idempotent.
async function ensureBucket() {
  const supabase = getSupabase();
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.find((b: { name: string }) => b.name === BUCKET)) {
    await supabase.storage.createBucket(BUCKET, { public: false });
  }
}

function detectDocType(filename: string): { ext: string; mime: string } {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return { ext: 'pdf', mime: 'application/pdf' };
  if (lower.endsWith('.docx')) return { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  if (lower.endsWith('.doc')) return { ext: 'doc', mime: 'application/msword' };
  if (lower.endsWith('.txt')) return { ext: 'txt', mime: 'text/plain' };
  return { ext: 'bin', mime: 'application/octet-stream' };
}

export async function POST(request: NextRequest) {
  // Multipart form: file + email + doc_type
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid form data' }, { status: 400 });
  }

  const file = form.get('file') as File | null;
  const email = String(form.get('email') || '').trim();
  const doc_type = String(form.get('doc_type') || 'other').trim();

  if (!file) return NextResponse.json({ success: false, error: 'file required' }, { status: 400 });
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ success: false, error: `File too large (max ${MAX_BYTES / 1024 / 1024}MB)` }, { status: 413 });
  }

  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  // Coach Mode: a document uploaded while working as a client belongs to the
  // CLIENT's vault (synthetic email), not the coach's — else it leaks into every
  // client's Documents tab and the client never sees their own upload.
  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const userEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { ext, mime } = detectDocType(file.name);

  // Upload to Storage
  await ensureBucket();
  const supabase = getSupabase();
  const storagePath = `${userEmail}/${Date.now()}-${file.name}`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: mime, upsert: false });
  if (uploadErr) {
    return NextResponse.json({ success: false, error: `Storage upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  // Extract text (in-request — small files, < 60s)
  let extracted_text = '';
  let page_count: number | null = null;
  let parse_status = 'parsed';
  let parse_error: string | null = null;
  try {
    if (ext === 'pdf') {
      const r = await extractPdf(buffer);
      extracted_text = r.text;
      page_count = r.pageCount ?? null;
    } else if (ext === 'docx') {
      const r = await extractDocx(buffer);
      extracted_text = r.text;
    } else if (ext === 'txt') {
      const r = extractTxt(buffer);
      extracted_text = r.text;
    } else {
      parse_status = 'failed';
      parse_error = `Unsupported file type: ${ext}`;
    }
  } catch (e) {
    parse_status = 'failed';
    parse_error = e instanceof Error ? e.message : String(e);
  }

  if (parse_status === 'parsed' && extracted_text.trim().length === 0) {
    parse_status = 'failed';
    parse_error = 'No text could be extracted';
  }

  // Cap stored text to avoid bloating rows. Most cap statements are
  // under 50k chars; we keep 500k as a safety ceiling.
  if (extracted_text.length > 500_000) extracted_text = extracted_text.slice(0, 500_000);

  const { data, error: insertErr } = await supabase
    .from('user_boilerplate_docs')
    .insert({
      user_email: userEmail,
      doc_type,
      original_filename: file.name,
      mime_type: mime,
      size_bytes: file.size,
      storage_path: storagePath,
      extracted_text,
      page_count,
      parse_status,
      parse_error,
    })
    .select()
    .maybeSingle();

  if (insertErr) {
    return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, document: data });
}

export async function DELETE(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  const id = String(request.nextUrl.searchParams.get('id') || '').trim();
  if (!email || !id) return NextResponse.json({ success: false, error: 'Email and id required' }, { status: 400 });
  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated) return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const ownerEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;
  const { error } = await getSupabase().from('user_boilerplate_docs')
    .update({ archived_at: new Date().toISOString() }).eq('id', id).eq('user_email', ownerEmail);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

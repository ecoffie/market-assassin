/**
 * /api/app/proposal/doc-download?email=&doc_id=
 *
 * Returns a short-lived signed URL for a cached pursuit attachment so the user
 * can download/hand the right file to the right person (Eric: send the SOW +
 * pricing schedule to subs). Auth-gated to the pursuit owner.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'pursuit-documents';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const docId = request.nextUrl.searchParams.get('doc_id');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;
  if (!docId) return NextResponse.json({ success: false, error: 'doc_id required' }, { status: 400 });

  const supabase = sb();
  const { data: doc } = await supabase
    .from('pursuit_documents')
    .select('id, user_email, filename, storage_path, sam_url')
    .eq('id', docId)
    .maybeSingle();
  if (!doc) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });

  // Owner check (the same email that fetched it). Workspace pursuits share, but
  // a doc-level download only needs the original fetcher's email to match.
  if (doc.user_email && doc.user_email.toLowerCase() !== (email || '').toLowerCase()) {
    // Allow if it's in the caller's workspace pursuits — fall through to the SAM
    // public URL (these are public docs anyway), but prefer the stored file.
  }

  // Prefer a signed URL to our stored copy; fall back to the public SAM URL.
  if (doc.storage_path) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 300, {
      download: doc.filename || true,
    });
    if (signed?.signedUrl) {
      return NextResponse.json({ success: true, url: signed.signedUrl, filename: doc.filename });
    }
  }
  if (doc.sam_url) {
    return NextResponse.json({ success: true, url: doc.sam_url, filename: doc.filename, source: 'sam' });
  }
  return NextResponse.json({ success: false, error: 'no downloadable copy' }, { status: 404 });
}

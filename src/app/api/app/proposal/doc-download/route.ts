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
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';

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

  // Coach Mode: pursuit docs uploaded/fetched while working as a client are stored
  // under the client's synthetic email (see proposal/upload). Resolve the active
  // workspace so the ownership check matches the SAME email the doc was stored
  // under — otherwise a coach can't download their own client's attachment.
  const { workspaceId, asClient } = await resolveActiveWorkspace(email || '', request);
  const scopedEmail = asClient ? clientNotificationEmail(workspaceId) : (email || '').toLowerCase();

  const supabase = sb();
  const { data: doc, error: docErr } = await supabase
    .from('pursuit_documents')
    .select('id, user_email, filename, storage_path, sam_url')
    .eq('id', docId)
    .maybeSingle();
  if (docErr) console.error('[doc-download] doc query error:', docErr.message);
  if (!doc) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });

  // Owner check against the workspace-scoped email. Docs are public SAM
  // attachments, so a mismatch falls through to the public SAM URL rather than
  // hard-blocking — but the stored copy is only served to its rightful owner.
  const ownsDoc = !doc.user_email || doc.user_email.toLowerCase() === scopedEmail;

  // Prefer a signed URL to our stored copy — but only for the doc's rightful
  // owner (self, or the active client when in Coach Mode). Others fall through
  // to the public SAM URL below.
  if (ownsDoc && doc.storage_path) {
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

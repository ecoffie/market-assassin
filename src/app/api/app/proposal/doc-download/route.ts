/**
 * /api/app/proposal/doc-download?email=&doc_id=
 *
 * Returns a short-lived signed URL for a cached pursuit attachment so the user
 * can download/hand the right file to the right person (Eric: send the SOW +
 * pricing schedule to subs).
 *
 * Access to the stored copy: the document's owner (self, or the active client
 * in Coach Mode), or anyone the shared pursuit rule allows to read the pursuit
 * it belongs to (owner, workspace member, authorized coach — #2086). The owner
 * comparison fails closed: a row without an owner is never treated as owned.
 * A caller without access gets only a public source URL when the document is
 * public, and otherwise the same not-found answer as a missing document.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { authorizePursuitRead } from '@/lib/proposal/pursuit-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'pursuit-documents';
/** Provenance values that mark a public source document (see the doc_source migration). */
const PUBLIC_SOURCES = new Set(['sam_public', 'grants_public']);

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const notFound = () => NextResponse.json({ success: false, error: 'not found' }, { status: 404 });

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const docId = request.nextUrl.searchParams.get('doc_id');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;
  if (!docId) return NextResponse.json({ success: false, error: 'doc_id required' }, { status: 400 });

  // Coach Mode: pursuit docs uploaded/fetched while working as a client are stored
  // under the client's synthetic email (see proposal/upload). Resolve the active
  // workspace so the ownership check matches the SAME email the doc was stored under.
  const caller = (email || '').trim().toLowerCase();
  const { workspaceId, asClient } = await resolveActiveWorkspace(caller, request);
  const scopedEmail = asClient ? clientNotificationEmail(workspaceId) : caller;

  const supabase = sb();
  const { data: doc, error: docErr } = await supabase
    .from('pursuit_documents')
    .select('id, pipeline_id, user_email, filename, storage_path, sam_url, doc_source')
    .eq('id', docId)
    .maybeSingle();
  if (docErr) console.error('[doc-download] doc query error:', docErr.message);
  if (!doc) return notFound();

  const owner = typeof doc.user_email === 'string' ? doc.user_email.trim().toLowerCase() : '';
  let mayRead = owner.length > 0 && owner === scopedEmail;
  if (!mayRead && doc.pipeline_id) {
    const access = await authorizePursuitRead(supabase, request, caller, doc.pipeline_id);
    mayRead = access.ok;
  }

  if (mayRead && doc.storage_path) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 300, {
      download: doc.filename || true,
    });
    if (signed?.signedUrl) {
      return NextResponse.json({ success: true, url: signed.signedUrl, filename: doc.filename });
    }
  }

  const isPublic = PUBLIC_SOURCES.has(String(doc.doc_source || 'sam_public'));
  if (doc.sam_url && (mayRead || isPublic)) {
    return NextResponse.json({ success: true, url: doc.sam_url, filename: doc.filename, source: 'sam' });
  }
  if (!mayRead) return notFound();
  return NextResponse.json({ success: false, error: 'no downloadable copy' }, { status: 404 });
}

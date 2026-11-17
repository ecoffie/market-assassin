/**
 * GET /api/app/vault/documents/download?email=&id=  — download one Vault document (company, reference
 * or generated). Free: no credits.
 *
 * There was no Vault download before this route. Every request:
 *   - STRONG auth for `email` (same as every Vault route);
 *   - STRICT acting scope (resolveVaultWriteOwner): an unauthorized x-active-workspace header or a
 *     resolver error is refused (409), never answered from the caller's own Vault;
 *   - the row is looked up by id AND the acting-scope owner AND not archived — the owner check is in
 *     the query, so another account's document is indistinguishable from a missing one;
 *   - missing, forbidden, archived and blob-less documents all return the IDENTICAL 404 body
 *     (the #2108 pattern), so ids cannot be probed;
 *   - the response is a 60-second signed URL to the private bucket (Content-Disposition: attachment
 *     with the stored file name). No public URL exists.
 *
 * Gated by VAULT_GENERATED_FILES or VAULT_ASK_MINDY_UPLOADS (both default OFF; off → the same 404).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { WORKSPACE_UNCONFIRMED_NOTE } from '@/lib/chat/chat-acting-scope';
import { resolveVaultWriteOwner, VAULT_BUCKET } from '@/lib/vault/upload';
import { vaultDocEnabledFor, vaultDocFeatureLive } from '@/lib/vault/flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const SIGNED_URL_SECONDS = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** The one not-found answer: missing, forbidden, archived and unavailable look the same. */
const notFound = () => NextResponse.json({ success: false, error: 'not_found' }, { status: 404, headers: NO_STORE });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  if (!vaultDocFeatureLive('generate') && !vaultDocFeatureLive('uploads')) return notFound();
  const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  const id = (request.nextUrl.searchParams.get('id') || '').trim();
  if (!email) return NextResponse.json({ success: false, error: 'email_required' }, { status: 400, headers: NO_STORE });

  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  // Per-caller flags (controlled test): not allowlisted for either feature = the same 404 as off.
  const caller = auth.email.toLowerCase();
  if (!vaultDocEnabledFor('generate', caller) && !vaultDocEnabledFor('uploads', caller)) return notFound();
  const owner = await resolveVaultWriteOwner(caller, request);
  if (!owner) {
    return NextResponse.json({ success: false, error: 'workspace_unconfirmed', message: WORKSPACE_UNCONFIRMED_NOTE }, { status: 409, headers: NO_STORE });
  }
  if (!UUID_RE.test(id)) return notFound();

  const sb = db();
  const { data: doc, error } = await sb.from('user_boilerplate_docs')
    .select('id, original_filename, storage_path')
    .eq('id', id)
    .eq('user_email', owner.ownerEmail)
    .is('archived_at', null)
    .maybeSingle();
  if (error || !doc || !doc.storage_path) return notFound();

  const { data: signed, error: signErr } = await sb.storage.from(VAULT_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS, { download: String(doc.original_filename || 'document') });
  if (signErr || !signed?.signedUrl) return notFound();

  return NextResponse.json(
    { success: true, url: signed.signedUrl, filename: doc.original_filename, expires_in_seconds: SIGNED_URL_SECONDS },
    { status: 200, headers: NO_STORE },
  );
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { saveVaultUpload, VAULT_MAX_BYTES, VAULT_PANEL_EXTS, resolveVaultWriteOwner } from '@/lib/vault/upload';
import { vaultCompleteDeletionEnabled } from '@/lib/vault/flags';
import { hardDeleteVaultDocument } from '@/lib/vault/document-delete';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

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
  if (file.size > VAULT_MAX_BYTES) {
    return NextResponse.json({ success: false, error: `File too large (max ${VAULT_MAX_BYTES / 1024 / 1024}MB)` }, { status: 413 });
  }

  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  // Shared with the Ask Mindy upload route (src/lib/vault/upload.ts): strict acting
  // scope (Coach Mode → the CLIENT's Vault; an unconfirmed workspace saves nothing),
  // extraction, classification/CUI refusal before any write, private bucket.
  const supabase = getSupabase();
  const result = await saveVaultUpload(
    {
      callerEmail: auth.email!,
      request,
      file: { name: file.name, size: file.size, buffer: Buffer.from(await file.arrayBuffer()) },
      docClass: 'company',
      source: 'vault',
      docType: doc_type,
      // Spreadsheets stay behind Ask Mindy's flagged chat upload — not the Vault API.
      allowedExts: VAULT_PANEL_EXTS,
    },
    { db: supabase, storage: supabase.storage },
  );
  if (!result.ok) {
    const headers = result.retryAfterSeconds ? { 'Retry-After': String(result.retryAfterSeconds) } : undefined;
    return NextResponse.json({ success: false, error: result.message, code: result.code }, { status: result.status, headers });
  }
  return NextResponse.json({ success: true, document: result.document });
}

export async function DELETE(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  const id = String(request.nextUrl.searchParams.get('id') || '').trim();
  if (!email || !id) return NextResponse.json({ success: false, error: 'Email and id required' }, { status: 400 });
  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated) return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });

  // ?mode=delete — permanent Delete (file, record, versions; backup copy purged after the recovery
  // window). Distinct from the default Archive below. Off until the retention policy is approved.
  if (request.nextUrl.searchParams.get('mode') === 'delete') {
    if (!vaultCompleteDeletionEnabled()) {
      return NextResponse.json({ success: false, code: 'not_available', error: 'Permanent delete is not available yet. Archive the document instead.' }, { status: 404 });
    }
    if (request.nextUrl.searchParams.get('confirm') !== 'DELETE') {
      return NextResponse.json({ success: false, code: 'confirm_required', error: 'Add confirm=DELETE to permanently delete this document. This cannot be undone.' }, { status: 400 });
    }
    // Strict owner: an unconfirmed workspace deletes nothing (same answer as upload / revise).
    const owner = await resolveVaultWriteOwner(auth.email!, request);
    if (!owner) {
      return NextResponse.json({ success: false, code: 'workspace_unconfirmed', error: "The workspace you're working in couldn't be confirmed, so nothing was deleted." }, { status: 409 });
    }
    if (owner.workspace === 'client') {
      return NextResponse.json({ success: false, code: 'client_workspace_policy_pending', error: "Permanent delete in a client's Vault isn't available yet. Archive the document instead." }, { status: 403 });
    }
    const supabase = getSupabase();
    const r = await hardDeleteVaultDocument({ db: supabase, storage: supabase.storage }, { id, ownerEmail: owner.ownerEmail });
    if (!r.ok) return NextResponse.json({ success: false, code: r.code, error: r.message, deleted: r.partial }, { status: r.status });
    const backupErr = r.receipt.backupPurge.error;
    return NextResponse.json(
      { success: !backupErr, deleted: r.receipt, error: backupErr ? 'The document was deleted, but its backup copy could not be scheduled for removal.' : undefined },
      { status: backupErr ? 500 : 200 },
    );
  }

  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const ownerEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;
  const { error } = await getSupabase().from('user_boilerplate_docs')
    .update({ archived_at: new Date().toISOString() }).eq('id', id).eq('user_email', ownerEmail);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

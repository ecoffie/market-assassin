/**
 * /api/app/chat/documents — attach documents to ONE Ask Mindy conversation. Saved privately to the
 * user's VAULT (Eric, 2026-11-17: the Vault is the only document store).
 *
 *   POST   ?email=&session_id=   multipart field "file"  → stored via the shared Vault helper as
 *                                                          doc_class='reference'; metadata only back
 *   GET    ?email=&session_id=                           → this conversation's documents (metadata)
 *   DELETE ?email=&session_id=&id=                       → archive one (soft; hard delete awaits Eric)
 *
 * Gated by VAULT_ASK_MINDY_UPLOADS=true (default OFF). Auth is the same STRONG auth the Vault routes
 * require, plus hasProAccess (the Ask Mindy gate). Upload, list and delete are free: no credits.
 *
 * Ownership (strict — src/lib/vault/upload.ts resolveVaultWriteOwner):
 *   - no workspace header             → the caller's own Vault
 *   - authorized coach in client      → the client's Vault (synthetic workspace email)
 *   - header present but unconfirmed  → REFUSED (409), including a resolver DB error. Never falls back
 *     to the caller's own Vault.
 * The conversation must be new or already belong to the caller; another user's conversation answers
 * exactly like a missing one (404). A new conversation row is created only when the file is actually
 * about to be stored (after the classification/CUI check), so a refused upload leaves nothing behind.
 *
 * Recovered from the unpushed agent3/chat-documents branch and retargeted from the retired held
 * chat_documents table onto user_boilerplate_docs + the shared helper.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { hasProAccess } from '@/lib/access/resolve-access';
import { WORKSPACE_UNCONFIRMED_NOTE } from '@/lib/chat/chat-acting-scope';
import { resolveVaultWriteOwner, saveVaultUpload } from '@/lib/vault/upload';
import {
  isVaultChatDocumentsEnabled, countSessionDocuments, listChatDocuments, archiveChatDocument,
  MAX_DOCS_PER_SESSION, type ChatDocsDb,
} from '@/lib/vault/chat-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The platform rejects request bodies above ~4.5 MB before this code runs, so the honest app limit is
 * just under it, with a clear message, instead of a 20 MB limit that can never be reached here.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });
}
const notFound = () => json({ success: false, error: 'not_found' }, 404);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

type Gate =
  | { ok: true; caller: string; ownerEmail: string; sessionId: string; sessionExists: boolean; sb: ChatDocsDb & ReturnType<typeof db> }
  | { ok: false; response: Response };

/** Flag, strong auth, entitlement, strict acting scope and conversation ownership — every method. */
async function gate(request: NextRequest): Promise<Gate> {
  if (!isVaultChatDocumentsEnabled()) return { ok: false, response: notFound() };
  const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  const sessionId = (request.nextUrl.searchParams.get('session_id') || '').trim();
  if (!email) return { ok: false, response: json({ success: false, error: 'email_required' }, 400) };
  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated || !auth.email) return { ok: false, response: json({ success: false, error: auth.error || 'Unauthorized' }, 401) };
  const caller = auth.email.toLowerCase();
  if (!(await hasProAccess(caller))) return { ok: false, response: json({ success: false, error: 'pro_required', upgrade: true }, 403) };
  if (!UUID_RE.test(sessionId)) return { ok: false, response: json({ success: false, error: 'session_id must be a UUID' }, 400) };

  const owner = await resolveVaultWriteOwner(caller, request);
  if (!owner) return { ok: false, response: json({ success: false, error: 'workspace_unconfirmed', message: WORKSPACE_UNCONFIRMED_NOTE }, 409) };

  const sb = db();
  const { data: session, error: sessionErr } = await sb.from('mindy_chat_sessions').select('id, user_email').eq('id', sessionId).maybeSingle();
  if (sessionErr) return { ok: false, response: json({ success: false, error: 'session_unavailable' }, 503) };
  const sessionOwner = String((session as { user_email?: string } | null)?.user_email || '').trim().toLowerCase();
  if (session && sessionOwner !== caller) return { ok: false, response: notFound() };
  return { ok: true, caller, ownerEmail: owner.ownerEmail, sessionId, sessionExists: !!session, sb };
}

function storeFailure(reason: 'unavailable' | 'error') {
  return reason === 'unavailable'
    ? json({ success: false, error: 'documents_unavailable' }, 503)
    : json({ success: false, error: 'documents_error' }, 500);
}

export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return json({ success: false, error: 'file_too_large', message: `Files can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, 413);
  }
  const g = await gate(request);
  if (!g.ok) return g.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ success: false, error: 'Expected multipart/form-data with a "file" field' }, 400);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ success: false, error: 'No file uploaded under "file" field' }, 400);
  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ success: false, error: 'file_too_large', message: `Files can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, 413);
  }

  const count = await countSessionDocuments(g.sb, { sessionId: g.sessionId, ownerEmail: g.ownerEmail });
  if (!count.ok) return storeFailure(count.reason);
  if (count.value >= MAX_DOCS_PER_SESSION) {
    return json({ success: false, error: 'too_many_documents', message: `A conversation can hold up to ${MAX_DOCS_PER_SESSION} documents. Remove one first.` }, 409);
  }

  const result = await saveVaultUpload(
    {
      callerEmail: g.caller,
      request,
      file: { name: file.name, size: file.size, buffer: Buffer.from(await file.arrayBuffer()) },
      docClass: 'reference',
      source: 'ask_mindy',
      chatSessionId: g.sessionId,
    },
    {
      db: g.sb,
      storage: g.sb.storage,
      // A document can be attached before the first question. Create the conversation row only now —
      // every check (type, scope, markings) has passed — so a refused file leaves no empty conversation.
      beforeWrite: async () => {
        if (g.sessionExists) return true;
        const nowIso = new Date().toISOString();
        const { error } = await g.sb.from('mindy_chat_sessions').insert({
          id: g.sessionId, user_email: g.caller, title: `Attached: ${file.name}`.slice(0, 60), message_count: 0, created_at: nowIso, updated_at: nowIso,
        });
        return !error;
      },
    },
  );
  if (!result.ok) {
    const extra: Record<string, string> = result.retryAfterSeconds ? { 'Retry-After': String(result.retryAfterSeconds) } : {};
    return json({ success: false, error: result.code, message: result.message }, result.status, extra);
  }
  const d = result.document as Record<string, unknown>;
  // Metadata only: the extracted text never goes back to the browser.
  return json({
    success: true,
    saved_to: 'vault',
    document: {
      id: d.id, filename: d.original_filename, mime_type: d.mime_type ?? null, size_bytes: d.size_bytes ?? null,
      page_count: d.page_count ?? null, doc_class: 'reference', created_at: d.created_at ?? null,
    },
  }, 201);
}

export async function GET(request: NextRequest) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  if (!g.sessionExists) return json({ success: true, documents: [] }, 200);
  const list = await listChatDocuments(g.sb, { sessionId: g.sessionId, ownerEmail: g.ownerEmail });
  if (!list.ok) return storeFailure(list.reason);
  return json({ success: true, documents: list.value }, 200);
}

export async function DELETE(request: NextRequest) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  const id = (request.nextUrl.searchParams.get('id') || '').trim();
  if (!UUID_RE.test(id) || !g.sessionExists) return notFound();
  const del = await archiveChatDocument(g.sb, { id, sessionId: g.sessionId, ownerEmail: g.ownerEmail });
  if (!del.ok) return storeFailure(del.reason);
  return del.value ? json({ success: true }, 200) : notFound();
}

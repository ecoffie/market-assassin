/**
 * Ask Mindy conversation documents, stored in the VAULT (Eric, 2026-11-17: the Vault is the only
 * document store). A file attached in a conversation is a `user_boilerplate_docs` row with
 * doc_class='reference', source='ask_mindy' and chat_session_id = the conversation; the original
 * file sits in the private `vault-assets` bucket. Writes go through the one shared helper
 * (src/lib/vault/upload.ts); this module only reads, counts and archives.
 *
 * Retargeted from the retired held `chat_documents` table (recovered branch agent3/chat-documents).
 *
 * Ownership key: `user_email` is the ACTING-SCOPE email (vaultEmailFor / resolveVaultWriteOwner), and
 * the conversation must already belong to the caller (checked by the route and the chat route).
 * Every read and archive filters on BOTH owner and conversation, and skips archived rows.
 *
 * The doc_class / chat_session_id columns exist only once migration 20261117_vault_doc_class.sql is
 * applied. Until then every query errors with a missing-column code, which is reported as
 * `unavailable` — never as "no documents" (CLAUDE.md bug rule #11).
 */
import { vaultDocFlags } from '@/lib/vault/flags';

/** Minimal client surface (the service-role Supabase client satisfies it; tests pass a fake). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChatDocsDb = { from(table: string): any };

export const VAULT_DOCS_TABLE = 'user_boilerplate_docs';
export const MAX_DOCS_PER_SESSION = 5;

/** Ask Mindy uploads are behind VAULT_ASK_MINDY_UPLOADS=true (default OFF). */
export function isVaultChatDocumentsEnabled(): boolean {
  return vaultDocFlags.askMindyUploads;
}

export interface ChatDocumentMeta {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  page_count: number | null;
  char_count: number | null;
  text_truncated: boolean;
  created_at: string;
}

export interface ChatDocumentText extends ChatDocumentMeta {
  extracted_text: string | null;
}

export type StoreResult<T> = { ok: true; value: T } | { ok: false; reason: 'unavailable' | 'error'; message: string };

type Row = {
  id: string; original_filename: string; mime_type: string | null; size_bytes: number | null;
  page_count: number | null; created_at: string; extracted_text?: string | null;
};
const META_COLUMNS = 'id, original_filename, mime_type, size_bytes, page_count, created_at';
/** What the upload helper stores at most per document (src/lib/vault/upload.ts MAX_STORED_TEXT). */
const STORED_TEXT_CAP = 500_000;

function toMeta(r: Row): ChatDocumentMeta {
  const len = typeof r.extracted_text === 'string' ? r.extracted_text.length : null;
  return {
    id: r.id,
    filename: r.original_filename,
    mime_type: r.mime_type,
    size_bytes: r.size_bytes,
    page_count: r.page_count,
    char_count: len,
    text_truncated: len !== null && len >= STORED_TEXT_CAP,
    created_at: r.created_at,
  };
}

/** A missing column/table (migration not applied) is UNAVAILABLE, never an empty list. */
function classify(error: { code?: string; message?: string } | null | undefined): StoreResult<never> {
  const code = String(error?.code || '');
  const msg = String(error?.message || 'unknown error');
  const missing = ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /does not exist|could not find the (table|column)/i.test(msg);
  return { ok: false, reason: missing ? 'unavailable' : 'error', message: msg.slice(0, 200) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoped(q: any, scope: { sessionId: string; ownerEmail: string }) {
  return q
    .eq('user_email', scope.ownerEmail)
    .eq('chat_session_id', scope.sessionId)
    .eq('doc_class', 'reference')
    .is('archived_at', null);
}

export async function countSessionDocuments(db: ChatDocsDb, scope: { sessionId: string; ownerEmail: string }): Promise<StoreResult<number>> {
  const { count, error } = await scoped(db.from(VAULT_DOCS_TABLE).select('id', { count: 'exact', head: true }), scope);
  if (error) return classify(error);
  // A null count is UNKNOWN (CLAUDE.md bug rule #11), never 0.
  if (typeof count !== 'number') return { ok: false, reason: 'error', message: 'count unavailable' };
  return { ok: true, value: count };
}

/** Metadata only (no text is read, so char_count / text_truncated are unknown here). */
export async function listChatDocuments(db: ChatDocsDb, scope: { sessionId: string; ownerEmail: string }): Promise<StoreResult<ChatDocumentMeta[]>> {
  const { data, error } = await scoped(db.from(VAULT_DOCS_TABLE).select(META_COLUMNS), scope)
    .order('created_at', { ascending: true })
    .limit(MAX_DOCS_PER_SESSION);
  if (error) return classify(error);
  return { ok: true, value: ((data as Row[]) || []).map(toMeta) };
}

export async function loadChatDocumentTexts(db: ChatDocsDb, scope: { sessionId: string; ownerEmail: string }): Promise<StoreResult<ChatDocumentText[]>> {
  const { data, error } = await scoped(db.from(VAULT_DOCS_TABLE).select(`${META_COLUMNS}, extracted_text`), scope)
    .order('created_at', { ascending: true })
    .limit(MAX_DOCS_PER_SESSION);
  if (error) return classify(error);
  return { ok: true, value: ((data as Row[]) || []).map((r) => ({ ...toMeta(r), extracted_text: r.extracted_text ?? null })) };
}

/**
 * Removes one document from its conversation by ARCHIVING it (archived_at), the same soft delete the
 * Vault screen uses. The blob stays in the private bucket: hard delete (blob + backup + row) waits for
 * Eric's retention ruling. Archiving nothing (wrong id/session/owner) is `false`.
 */
export async function archiveChatDocument(db: ChatDocsDb, scope: { id: string; sessionId: string; ownerEmail: string }): Promise<StoreResult<boolean>> {
  const { count, error } = await scoped(db.from(VAULT_DOCS_TABLE).update({ archived_at: new Date().toISOString() }, { count: 'exact' }).eq('id', scope.id), scope);
  if (error) return classify(error);
  // INT-005: read the exact affected count, never a RETURNING payload. A null count is unknown.
  if (typeof count !== 'number') return { ok: false, reason: 'error', message: 'archive count unavailable' };
  return { ok: true, value: count > 0 };
}

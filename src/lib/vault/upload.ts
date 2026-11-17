/**
 * The ONE place a file enters the Vault (user_boilerplate_docs + private bucket
 * 'vault-assets'). Used by the Vault upload route and the Ask Mindy upload route, so
 * both get the same auth scope, extraction, marking refusal and storage rules.
 *
 * Order matters and is the whole point:
 *   1. size + type check            (cheap, before anything is read)
 *   2. acting scope, STRICT         (whose Vault? refuse if it can't be confirmed)
 *   3. extract text IN MEMORY       (nothing stored yet)
 *   4. classification / CUI check   (refuse → NOTHING stored: no blob, no row)
 *   5. upload blob to the PRIVATE bucket
 *   6. insert row; if that fails, delete the blob so no orphan is left behind
 *
 * The caller authenticates first (strong auth) and passes the VERIFIED email. This
 * helper never trusts an email from the request body.
 *
 * Scope is stricter than resolveActiveWorkspace on purpose. That resolver silently
 * falls back to the caller's own workspace when an x-active-workspace header is not
 * authorized (or when its lookup errors). For a READ that is harmless; for a WRITE it
 * puts a coach's client file into the coach's own Vault. So: header present but not
 * confirmed as an authorized client → refuse. Never write to a different account
 * than the one the user is looking at.
 */
import { resolveChatActingScope, type ChatActingScope } from '@/lib/chat/chat-acting-scope';
import { extractPdf, extractDocx, extractTxt } from '@/lib/sam/pdf-extract';
import { detectProhibitedMarkings, markingRefusalMessage, type ProhibitedMarkingKind } from './marking-detect';
import type { DocClass } from './doc-class';

export const VAULT_BUCKET = 'vault-assets';
export const VAULT_MAX_BYTES = 20 * 1024 * 1024; // 20 MB — unchanged from the Vault route
const MAX_STORED_TEXT = 500_000;

type Ext = 'pdf' | 'docx' | 'txt';
const TYPES: Record<Ext, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

export function detectUploadType(filename: string): { ext: Ext; mime: string } | null {
  const lower = filename.toLowerCase();
  for (const ext of Object.keys(TYPES) as Ext[]) {
    if (lower.endsWith(`.${ext}`)) return { ext, mime: TYPES[ext] };
  }
  return null;
}

/** Storage key segment: no path separators, no traversal, bounded length. */
export function safeStorageName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() || 'file';
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\.{2,}/g, '.').trim();
  return (cleaned || 'file').slice(-120);
}

// Structural subsets of the Supabase client, so tests can pass stubs.
export interface VaultStorage {
  listBuckets(): Promise<{ data: { name: string }[] | null; error?: unknown }>;
  createBucket(name: string, opts: { public: boolean }): Promise<{ error?: { message?: string } | null }>;
  from(bucket: string): {
    upload(path: string, body: Buffer, opts: { contentType: string; upsert: boolean }): Promise<{ error: { message?: string } | null }>;
    remove(paths: string[]): Promise<{ error: { message?: string } | null }>;
  };
}
export interface VaultDb {
  from(table: string): {
    insert(row: Record<string, unknown>): {
      select(cols?: string): { maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }> };
    };
  };
}

export interface VaultUploadInput {
  /** Verified email from strong auth. */
  callerEmail: string;
  /** Request headers (x-active-workspace). */
  request: { headers: { get(name: string): string | null } };
  file: { name: string; size: number; buffer: Buffer };
  docClass: DocClass;
  source: 'vault' | 'ask_mindy';
  docType?: string;
  chatSessionId?: string | null;
  noticeId?: string | null;
}

export interface VaultUploadDeps {
  db: VaultDb;
  storage: VaultStorage;
  resolveScope?: (email: string, request: VaultUploadInput['request']) => Promise<ChatActingScope>;
  now?: () => number;
}

export type VaultUploadResult =
  | { ok: true; document: Record<string, unknown>; ownerEmail: string; workspace: 'own' | 'client' }
  | {
      ok: false;
      status: 400 | 409 | 413 | 415 | 422 | 500;
      code:
        | 'too_large' | 'unsupported_type' | 'empty_file' | 'workspace_unconfirmed'
        | 'unreadable' | 'prohibited_marking' | 'storage_failed' | 'insert_failed';
      message: string;
      markingKind?: ProhibitedMarkingKind;
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whose Vault does this write go to? Returns null when it can't be confirmed.
 * Exported for the download/revise/delete paths, which must use the same answer.
 */
export async function resolveVaultWriteOwner(
  callerEmail: string,
  request: VaultUploadInput['request'],
  resolveScope: NonNullable<VaultUploadDeps['resolveScope']> = resolveChatActingScope,
): Promise<{ ownerEmail: string; workspace: 'own' | 'client' } | null> {
  const scope = await resolveScope(callerEmail, request);
  if (scope.kind === 'unavailable') return null;
  if (scope.kind === 'client') return { ownerEmail: scope.vaultEmail, workspace: 'client' };
  // 'own' — but if the user ASKED for a workspace (header present) and it did not
  // resolve to that client, the write would land in the wrong account. Refuse.
  if (request.headers.get('x-active-workspace')) return null;
  return { ownerEmail: scope.email, workspace: 'own' };
}

async function extractText(ext: Ext, buffer: Buffer): Promise<{ text: string; pageCount: number | null }> {
  if (ext === 'pdf') {
    const r = await extractPdf(buffer);
    return { text: r.text || '', pageCount: r.pageCount ?? null };
  }
  if (ext === 'docx') return { text: (await extractDocx(buffer)).text || '', pageCount: null };
  return { text: extractTxt(buffer).text || '', pageCount: null };
}

export async function saveVaultUpload(input: VaultUploadInput, deps: VaultUploadDeps): Promise<VaultUploadResult> {
  const { file } = input;

  // 1) Size + type.
  if (file.size > VAULT_MAX_BYTES || file.buffer.length > VAULT_MAX_BYTES) {
    return { ok: false, status: 413, code: 'too_large', message: `File too large (max ${VAULT_MAX_BYTES / 1024 / 1024} MB).` };
  }
  if (file.buffer.length === 0) {
    return { ok: false, status: 400, code: 'empty_file', message: 'The file is empty.' };
  }
  const type = detectUploadType(file.name);
  if (!type) {
    return {
      ok: false, status: 415, code: 'unsupported_type',
      message: 'Upload a PDF, Word (.docx) or text (.txt) file. Older .doc files and other formats cannot be read.',
    };
  }

  // 2) Strict acting scope.
  const owner = await resolveVaultWriteOwner(input.callerEmail, input.request, deps.resolveScope);
  if (!owner) {
    return {
      ok: false, status: 409, code: 'workspace_unconfirmed',
      message: "The workspace you're working in couldn't be confirmed, so nothing was saved. Refresh and try again.",
    };
  }

  // 3) Extract in memory. A file we cannot read is a file we cannot check for
  //    markings, so it is refused rather than stored unchecked.
  let text = '';
  let pageCount: number | null = null;
  try {
    ({ text, pageCount } = await extractText(type.ext, file.buffer));
  } catch {
    text = '';
  }
  if (text.trim().length === 0) {
    return {
      ok: false, status: 422, code: 'unreadable',
      message: "Mindy couldn't read any text in this file (it may be a scanned image), so it couldn't be checked and wasn't saved. Upload a text-based PDF, Word or text file.",
    };
  }

  // 4) Classification / CUI. Refuse before ANY write.
  const verdict = detectProhibitedMarkings(text);
  if (verdict.blocked && verdict.kind) {
    console.warn(`[vault/upload] refused ${verdict.kind} marking (source=${input.source}, class=${input.docClass})`);
    return { ok: false, status: 422, code: 'prohibited_marking', markingKind: verdict.kind, message: markingRefusalMessage(verdict.kind) };
  }

  // 5) Private bucket only.
  const { data: buckets } = await deps.storage.listBuckets();
  if (!buckets?.find((b) => b.name === VAULT_BUCKET)) {
    await deps.storage.createBucket(VAULT_BUCKET, { public: false });
  }
  const now = (deps.now ?? Date.now)();
  const storagePath = `${owner.ownerEmail}/${now}-${safeStorageName(file.name)}`;
  const { error: uploadErr } = await deps.storage.from(VAULT_BUCKET).upload(storagePath, file.buffer, { contentType: type.mime, upsert: false });
  if (uploadErr) {
    return { ok: false, status: 500, code: 'storage_failed', message: 'The file could not be saved. Nothing was stored. Try again.' };
  }

  // 6) Row. The new columns (migration 20261117_vault_doc_class.sql) are written ONLY
  //    for non-company rows: a company upload from the Vault screen must keep working
  //    before that migration is applied, and NULL doc_class already means 'company'.
  const row: Record<string, unknown> = {
    user_email: owner.ownerEmail,
    doc_type: input.docType || 'other',
    original_filename: file.name.slice(0, 255),
    mime_type: type.mime,
    size_bytes: file.buffer.length,
    storage_path: storagePath,
    extracted_text: text.length > MAX_STORED_TEXT ? text.slice(0, MAX_STORED_TEXT) : text,
    page_count: pageCount,
    parse_status: 'parsed',
    parse_error: null,
  };
  if (input.docClass !== 'company' || input.source !== 'vault') {
    row.doc_class = input.docClass;
    row.source = input.source;
    if (input.chatSessionId && UUID_RE.test(input.chatSessionId)) row.chat_session_id = input.chatSessionId;
    if (input.noticeId) row.notice_id = String(input.noticeId).slice(0, 64);
    row.version = 1;
  }
  const { data, error: insertErr } = await deps.db.from('user_boilerplate_docs').insert(row).select().maybeSingle();
  if (insertErr || !data) {
    const { error: rmErr } = await deps.storage.from(VAULT_BUCKET).remove([storagePath]);
    if (rmErr) console.error('[vault/upload] orphan blob left after insert failure:', storagePath, rmErr.message);
    return { ok: false, status: 500, code: 'insert_failed', message: 'The file could not be saved. Nothing was stored. Try again.' };
  }
  return { ok: true, document: data, ownerEmail: owner.ownerEmail, workspace: owner.workspace };
}

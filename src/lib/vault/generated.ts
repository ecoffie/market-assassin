/**
 * Persist a file Mindy GENERATED as a Vault row (doc_class='generated') + the rendered bytes in the
 * private 'vault-assets' bucket. The document engine's renderer (#2107, src/lib/documents) stays pure:
 * the caller renders, then hands the bytes here. Nothing in this module imports the renderer.
 *
 * Versions: a revision is a NEW row with parent_id = the version it revises and version = parent + 1.
 * Nothing is ever overwritten. The parent must be a generated document owned by the SAME acting-scope
 * owner (never another account's chain), and not archived.
 *
 * Order (same contract as saveVaultUpload): strict scope → validate → parent/child owner check →
 * blob → row; the blob is removed if the row insert fails.
 */
import { resolveVaultWriteOwner, safeStorageName, VAULT_BUCKET, type VaultDb, type VaultStorage, type VaultUploadInput } from './upload';
import type { ChatActingScope } from '@/lib/chat/chat-acting-scope';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GENERATED_MAX_BYTES = 20 * 1024 * 1024;
const MIME: Record<'pdf' | 'docx', string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** The reads this module needs beyond insert (parent lookup). */
export interface GeneratedDb extends VaultDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export interface SaveGeneratedInput {
  callerEmail: string;
  request: VaultUploadInput['request'];
  format: 'pdf' | 'docx';
  filename: string;
  bytes: Buffer;
  /** The DocModel the file was rendered from (stored so a revision edits the model, not the file). */
  docModel: unknown;
  /** Plain text of the document, so it can be found and excerpted later. */
  text?: string;
  /** The generated document this one revises (omit for a first version). */
  parentId?: string | null;
  /** Vault documents the content was built from. Kept only if they belong to the same owner. */
  sourceDocIds?: string[];
  chatSessionId?: string | null;
  noticeId?: string | null;
}

export type SaveGeneratedResult =
  | { ok: true; document: Record<string, unknown>; version: number; ownerEmail: string }
  | { ok: false; status: 400 | 404 | 409 | 413 | 500; code: 'invalid' | 'too_large' | 'workspace_unconfirmed' | 'parent_not_found' | 'storage_failed' | 'insert_failed'; message: string };

export async function saveGeneratedDocument(
  input: SaveGeneratedInput,
  deps: { db: GeneratedDb; storage: VaultStorage; resolveScope?: (email: string, request: VaultUploadInput['request']) => Promise<ChatActingScope>; now?: () => number },
): Promise<SaveGeneratedResult> {
  if (input.format !== 'pdf' && input.format !== 'docx') return { ok: false, status: 400, code: 'invalid', message: 'format must be pdf or docx' };
  if (!input.bytes?.length) return { ok: false, status: 400, code: 'invalid', message: 'empty file' };
  if (input.bytes.length > GENERATED_MAX_BYTES) return { ok: false, status: 413, code: 'too_large', message: 'generated file too large' };
  if (input.docModel === undefined || input.docModel === null || typeof input.docModel !== 'object') {
    return { ok: false, status: 400, code: 'invalid', message: 'docModel required' };
  }

  const owner = await resolveVaultWriteOwner(input.callerEmail, input.request, deps.resolveScope);
  if (!owner) {
    return { ok: false, status: 409, code: 'workspace_unconfirmed', message: "The workspace you're working in couldn't be confirmed, so nothing was saved. Refresh and try again." };
  }

  // Parent/child owner check: the parent must be this owner's, generated, not archived.
  let version = 1;
  let parentId: string | null = null;
  if (input.parentId) {
    if (!UUID_RE.test(input.parentId)) return { ok: false, status: 404, code: 'parent_not_found', message: 'The document to revise was not found.' };
    const { data: parent, error } = await deps.db.from('user_boilerplate_docs')
      .select('id, version, doc_class')
      .eq('id', input.parentId).eq('user_email', owner.ownerEmail).is('archived_at', null).maybeSingle();
    if (error) return { ok: false, status: 500, code: 'insert_failed', message: 'Could not check the document to revise.' };
    if (!parent || parent.doc_class !== 'generated') return { ok: false, status: 404, code: 'parent_not_found', message: 'The document to revise was not found.' };
    parentId = parent.id;
    version = (typeof parent.version === 'number' && parent.version >= 1 ? parent.version : 1) + 1;
  }

  // Source documents: keep only ids that belong to this owner (never cite another account's file).
  let sourceDocIds: string[] = [];
  const requested = Array.from(new Set((input.sourceDocIds ?? []).filter((id) => UUID_RE.test(id)))).slice(0, 50);
  if (requested.length) {
    const { data: owned, error } = await deps.db.from('user_boilerplate_docs').select('id').eq('user_email', owner.ownerEmail).in('id', requested);
    if (error) return { ok: false, status: 500, code: 'insert_failed', message: 'Could not check the source documents.' };
    const ownedIds = new Set(((owned as { id: string }[]) || []).map((r) => r.id));
    sourceDocIds = requested.filter((id) => ownedIds.has(id));
  }

  // The conversation link is kept only if that conversation belongs to the caller.
  let chatSessionId: string | null = null;
  if (input.chatSessionId && UUID_RE.test(input.chatSessionId)) {
    const { data: sess, error } = await deps.db.from('mindy_chat_sessions').select('user_email').eq('id', input.chatSessionId).maybeSingle();
    if (!error && String(sess?.user_email || '').trim().toLowerCase() === input.callerEmail.trim().toLowerCase()) chatSessionId = input.chatSessionId;
  }

  const { data: buckets } = await deps.storage.listBuckets();
  if (!buckets?.find((b) => b.name === VAULT_BUCKET)) await deps.storage.createBucket(VAULT_BUCKET, { public: false });
  const base = safeStorageName(input.filename.replace(/\.(pdf|docx)$/i, '')) || 'Mindy-document';
  const filename = `${base}.${input.format}`;
  const storagePath = `${owner.ownerEmail}/generated/${(deps.now ?? Date.now)()}-v${version}-${filename}`;
  const { error: upErr } = await deps.storage.from(VAULT_BUCKET).upload(storagePath, input.bytes, { contentType: MIME[input.format], upsert: false });
  if (upErr) return { ok: false, status: 500, code: 'storage_failed', message: 'The file could not be saved. Try again.' };

  const text = (input.text ?? '').slice(0, 500_000);
  const row: Record<string, unknown> = {
    user_email: owner.ownerEmail,
    doc_type: 'other',
    original_filename: filename,
    mime_type: MIME[input.format],
    size_bytes: input.bytes.length,
    storage_path: storagePath,
    extracted_text: text || null,
    parse_status: 'parsed',
    doc_class: 'generated',
    source: 'ask_mindy',
    version,
    parent_id: parentId,
    doc_model: input.docModel,
    source_doc_ids: sourceDocIds.length ? sourceDocIds : null,
    ...(chatSessionId ? { chat_session_id: chatSessionId } : {}),
    ...(input.noticeId ? { notice_id: String(input.noticeId).slice(0, 64) } : {}),
  };
  // A concurrent revision of the same parent may have taken this version number: the unique
  // (parent_id, version) index refuses the duplicate (23505). Re-read the latest sibling version and
  // retry, so two revisions never share a number and neither is lost.
  let { data, error: insErr } = await deps.db.from('user_boilerplate_docs').insert(row).select().maybeSingle();
  for (let attempt = 0; attempt < 3 && parentId && insErr && String((insErr as { code?: string }).code) === '23505'; attempt++) {
    const { data: sibs, error: sibErr } = await deps.db.from('user_boilerplate_docs')
      .select('version').eq('parent_id', parentId).order('version', { ascending: false }).limit(1);
    if (sibErr) break;
    const latest = Number((sibs as { version?: number }[] | null)?.[0]?.version ?? 0);
    version = Math.max(version, latest + 1);
    row.version = version;
    ({ data, error: insErr } = await deps.db.from('user_boilerplate_docs').insert(row).select().maybeSingle());
  }
  if (insErr || !data) {
    const { error: rmErr } = await deps.storage.from(VAULT_BUCKET).remove([storagePath]);
    if (rmErr) console.error('[vault/generated] orphan blob left after insert failure:', storagePath, rmErr.message);
    return { ok: false, status: 500, code: 'insert_failed', message: 'The file could not be saved. Try again.' };
  }
  return { ok: true, document: data, version, ownerEmail: owner.ownerEmail };
}

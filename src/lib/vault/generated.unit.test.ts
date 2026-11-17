/**
 * saveGeneratedDocument: generated files become doc_class='generated' Vault rows; a revision is a NEW
 * row (version+1, parent_id) and never overwrites; the parent and the source documents must belong to
 * the same acting-scope owner; strict scope; private bucket; blob removed if the row fails.
 */
import { describe, it, expect, vi } from 'vitest';
import { saveGeneratedDocument, type SaveGeneratedInput } from './generated';
import type { ChatActingScope } from '@/lib/chat/chat-acting-scope';

const P1 = '11111111-1111-4111-8111-111111111111';
const SRC_OWN = '22222222-2222-4222-8222-222222222222';
const SRC_OTHER = '33333333-3333-4333-8333-333333333333';
const SID = '0b0b0b0b-1111-4222-8333-444444444444';

type Row = Record<string, unknown>;
function world(rows: Row[], opts: { insertError?: boolean; sessions?: Record<string, string> } = {}) {
  const inserts: Row[] = [];
  const updates: Row[] = [];
  const blobs: string[] = [];
  const removed: string[][] = [];
  const db = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      const pick = () => {
        if (table === 'mindy_chat_sessions') {
          const id = filters.find(([, k]) => k === 'id')?.[2] as string;
          return opts.sessions?.[id] ? [{ user_email: opts.sessions[id] }] : [];
        }
        return rows.filter((r) => filters.every(([op, k, v]) => (op === 'eq' ? r[k] === v : op === 'is' ? r[k] == null : op === 'in' ? (v as unknown[]).includes(r[k]) : true)));
      };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push(['eq', k, v]); return q; },
        is: (k: string, v: unknown) => { filters.push(['is', k, v]); return q; },
        in: (k: string, v: unknown) => { filters.push(['in', k, v]); return q; },
        update: (r: Row) => { updates.push(r); return q; },
        maybeSingle: async () => ({ data: pick()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: pick(), error: null }),
        insert: (r: Row) => { inserts.push(r); return { select: () => ({ maybeSingle: async () => (opts.insertError ? { data: null, error: { message: 'x' } } : { data: { id: 'new', ...r }, error: null }) }) }; },
      };
      return q;
    },
  };
  const storage = {
    listBuckets: vi.fn(async () => ({ data: [] as { name: string }[] })),
    createBucket: vi.fn(async () => ({ error: null })),
    from: () => ({
      upload: async (p: string) => { blobs.push(p); return { error: null }; },
      remove: async (p: string[]) => { removed.push(p); return { error: null }; },
    }),
  };
  return { db, storage, inserts, updates, blobs, removed };
}
const own = async (email: string): Promise<ChatActingScope> => ({ kind: 'own', email });
const headers = (h: Record<string, string> = {}) => ({ headers: { get: (n: string) => h[n] ?? null } });
const input = (over: Partial<SaveGeneratedInput> = {}): SaveGeneratedInput => ({
  callerEmail: 'o@x.com', request: headers(), format: 'docx', filename: 'VetCert Action Plan', bytes: Buffer.from('PK...'),
  docModel: { schema: 'mindy.doc/1', title: 'VetCert Action Plan' }, text: 'Action plan text', ...over,
});

describe('saveGeneratedDocument', () => {
  it('first version: generated row v1, private bucket, model + text stored', async () => {
    const w = world([]);
    const r = await saveGeneratedDocument(input(), { db: w.db, storage: w.storage, resolveScope: own, now: () => 7 });
    expect(r).toMatchObject({ ok: true, version: 1 });
    expect(w.inserts[0]).toMatchObject({ user_email: 'o@x.com', doc_class: 'generated', source: 'ask_mindy', version: 1, parent_id: null, original_filename: 'VetCert Action Plan.docx', extracted_text: 'Action plan text' });
    expect(w.inserts[0].doc_model).toEqual({ schema: 'mindy.doc/1', title: 'VetCert Action Plan' });
    expect(w.blobs).toEqual(['o@x.com/generated/7-v1-VetCert Action Plan.docx']);
    expect(w.storage.createBucket).toHaveBeenCalledWith('vault-assets', { public: false });
  });

  it('revision: NEW row, version+1, parent_id set; the parent is never updated', async () => {
    const w = world([{ id: P1, user_email: 'o@x.com', doc_class: 'generated', version: 2, archived_at: null }]);
    const r = await saveGeneratedDocument(input({ parentId: P1 }), { db: w.db, storage: w.storage, resolveScope: own });
    expect(r).toMatchObject({ ok: true, version: 3 });
    expect(w.inserts[0]).toMatchObject({ parent_id: P1, version: 3 });
    expect(w.updates).toEqual([]);
  });

  it('parent owned by ANOTHER account → 404, nothing stored', async () => {
    const w = world([{ id: P1, user_email: 'someone@else.com', doc_class: 'generated', version: 1, archived_at: null }]);
    const r = await saveGeneratedDocument(input({ parentId: P1 }), { db: w.db, storage: w.storage, resolveScope: own });
    expect(r).toMatchObject({ ok: false, code: 'parent_not_found', status: 404 });
    expect(w.blobs).toEqual([]); expect(w.inserts).toEqual([]);
  });

  it('parent that is not a generated document (an upload) → 404', async () => {
    const w = world([{ id: P1, user_email: 'o@x.com', doc_class: 'reference', version: 1, archived_at: null }]);
    expect(await saveGeneratedDocument(input({ parentId: P1 }), { db: w.db, storage: w.storage, resolveScope: own })).toMatchObject({ ok: false, code: 'parent_not_found' });
  });

  it('source documents of another account are dropped, own ones kept', async () => {
    const w = world([{ id: SRC_OWN, user_email: 'o@x.com' }, { id: SRC_OTHER, user_email: 'x@y.com' }]);
    await saveGeneratedDocument(input({ sourceDocIds: [SRC_OWN, SRC_OTHER, 'not-a-uuid'] }), { db: w.db, storage: w.storage, resolveScope: own });
    expect(w.inserts[0].source_doc_ids).toEqual([SRC_OWN]);
  });

  it('conversation link kept only when the conversation is the caller\'s', async () => {
    const mine = world([], { sessions: { [SID]: 'o@x.com' } });
    await saveGeneratedDocument(input({ chatSessionId: SID }), { db: mine.db, storage: mine.storage, resolveScope: own });
    expect(mine.inserts[0].chat_session_id).toBe(SID);
    const theirs = world([], { sessions: { [SID]: 'other@x.com' } });
    await saveGeneratedDocument(input({ chatSessionId: SID }), { db: theirs.db, storage: theirs.storage, resolveScope: own });
    expect(theirs.inserts[0]).not.toHaveProperty('chat_session_id');
  });

  it('strict scope: unauthorized header / resolver error → 409, nothing stored', async () => {
    const w = world([]);
    expect(await saveGeneratedDocument(input({ request: headers({ 'x-active-workspace': 'ws-x' }) }), { db: w.db, storage: w.storage, resolveScope: own })).toMatchObject({ ok: false, status: 409 });
    const unavailable = async (email: string): Promise<ChatActingScope> => ({ kind: 'unavailable', email });
    expect(await saveGeneratedDocument(input({ request: headers({ 'x-active-workspace': 'ws-1' }) }), { db: w.db, storage: w.storage, resolveScope: unavailable })).toMatchObject({ ok: false, status: 409 });
    expect(w.blobs).toEqual([]);
  });

  it('authorized coach → saved in the CLIENT Vault', async () => {
    const client = async (email: string): Promise<ChatActingScope> => ({ kind: 'client', email, workspaceId: 'ws', vaultEmail: 'ws@clients.getmindy.ai' });
    const w = world([]);
    await saveGeneratedDocument(input({ request: headers({ 'x-active-workspace': 'ws' }) }), { db: w.db, storage: w.storage, resolveScope: client });
    expect(w.inserts[0].user_email).toBe('ws@clients.getmindy.ai');
    expect(w.blobs[0].startsWith('ws@clients.getmindy.ai/generated/')).toBe(true);
  });

  it('row insert fails → blob removed', async () => {
    const w = world([], { insertError: true });
    const r = await saveGeneratedDocument(input(), { db: w.db, storage: w.storage, resolveScope: own, now: () => 1 });
    expect(r).toMatchObject({ ok: false, code: 'insert_failed' });
    expect(w.removed).toEqual([['o@x.com/generated/1-v1-VetCert Action Plan.docx']]);
  });

  it('validation: format, empty bytes, missing model', async () => {
    const w = world([]);
    for (const bad of [input({ format: 'xlsx' as never }), input({ bytes: Buffer.alloc(0) }), input({ docModel: null })]) {
      expect((await saveGeneratedDocument(bad, { db: w.db, storage: w.storage, resolveScope: own })).ok).toBe(false);
    }
    expect(w.blobs).toEqual([]);
  });
});

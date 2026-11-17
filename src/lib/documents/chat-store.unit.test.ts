/**
 * Ask Mindy conversation documents, read from the Vault (user_boilerplate_docs, doc_class='reference').
 * Proves: every read/count/archive filters on owner + conversation + class + not-archived; a missing
 * column (migration not applied) is UNAVAILABLE, never an empty list; a null count is unknown; archiving
 * nothing is false; the flag is off unless exactly "true".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isVaultChatDocumentsEnabled, countSessionDocuments, listChatDocuments, loadChatDocumentTexts, archiveChatDocument,
} from './chat-store';

type Call = { table: string; ops: Array<[string, unknown[]]> };
function fakeDb(result: Record<string, unknown>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'order', 'limit', 'update']) {
        q[m] = (...args: unknown[]) => { call.ops.push([m, args]); return q; };
      }
      q.then = (resolve: (v: unknown) => void) => resolve(result);
      return q;
    },
  };
  return { db, calls };
}
const scope = { sessionId: '0b0b0b0b-1111-4222-8333-444444444444', ownerEmail: 'owner@x.com' };
const eqs = (c: Call) => c.ops.filter(([m]) => m === 'eq').map(([, a]) => a);

afterEach(() => vi.unstubAllEnvs());

describe('Vault-backed conversation documents', () => {
  it('flag is off unless exactly "true"', () => {
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', '');
    expect(isVaultChatDocumentsEnabled()).toBe(false);
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', '1');
    expect(isVaultChatDocumentsEnabled()).toBe(false);
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', 'TRUE');
    expect(isVaultChatDocumentsEnabled()).toBe(true);
  });

  it('every read, count and archive filters on owner + conversation + reference class + not archived', async () => {
    for (const run of [
      (db: never) => countSessionDocuments(db, scope),
      (db: never) => listChatDocuments(db, scope),
      (db: never) => loadChatDocumentTexts(db, scope),
      (db: never) => archiveChatDocument(db, { ...scope, id: 'd1' }),
    ]) {
      const { db, calls } = fakeDb({ data: [], count: 0, error: null });
      await run(db as never);
      expect(calls[0].table).toBe('user_boilerplate_docs');
      const e = eqs(calls[0]);
      expect(e).toContainEqual(['user_email', 'owner@x.com']);
      expect(e).toContainEqual(['chat_session_id', scope.sessionId]);
      expect(e).toContainEqual(['doc_class', 'reference']);
      expect(calls[0].ops).toContainEqual(['is', ['archived_at', null]]);
    }
  });

  it('list reads metadata only (no extracted text); load returns text', async () => {
    const row = { id: 'd1', original_filename: 'rfp.pdf', mime_type: 'application/pdf', size_bytes: 10, page_count: 2, created_at: 't', extracted_text: 'Section L' };
    const l = fakeDb({ data: [row], error: null });
    await listChatDocuments(l.db as never, scope);
    expect(String(l.calls[0].ops.find(([m]) => m === 'select')?.[1][0])).not.toContain('extracted_text');
    const t = fakeDb({ data: [row], error: null });
    const r = await loadChatDocumentTexts(t.db as never, scope);
    expect(r.ok && r.value[0]).toMatchObject({ id: 'd1', filename: 'rfp.pdf', extracted_text: 'Section L', char_count: 9, text_truncated: false });
  });

  it('a missing column/table (migration not applied) is UNAVAILABLE, never an empty list', async () => {
    for (const error of [{ code: '42703', message: 'column user_boilerplate_docs.doc_class does not exist' }, { code: 'PGRST204', message: "Could not find the 'chat_session_id' column" }]) {
      const { db } = fakeDb({ data: null, error });
      const r = await listChatDocuments(db as never, scope);
      expect(r).toMatchObject({ ok: false, reason: 'unavailable' });
    }
    const { db } = fakeDb({ data: null, error: { code: '57014', message: 'statement timeout' } });
    expect(await loadChatDocumentTexts(db as never, scope)).toMatchObject({ ok: false, reason: 'error' });
  });

  it('a null count is unknown, never 0', async () => {
    const { db } = fakeDb({ count: null, error: null });
    expect(await countSessionDocuments(db as never, scope)).toMatchObject({ ok: false, reason: 'error' });
  });

  it('archive is a soft delete (archived_at), and archiving nothing is false, not success', async () => {
    const hit = fakeDb({ data: [{ id: 'd1' }], error: null });
    expect(await archiveChatDocument(hit.db as never, { ...scope, id: 'd1' })).toEqual({ ok: true, value: true });
    const upd = hit.calls[0].ops.find(([m]) => m === 'update')?.[1][0] as Record<string, unknown>;
    expect(Object.keys(upd)).toEqual(['archived_at']);
    const miss = fakeDb({ data: [], error: null });
    expect(await archiveChatDocument(miss.db as never, { ...scope, id: 'd2' })).toEqual({ ok: true, value: false });
  });
});

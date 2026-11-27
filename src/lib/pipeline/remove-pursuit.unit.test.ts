import { describe, it, expect } from 'vitest';
import { removeOwnedPursuit, pgrstQuote } from './remove-pursuit';

function db(rows: Array<{ id: string; title: string; stage: string | null }>, opts: { findErr?: string } = {}) {
  const calls: Array<{ op: string; col?: string; val?: unknown }> = [];
  const make = (op: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.delete = () => { calls.push({ op: 'delete' }); return q; };
    q.eq = (col: string, val: unknown) => { calls.push({ op: `${op}.eq`, col, val }); return q; };
    q.or = (val: string) => { calls.push({ op: `${op}.or`, val }); return op === 'delete' ? Promise.resolve({ error: null }) : q; };
    q.limit = async () => ({ data: opts.findErr ? null : rows, error: opts.findErr ? { message: opts.findErr } : null });
    return q;
  };
  let n = 0;
  return { calls, client: { from: () => make(n++ === 0 ? 'find' : 'delete') } as never };
}
const OWNER = { workspaceId: 'ws-1', email: 'Pat@Example.com' };

describe('removeOwnedPursuit', () => {
  it('scopes the find AND the delete to the owner (workspace OR lowercased email)', async () => {
    const d = db([{ id: 'p1', title: 'Roofing', stage: 'tracking' }]);
    const r = await removeOwnedPursuit(d.client, OWNER, { noticeId: 'abc' });
    expect(r).toEqual({ kind: 'removed', row: { id: 'p1', title: 'Roofing', stage: 'tracking' } });
    const ors = d.calls.filter((c) => c.op.endsWith('.or')).map((c) => c.val);
    expect(ors).toEqual(['workspace_id.eq."ws-1",user_email.eq."pat@example.com"', 'workspace_id.eq."ws-1",user_email.eq."pat@example.com"']);
    expect(d.calls).toContainEqual({ op: 'find.eq', col: 'notice_id', val: 'abc' });
    expect(d.calls).toContainEqual({ op: 'delete.eq', col: 'id', val: 'p1' });
  });
  it('nothing owned → not_found, no delete', async () => {
    const d = db([]);
    expect(await removeOwnedPursuit(d.client, OWNER, { id: 'x' })).toEqual({ kind: 'not_found' });
    expect(d.calls.some((c) => c.op === 'delete')).toBe(false);
  });
  it('two rows for one notice → refuse, never guess', async () => {
    const d = db([{ id: 'a', title: 't', stage: null }, { id: 'b', title: 't', stage: null }]);
    expect((await removeOwnedPursuit(d.client, OWNER, { noticeId: 'n' })).kind).toBe('error');
    expect(d.calls.some((c) => c.op === 'delete')).toBe(false);
  });
  it('a read error is an error, never not_found', async () => {
    const d = db([], { findErr: 'boom' });
    expect(await removeOwnedPursuit(d.client, OWNER, { id: 'x' })).toEqual({ kind: 'error', message: 'boom' });
  });
});

describe('pgrstQuote', () => {
  it('an email with reserved characters stays one quoted value', () => {
    expect(pgrstQuote('a,b)or(x.eq.1@y.com')).toBe('"a,b)or(x.eq.1@y.com"');
    expect(pgrstQuote('q"uote\\x')).toBe('"q\\"uote\\\\x"');
  });
});

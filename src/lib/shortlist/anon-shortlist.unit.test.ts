/**
 * Anonymous opportunity shortlist.
 *
 * Map funnel, production 30 days: 2,021 users opened a listing, 53 started a
 * pursuit (2.6%). 96% of map users (8,254 of 8,583) are anonymous, and
 * savePursuit calls requireSignIn — a permission failure, not a comprehension one.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isAnonId, addToAnonShortlist, claimAnonShortlist, ANON_SHORTLIST_SOURCE,
} from './anon-shortlist';

const ANON = 'anon:57b9d751-9451-40c8-9f3e-2b1c4d5e6f70';

function insertDb(error: { code?: string; message: string } | null = null) {
  const captured: { row?: Record<string, unknown> } = {};
  const q: Record<string, unknown> = {};
  q.insert = (row: Record<string, unknown>) => { captured.row = row; return Promise.resolve({ error }); };
  return { db: { from: vi.fn(() => q) } as never, captured };
}

describe('anon id discipline', () => {
  it('accepts a well-formed id', () => expect(isAnonId(ANON)).toBe(true));
  it('rejects anything else', () => {
    for (const b of ['', 'anon:', 'anon:123', 'x@y.com', null]) expect(isAnonId(b as string)).toBe(false);
  });
});

describe('saving a listing', () => {
  it('stores the anon owner and tags the row as an anonymous shortlist entry', async () => {
    const { db, captured } = insertDb();
    const r = await addToAnonShortlist(db, { anonId: ANON, noticeId: 'n1', title: 'T', agency: 'Navy' });
    expect(r).toEqual({ ok: true, saved: true, duplicate: false });
    expect(captured.row!.user_email).toBe(ANON);
    expect(captured.row!.source).toBe(ANON_SHORTLIST_SOURCE);
    expect(captured.row!.notice_id).toBe('n1');
  });

  it('a repeat save is a DUPLICATE, not a failure', async () => {
    const { db } = insertDb({ code: '23505', message: 'duplicate key' });
    const r = await addToAnonShortlist(db, { anonId: ANON, noticeId: 'n1' });
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(true);
    expect(r.saved).toBe(false);
  });

  it('a real error surfaces instead of reporting success', async () => {
    const { db } = insertDb({ code: '42P01', message: 'relation missing' });
    const r = await addToAnonShortlist(db, { anonId: ANON, noticeId: 'n1' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/relation missing/);
  });

  it('refuses a bad anon id or a missing notice', async () => {
    const { db } = insertDb();
    expect((await addToAnonShortlist(db, { anonId: 'nope', noticeId: 'n1' })).ok).toBe(false);
    expect((await addToAnonShortlist(db, { anonId: ANON, noticeId: '' })).ok).toBe(false);
  });
});

describe('claiming a shortlist onto a real account', () => {
  function claimDb(mine: { id: string; notice_id: string }[], existing: { notice_id: string }[], count = 0) {
    const calls: string[] = [];
    const q: Record<string, unknown> = {};
    let phase = 0;
    q.select = () => { phase += 1; return q; };
    q.update = (_r: unknown, _o: unknown) => { calls.push('update'); return q; };
    q.eq = () => q;
    q.in = () => q;
    q.limit = () => q;
    q.order = () => q;
    q.then = (res: (v: unknown) => unknown) => {
      if (calls.includes('update')) return Promise.resolve({ count, error: null }).then(res);
      const data = phase === 1 ? mine : existing;
      return Promise.resolve({ data, error: null }).then(res);
    };
    return { db: { from: vi.fn(() => q) } as never };
  }

  it('moves rows the account does not already track', async () => {
    const { db } = claimDb([{ id: 'a', notice_id: 'n1' }, { id: 'b', notice_id: 'n2' }], [], 2);
    const r = await claimAnonShortlist(db, ANON, 'Buyer@Example.com');
    expect(r.ok).toBe(true);
    expect(r.claimed).toBe(2);
    expect(r.alreadyTracked).toBe(0);
  });

  it("never overwrites the account's EXISTING pursuit for the same notice", async () => {
    const { db } = claimDb([{ id: 'a', notice_id: 'n1' }], [{ notice_id: 'n1' }], 0);
    const r = await claimAnonShortlist(db, ANON, 'buyer@example.com');
    expect(r.ok).toBe(true);
    expect(r.claimed).toBe(0);
    expect(r.alreadyTracked).toBe(1);
  });

  it('an empty shortlist claims nothing and is not an error', async () => {
    const { db } = claimDb([], [], 0);
    expect(await claimAnonShortlist(db, ANON, 'b@e.com')).toEqual({ ok: true, claimed: 0, alreadyTracked: 0 });
  });

  it('refuses a bad id or email', async () => {
    const { db } = claimDb([], [], 0);
    expect((await claimAnonShortlist(db, 'nope', 'b@e.com')).ok).toBe(false);
    expect((await claimAnonShortlist(db, ANON, 'nope')).ok).toBe(false);
  });
});

describe('write-receipt discipline', () => {
  it('counts with { count: exact }, never a RETURNING payload (INT-005)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/shortlist/anon-shortlist.ts'), 'utf8');
    expect(src).toMatch(/\{ count: 'exact' \}/);
    expect(src).not.toMatch(/\.update\([\s\S]{0,160}\.select\(/);
  });
  it('a NULL count is UNKNOWN, never zero', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/shortlist/anon-shortlist.ts'), 'utf8');
    expect(src).toMatch(/count == null[\s\S]{0,140}unknown, not zero/i);
  });
});

describe('signed-in pursuits are untouched', () => {
  it('this workstream does not modify the signed-in pipeline route', () => {
    // Stronger than reading a comment: assert the file is absent from the diff.
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const changed = execSync('git diff --name-only origin/main', { encoding: 'utf8' });
    expect(changed).not.toMatch(/src\/app\/api\/pipeline\//);
  });

  it('the anonymous route never accepts a session as a fallback', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/app/shortlist/route.ts'), 'utf8');
    // A caller WITH a session must use /api/pipeline, which validates it.
    expect(src).not.toMatch(/requireMIAuthSession/);
    expect(src).toMatch(/a well-formed anonId is required/);
  });
});

/**
 * Agent 4 release driver (scripts/lib/agent-release-core.mts) against an in-memory fake of GitHub,
 * production and git. Each case Eric asked for has its own test.
 */
import { describe, it, expect } from 'vitest';
import {
  decide, apply, validateReview, isBuilderBranch, releaseRecordBody, LABELS, LOCK_TTL_MS, MAX_ATTEMPTS,
  type Port, type Pr, type Comment, type LockPayload, type ReviewRecord, type ReleaseRecord, type Compare,
} from '../../scripts/lib/agent-release-core.mjs';

const SHA = (c: string) => c.repeat(40).slice(0, 40);
const HEAD = SHA('a');
const MAIN = SHA('m');
const T0 = Date.parse('2026-11-22T18:00:00Z');

function review(over: Partial<ReviewRecord> = {}): string {
  const r: ReviewRecord = { reviewer: 'agent4', reviewed_sha: HEAD, class: 'GREEN', checks: ['tests', 'tsc'], ...over };
  return `Review\n\n\`\`\`agent4-review\n${JSON.stringify(r)}\n\`\`\``;
}

type World = {
  now: number;
  prs: Map<number, Pr>;
  comments: Map<number, Comment[]>;
  commitDates: Map<string, string>;
  verify: Map<string, 'success' | 'pending' | 'failure' | 'missing'>;
  main: string;
  prod: string | null;
  compare: (base: string, head: string) => Compare;
  typecheck: (pr: number) => { ok: boolean; detail: string };
  prodChecksOk: boolean;
  lock: LockPayload | null;
  merges: Array<{ pr: number; sha: string }>;
  mergeResult: (pr: number) => { merged: boolean; merge_commit?: string; message?: string };
  labels: Array<{ pr: number; labels: string[] }>;
  nextCommentId: number;
};

function world(over: Partial<World> = {}): World {
  const w: World = {
    now: T0,
    prs: new Map(),
    comments: new Map(),
    commitDates: new Map([[HEAD, '2026-11-22T17:00:00Z']]),
    verify: new Map([[HEAD, 'success']]),
    main: MAIN,
    prod: MAIN,
    compare: () => 'ahead',
    typecheck: () => ({ ok: true, detail: '' }),
    prodChecksOk: true,
    lock: null,
    merges: [],
    mergeResult: () => ({ merged: true, merge_commit: SHA('c') }),
    labels: [],
    nextCommentId: 1,
    ...over,
  };
  return w;
}

function addPr(w: World, n: number, over: Partial<Pr> = {}, comments: Array<Partial<Comment> & { body: string }> = []) {
  w.prs.set(n, { number: n, draft: false, state: 'open', merged: false, merge_commit_sha: null, created_at: `2026-11-22T1${n % 10}:00:00Z`,
    head: { sha: HEAD, ref: 'claude/some-fix' }, base: { ref: 'main' }, mergeable: true, labels: [LABELS.ready], ...over });
  w.comments.set(n, comments.map((c) => ({ id: w.nextCommentId++, created_at: '2026-11-22T17:30:00Z', updated_at: c.updated_at ?? c.created_at ?? '2026-11-22T17:30:00Z', ...c })));
}

function port(w: World): Port {
  return {
    now: () => w.now,
    openPrs: async () => [...w.prs.values()].filter((p) => p.state === 'open'),
    recentlyMergedPrs: async () => [...w.prs.values()].filter((p) => p.merged),
    pr: async (n) => { const p = w.prs.get(n); if (!p) throw new Error('no pr'); return { ...p }; },
    comments: async (n) => w.comments.get(n) ?? [],
    commitDate: async (sha) => w.commitDates.get(sha) ?? '2026-11-22T17:00:00Z',
    verifyState: async (sha) => w.verify.get(sha) ?? 'missing',
    mainSha: async () => w.main,
    productionSha: async () => w.prod,
    compare: async (b, h) => w.compare(b, h),
    typecheckMerged: async (n) => w.typecheck(n),
    prodChecks: async () => ({ ok: w.prodChecksOk, results: [{ name: 'GET /', ok: w.prodChecksOk, detail: w.prodChecksOk ? '' : '500' }] }),
    merge: async (n, sha) => {
      const r = w.mergeResult(n);
      if (r.merged) { w.merges.push({ pr: n, sha }); const p = w.prs.get(n)!; p.state = 'closed'; p.merged = true; p.merge_commit_sha = r.merge_commit ?? null; }
      return r;
    },
    comment: async (n, body) => { const iso = new Date(w.now).toISOString(); (w.comments.get(n) ?? w.comments.set(n, []).get(n)!).push({ id: w.nextCommentId++, body, created_at: iso, updated_at: iso }); },
    addLabels: async (n, labels) => { w.labels.push({ pr: n, labels }); const p = w.prs.get(n); if (p) p.labels.push(...labels); },
    readLock: async () => w.lock,
    // Atomic: a ref create fails if the ref exists (GitHub returns 422).
    createLock: async (p) => { if (w.lock) return false; w.lock = p; return true; },
    deleteLock: async () => { w.lock = null; },
  };
}

const records = (w: World, n: number): ReleaseRecord[] =>
  (w.comments.get(n) ?? []).flatMap((c) => [...c.body.matchAll(/```agent4-release\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1])));

describe('happy path', () => {
  it('merges the reviewed head pinned to its SHA, under the lock, and records it with the merge commit', async () => {
    const w = world(); addPr(w, 101, {}, [{ body: review() }]);
    const p = port(w);
    const d = await decide(p);
    expect(d.kind).toBe('merge');
    expect(w.merges).toEqual([]); // decide() never writes
    const r = await apply(p, d);
    expect(r.stopped).toBeUndefined();
    expect(w.merges).toEqual([{ pr: 101, sha: HEAD }]);
    expect(w.lock).toMatchObject({ pr: 101, sha: HEAD });
    expect(Date.parse(w.lock!.expires_at) - T0).toBe(LOCK_TTL_MS);
    expect(records(w, 101).at(-1)).toMatchObject({ status: 'merged', sha: HEAD, merge_commit: SHA('c') });
  });

  it('after the deploy is live: production checks, released record + label, lock released, and no second merge', async () => {
    const w = world(); addPr(w, 101, {}, [{ body: review() }]);
    const p = port(w);
    await apply(p, await decide(p));
    w.prod = SHA('c'); w.main = SHA('c');
    const v = await decide(p);
    expect(v.kind).toBe('verify');
    await apply(p, v);
    expect(records(w, 101).at(-1)).toMatchObject({ status: 'released' });
    expect(w.labels.at(-1)).toEqual({ pr: 101, labels: [LABELS.released] });
    expect(w.lock).toBeNull();
    expect(w.merges).toHaveLength(1);
    expect((await decide(p)).kind).toBe('idle');
  });

  it('a failed production check is recorded as verify_failed and blocked, never "released"', async () => {
    const w = world({ prodChecksOk: false }); addPr(w, 101, {}, [{ body: review() }]);
    const p = port(w);
    await apply(p, await decide(p));
    w.prod = SHA('c');
    await apply(p, await decide(p));
    expect(records(w, 101).at(-1)).toMatchObject({ status: 'verify_failed' });
    expect(w.labels.at(-1)!.labels).toEqual([LABELS.blocked]);
  });
});

describe('the required refusals', () => {
  it('reviewed SHA moved → refuse (no merge)', async () => {
    const w = world(); addPr(w, 101, { head: { sha: SHA('b'), ref: 'claude/x' } }, [{ body: review() }]);
    w.verify.set(SHA('b'), 'success');
    const d = await decide(port(w));
    expect(d.kind).toBe('idle');
    expect(d.reasons.join()).toContain('reviewed SHA moved');
    expect(d.actions).toEqual([]);
  });

  it('CI red on the reviewed head → refuse (recorded as a failed attempt, no merge)', async () => {
    const w = world(); addPr(w, 101, {}, [{ body: review() }]); w.verify.set(HEAD, 'failure');
    const p = port(w);
    const d = await decide(p);
    expect(d.kind).toBe('refuse');
    expect(d.reasons[0]).toContain('CI verify is red');
    await apply(p, d);
    expect(w.merges).toEqual([]);
    expect(records(w, 101).at(-1)).toMatchObject({ status: 'attempt_failed' });
  });

  it('main incompatible → refuse: a conflict, or a merged tree that does not type-check', async () => {
    const a = world(); addPr(a, 101, { mergeable: false }, [{ body: review() }]);
    expect((await decide(port(a))).reasons[0]).toContain('not mergeable');
    const b = world({ typecheck: () => ({ ok: false, detail: 'TS2322 in x.ts' }) }); addPr(b, 101, {}, [{ body: review() }]);
    const d = await decide(port(b));
    expect(d.kind).toBe('refuse');
    expect(d.reasons[0]).toContain('does not type-check');
  });

  it('production ≠ main → wait (nothing merges onto an undeployed main)', async () => {
    const w = world({ prod: SHA('p') }); addPr(w, 101, {}, [{ body: review() }]);
    const d = await decide(port(w));
    expect(d.kind).toBe('wait');
    expect(d.reasons[0]).toContain('is not main');
    expect(d.actions).toEqual([]);
  });

  it("YELLOW (or RED) without Eric's approval → refuse; with it → eligible", async () => {
    const w = world(); addPr(w, 101, {}, [{ body: review({ class: 'YELLOW' }) }]);
    const d = await decide(port(w));
    expect(d.kind).toBe('idle');
    expect(d.reasons.join()).toContain("YELLOW without Eric's approval");
    const ok = world(); addPr(ok, 101, {}, [{ body: review({ class: 'RED', eric_approval: { quote: 'Approved, ship #101', at: '2026-11-22T17:40:00Z' } }) }]);
    expect((await decide(port(ok))).kind).toBe('merge');
  });

  it('an edited review record → refuse', async () => {
    const w = world(); addPr(w, 101, {}, [{ body: review(), created_at: '2026-11-22T17:30:00Z', updated_at: '2026-11-22T17:45:00Z' }]);
    const d = await decide(port(w));
    expect(d.kind).toBe('idle');
    expect(d.reasons.join()).toContain('edited');
  });

  it('a review record older than the head commit → refuse', () => {
    const c: Comment = { id: 1, body: review(), created_at: '2026-11-22T16:00:00Z', updated_at: '2026-11-22T16:00:00Z' };
    expect(validateReview([c], HEAD, '2026-11-22T17:00:00Z')).toMatchObject({ ok: false, reason: expect.stringContaining('predates') });
  });

  it('only the LATEST review record counts', () => {
    const older: Comment = { id: 1, body: review(), created_at: '2026-11-22T17:30:00Z', updated_at: '2026-11-22T17:30:00Z' };
    const newer: Comment = { id: 2, body: review({ reviewed_sha: SHA('b') }), created_at: '2026-11-22T17:40:00Z', updated_at: '2026-11-22T17:40:00Z' };
    expect(validateReview([older, newer], HEAD, '2026-11-22T17:00:00Z')).toMatchObject({ ok: false, reason: expect.stringContaining('moved') });
  });

  it('labels never authorize: agent4:green without a review record → not merged', async () => {
    const w = world(); addPr(w, 101, { labels: [LABELS.ready, LABELS.green] }, [{ body: 'looks good' }]);
    const d = await decide(port(w));
    expect(d.kind).toBe('idle');
    expect(d.reasons.join()).toContain('no review record');
  });
});

describe('eligibility', () => {
  it("Branden's team branches (claude/team-*) are excluded; drafts and non-main bases too", async () => {
    expect(isBuilderBranch('claude/team-fix')).toBe(false);
    expect(isBuilderBranch('claude/ask-window-history')).toBe(true);
    expect(isBuilderBranch('feature/x')).toBe(false);
    const w = world();
    addPr(w, 101, { head: { sha: HEAD, ref: 'claude/team-nightly-1' } }, [{ body: review() }]);
    addPr(w, 102, { draft: true }, [{ body: review() }]);
    addPr(w, 103, { base: { ref: 'claude/other' } }, [{ body: review() }]);
    const d = await decide(port(w));
    expect(d.kind).toBe('idle');
    expect(d.reasons).toEqual(['nothing eligible']);
  });

  it('picks the OLDEST eligible PR', async () => {
    const w = world();
    addPr(w, 102, { created_at: '2026-11-22T12:00:00Z' }, [{ body: review() }]);
    addPr(w, 101, { created_at: '2026-11-22T11:00:00Z' }, [{ body: review() }]);
    expect((await decide(port(w))).pr).toBe(101);
  });

  it(`${MAX_ATTEMPTS} failed attempts at the same head → blocked (record + label), then skipped`, async () => {
    const w = world(); addPr(w, 101, {}, [{ body: review() }]); w.verify.set(HEAD, 'failure');
    const p = port(w);
    for (let i = 0; i < MAX_ATTEMPTS; i++) { const d = await decide(p); expect(d.kind).toBe('refuse'); await apply(p, d); }
    const b = await decide(p);
    expect(b.kind).toBe('blocked');
    await apply(p, b);
    expect(w.labels.at(-1)).toEqual({ pr: 101, labels: [LABELS.blocked] });
    expect(records(w, 101).at(-1)).toMatchObject({ status: 'blocked' });
    expect((await decide(p)).kind).toBe('idle');
  });
});

describe('serialization and restart safety', () => {
  it('two concurrent runs: only one acquires the lock and merges', async () => {
    const w = world(); addPr(w, 101, {}, [{ body: review() }]);
    const p = port(w);
    const [d1, d2] = await Promise.all([decide(p), decide(p)]); // both see the same state
    expect(d1.kind).toBe('merge'); expect(d2.kind).toBe('merge');
    const [r1, r2] = await Promise.all([apply(p, d1), apply(p, d2)]);
    expect(w.merges).toHaveLength(1);
    expect([r1.stopped, r2.stopped].filter(Boolean)).toEqual(['another run holds the release lock']);
  });

  it('restart mid-deploy (crash after the merge, before its record) → resumes verification, never a second merge', async () => {
    const w = world(); addPr(w, 101, {}, [{ body: review() }]);
    const p = port(w);
    const d = await decide(p);
    // Simulate a crash: lock + merge happen, the record never gets posted.
    await p.createLock((d.actions[0] as { payload: LockPayload }).payload);
    await p.merge(101, HEAD);
    expect(records(w, 101)).toEqual([]);
    // Next run, deploy not live yet: wait, no merge.
    w.prod = MAIN;
    w.compare = () => 'behind';
    const again = await decide(p);
    expect(again.kind).toBe('wait');
    expect(again.actions).toEqual([]);
    // Deploy goes live: verify, then release the lock.
    w.prod = SHA('c'); w.compare = () => 'identical';
    const v = await decide(p);
    expect(v.kind).toBe('verify');
    await apply(p, v);
    expect(w.merges).toHaveLength(1);
    expect(records(w, 101).at(-1)).toMatchObject({ status: 'released' });
  });

  it('a held (unexpired) lock → wait; an expired lock with nothing pending is taken over safely', async () => {
    const w = world({ lock: { owner: 'agent4-release', pr: 99, sha: SHA('9'), expires_at: new Date(T0 + 60_000).toISOString() } });
    w.prs.set(99, { number: 99, draft: false, state: 'open', merged: false, merge_commit_sha: null, created_at: '2026-11-22T10:00:00Z', head: { sha: SHA('9'), ref: 'claude/y' }, base: { ref: 'main' }, mergeable: true, labels: [] });
    w.comments.set(99, []);
    addPr(w, 101, {}, [{ body: review() }]);
    const p = port(w);
    expect((await decide(p)).kind).toBe('wait');
    w.now = T0 + 120_000; // expired
    const d = await decide(p);
    expect(d.kind).toBe('merge');
    expect(d.actions[0].do).toBe('take_over_lock');
    await apply(p, d);
    expect(w.lock?.pr).toBe(101);
  });

  it('the head moved between the decision and the merge → stop, no merge, lock released', async () => {
    const w = world(); addPr(w, 101, {}, [{ body: review() }]);
    const p = port(w);
    const d = await decide(p);
    w.prs.get(101)!.head.sha = SHA('b');
    const r = await apply(p, d);
    expect(r.stopped).toContain('head moved');
    expect(w.merges).toEqual([]);
    expect(w.lock).toBeNull();
  });

  it('a merge the API refuses is recorded as a failed attempt and the lock is released', async () => {
    const w = world({ mergeResult: () => ({ merged: false, message: 'Head branch was modified' }) }); addPr(w, 101, {}, [{ body: review() }]);
    const p = port(w);
    const r = await apply(p, await decide(p));
    expect(r.stopped).toContain('merge refused');
    expect(records(w, 101).at(-1)).toMatchObject({ status: 'attempt_failed' });
    expect(w.lock).toBeNull();
  });
});

describe('record format', () => {
  it('release records are fenced JSON with the Claude Code footer', () => {
    const body = releaseRecordBody({ type: 'release', pr: 1, status: 'merged', sha: HEAD, at: '2026-11-22T18:00:00Z' });
    expect(body).toMatch(/```agent4-release\n\{.*\}\n```/);
    expect(body).toContain('_Generated by [Claude Code](https://claude.ai/code)_');
  });
});

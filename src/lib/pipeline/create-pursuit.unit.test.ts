/**
 * #1601 — ONE pursuit implementation.
 *
 * The blocker this PR closes: the shortlist claim inserted into `user_pipeline`
 * directly with six fields, producing a pursuit with no workspace, no owner
 * attribution, no canonical SAM UUID, no next action, no discovery time, no
 * family and no documents — identical-looking in the table, different
 * everywhere else.
 *
 * These tests assert the two callers now AGREE on what a pursuit is, not merely
 * that each inserted a row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/app/workspace', () => ({
  recordAppActivity: vi.fn(async () => {}),
  clientNotificationEmail: (ws: string) => `${ws}@clients.getmindy.ai`,
}));
vi.mock('@/lib/grants/fetch-grant-docs', () => ({ fetchPursuitDocsAuto: vi.fn(async () => {}) }));
vi.mock('@/lib/sam/solicitation-family', () => ({
  familyAttachmentForNotice: vi.fn(async () => ({
    view: { family_id: 'fam-1' },
    attachment: { family_id: 'fam-1', versions: 2 },
  })),
}));
vi.mock('@/lib/pipeline/sam-opportunity-lookup', () => ({
  lookupSamOpportunityForPipeline: vi.fn(async () => ({
    noticeId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    responseDeadline: '2026-11-01T17:00:00Z',
  })),
}));
vi.mock('@/lib/pipeline/discovered-at', () => ({
  resolveDiscoveredAt: vi.fn(async (_db: unknown, o: { userEmail: string; nowIso: string }) =>
    // The anon identity has an EARLIER logged view; the account has none.
    o.userEmail.startsWith('anon:') ? '2026-09-01T00:00:00.000Z' : o.nowIso),
}));

import { createCanonicalPursuit } from './create-pursuit';
import { recordAppActivity } from '@/lib/app/workspace';
import { fetchPursuitDocsAuto } from '@/lib/grants/fetch-grant-docs';
import { claimAnonShortlist, CLAIMED_SOURCE } from '@/lib/shortlist/anon-shortlist';

const ANON = 'anon:57b9d751-9451-40c8-9f3e-2b1c4d5e6f70';
const UUID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OPP = {
  notice_id: UUID,
  title: 'Base Operations Support',
  department: 'DEPARTMENT OF THE NAVY',
  naics_code: '561210',
  set_aside: 'SBA',
  response_deadline: '2026-11-01T17:00:00Z',
  notice_type: 'Solicitation',
};
const WRITER = readFileSync(join(process.cwd(), 'src/lib/pipeline/create-pursuit.ts'), 'utf8');
const PIPELINE = readFileSync(join(process.cwd(), 'src/app/api/pipeline/route.ts'), 'utf8');
const SHORTLIST_LIB = readFileSync(join(process.cwd(), 'src/lib/shortlist/anon-shortlist.ts'), 'utf8');
const SHORTLIST_ROUTE = readFileSync(join(process.cwd(), 'src/app/api/app/shortlist/route.ts'), 'utf8');

/**
 * A stub that RECORDS what would be persisted, so parity is compared on the
 * real payload rather than on "both returned ok".
 */
function recordingDb(opts: {
  shortlistRows?: { id: string; notice_id: string }[];
  alreadyTracked?: string[];
  insertErr?: { code?: string; message: string } | null;
  oppErr?: { message: string } | null;
  opp?: unknown;
  /** Outcome of the claim-marker UPDATE on anonymous_shortlist. */
  markErr?: { message: string } | null;
  markCount?: number | null;
  /** What a read-back of the shortlist row shows after a 0-row update. */
  markReadBack?: { claimed_at: string | null } | null;
  markReadBackErr?: { message: string } | null;
} = {}) {
  const inserts: Record<string, unknown>[] = [];
  const shortlistUpdates: Record<string, unknown>[] = [];
  const pipelineUpdates: Record<string, unknown>[] = [];

  const make = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain; q.eq = chain; q.is = chain; q.in = chain; q.order = chain; q.limit = chain;
    q.update = (patch: Record<string, unknown>) => {
      if (table === 'anonymous_shortlist') {
        shortlistUpdates.push(patch);
        // The marker awaits the query itself, so resolve with its count/error.
        const res = {
          count: opts.markErr ? null : (opts.markCount === undefined ? 1 : opts.markCount),
          error: opts.markErr ?? null,
          data: null,
        };
        const upd: Record<string, unknown> = {};
        upd.eq = () => upd; upd.is = () => upd;
        upd.then = (r: (v: unknown) => unknown) => Promise.resolve(res).then(r);
        return upd;
      }
      if (table === 'user_pipeline') pipelineUpdates.push(patch);
      return q;
    };
    q.insert = (row: Record<string, unknown>) => {
      if (table === 'user_pipeline') inserts.push({ ...row });
      const res = opts.insertErr && table === 'user_pipeline'
        ? { data: null, error: opts.insertErr }
        : { data: { id: `row-${inserts.length}`, ...row }, error: null };
      const ins: Record<string, unknown> = {
        select: () => ({ single: async () => res }),
        then: (r: (v: unknown) => unknown) => Promise.resolve({ error: res.error }).then(r),
      };
      return ins;
    };
    q.maybeSingle = async () => {
      if (table === 'sam_opportunities') {
        if (opts.oppErr) return { data: null, error: opts.oppErr };
        return { data: opts.opp === undefined ? OPP : opts.opp, error: null };
      }
      if (table === 'anonymous_shortlist') {
        // The marker's read-back after a 0-row update.
        if (opts.markReadBackErr) return { data: null, error: opts.markReadBackErr };
        return { data: opts.markReadBack ?? null, error: null };
      }
      return { data: null, error: null };
    };
    q.then = (r: (v: unknown) => unknown) => {
      let data: unknown[] = [];
      if (table === 'anonymous_shortlist') data = opts.shortlistRows ?? [];
      if (table === 'user_pipeline') data = (opts.alreadyTracked ?? []).map((n) => ({ notice_id: n }));
      return Promise.resolve({ data, count: data.length, error: null }).then(r);
    };
    return q;
  };
  return { db: { from: (t: string) => make(t) } as never, inserts, shortlistUpdates, pipelineUpdates };
}

const CTX = (db: never) => ({
  db,
  callerEmail: 'buyer@example.com',
  workspaceId: 'ws-client-1',
  asClient: false,
  clientOwnerEmail: 'ws-client-1@clients.getmindy.ai',
});

beforeEach(() => vi.clearAllMocks());

// ── 1. THE CONTRACT IS SHARED, NOT COPIED ──────────────────────────────────

describe('there is exactly one pursuit implementation', () => {
  it('/api/pipeline POST delegates to the canonical writer', () => {
    expect(PIPELINE).toMatch(/createCanonicalPursuit\(/);
  });

  it('the shortlist claim delegates to the SAME writer and never inserts a pursuit itself', () => {
    expect(SHORTLIST_LIB).toMatch(/createCanonicalPursuit\(/);
    expect(SHORTLIST_LIB).not.toMatch(/from\('user_pipeline'\)[\s\S]{0,80}\.insert\(/);
  });

  it('no route inserts into user_pipeline outside the writer', () => {
    for (const src of [PIPELINE, SHORTLIST_LIB, SHORTLIST_ROUTE]) {
      expect(src).not.toMatch(/from\('user_pipeline'\)\s*\.insert\(/);
    }
    expect(WRITER).toMatch(/from\('user_pipeline'\)\.insert\(body\)/);
  });
});

// ── 2. AUTH STAYS OUTSIDE THE WRITER ───────────────────────────────────────

describe('the writer never authenticates, and neither route was weakened', () => {
  it('the writer imports no session code', () => {
    // Assert the STRUCTURE, not the word: the writer's own doc comment names
    // requireMIAuthSession while explaining that auth stays at the edge, so a
    // bare text match would fail on the comment that documents the rule.
    const code = WRITER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/^import .*two-factor-session/m);
    expect(code).not.toMatch(/requireMIAuthSession\(/);
  });

  it('/api/pipeline still verifies the session against the body email', () => {
    expect(PIPELINE).toMatch(/requireMIAuthSession\(request, body\.user_email\)/);
  });

  it('the shortlist claim derives the account from the session, never the body', () => {
    expect(SHORTLIST_ROUTE).toMatch(/requireMIAuthSession\(request\)/);
    expect(SHORTLIST_ROUTE).toMatch(/verifiedEmail = session\.session\.email/);
    // No body-supplied email reaches the claim.
    expect(SHORTLIST_ROUTE).not.toMatch(/body\.email/);
  });

  it('the writer refuses to treat an anon id as an account', async () => {
    const { db } = recordingDb();
    const r = await claimAnonShortlist(db, ANON, {
      verifiedEmail: ANON, workspaceId: 'ws', asClient: false, clientOwnerEmail: 'x@y',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/verified account email/);
  });
});

// ── 3. PERSISTED-FIELD PARITY ──────────────────────────────────────────────

/** What /api/pipeline POST hands the writer for this opportunity. */
const pipelineDraft = {
  notice_id: UUID,
  title: OPP.title,
  agency: OPP.department,
  naics_code: OPP.naics_code,
  set_aside: OPP.set_aside,
  response_deadline: OPP.response_deadline,
  source: 'opportunity_map',
};

describe('a claimed shortlist produces the SAME pursuit as Start Pursuit', () => {
  it('agrees on every persisted field except the truthful source', async () => {
    const a = recordingDb();
    await createCanonicalPursuit(CTX(a.db), { ...pipelineDraft }, { clientNoticeType: OPP.notice_type });

    const b = recordingDb({ shortlistRows: [{ id: 'sl-1', notice_id: UUID }] });
    await claimAnonShortlist(b.db, ANON, {
      verifiedEmail: 'buyer@example.com',
      workspaceId: 'ws-client-1',
      asClient: false,
      clientOwnerEmail: 'ws-client-1@clients.getmindy.ai',
    });

    expect(a.inserts).toHaveLength(1);
    expect(b.inserts).toHaveLength(1);
    const [viaPipeline] = a.inserts;
    const [viaClaim] = b.inserts;

    for (const field of [
      'notice_id', 'title', 'agency', 'naics_code', 'response_deadline',
      'workspace_id', 'owner_email', 'created_by', 'updated_by',
      'stage', 'priority', 'is_prime', 'next_action', 'user_email',
    ]) {
      expect(`${field}=${JSON.stringify(viaClaim[field])}`)
        .toBe(`${field}=${JSON.stringify(viaPipeline[field])}`);
    }
    // The ONE intended difference: truthful provenance.
    expect(viaPipeline.source).toBe('opportunity_map');
    expect(viaClaim.source).toBe(CLAIMED_SOURCE);
    expect(CLAIMED_SOURCE).toBe('opportunity_map_claimed');
  });

  it('a claimed pursuit carries the full contract, not a six-field stub', async () => {
    const b = recordingDb({ shortlistRows: [{ id: 'sl-1', notice_id: UUID }] });
    await claimAnonShortlist(b.db, ANON, {
      verifiedEmail: 'buyer@example.com', workspaceId: 'ws-1',
      asClient: false, clientOwnerEmail: 'ws-1@clients.getmindy.ai',
    });
    const [row] = b.inserts;
    // Each of these was ABSENT from the direct insert this PR replaced.
    expect(row.workspace_id).toBe('ws-1');
    expect(row.owner_email).toBe('buyer@example.com');
    expect(row.created_by).toBe('buyer@example.com');
    expect(row.updated_by).toBe('buyer@example.com');
    expect(row.stage).toBe('tracking');
    expect(row.priority).toBe('medium');
    expect(row.is_prime).toBe(true);
    expect(row.next_action).toBeTruthy();
    expect(row.discovered_at).toBeTruthy();
    expect(recordAppActivity).toHaveBeenCalledTimes(1);
  });
});

// ── 4. COACH MODE / WORKSPACE PARITY ───────────────────────────────────────

describe('coach mode lands in the CLIENT workspace, both ways', () => {
  const coachCtx = {
    callerEmail: 'coach@agency.com',
    workspaceId: 'ws-client-42',
    asClient: true,
    clientOwnerEmail: 'ws-client-42@clients.getmindy.ai',
  };

  it('owner is the client profile and workspace is the client workspace', async () => {
    const a = recordingDb();
    await createCanonicalPursuit({ db: a.db, ...coachCtx }, { ...pipelineDraft });

    const b = recordingDb({ shortlistRows: [{ id: 'sl-1', notice_id: UUID }] });
    await claimAnonShortlist(b.db, ANON, { verifiedEmail: coachCtx.callerEmail, ...coachCtx });

    for (const row of [a.inserts[0], b.inserts[0]]) {
      expect(row.workspace_id).toBe('ws-client-42');
      // NOT the coach's personal workspace, and NOT the coach as owner.
      expect(row.owner_email).toBe('ws-client-42@clients.getmindy.ai');
      expect(row.user_email).toBe('coach@agency.com');
      expect(row.created_by).toBe('coach@agency.com');
    }
  });

  it('the claim route resolves the active workspace with the same resolver as /api/pipeline', () => {
    expect(SHORTLIST_ROUTE).toMatch(/resolveActiveWorkspace\(verifiedEmail, request\)/);
    expect(PIPELINE).toMatch(/resolveActiveWorkspace\(body\.user_email, request\)/);
  });
});

// ── 5. ALREADY TRACKED → RESOLVED, NEVER OVERWRITTEN ───────────────────────

describe('an opportunity the account already pursues', () => {
  it('is left untouched but the shortlist row is resolved', async () => {
    const b = recordingDb({
      shortlistRows: [{ id: 'sl-1', notice_id: UUID }],
      alreadyTracked: [UUID],
    });
    const r = await claimAnonShortlist(b.db, ANON, {
      verifiedEmail: 'buyer@example.com', workspaceId: 'ws-1',
      asClient: false, clientOwnerEmail: 'ws-1@clients.getmindy.ai',
    });
    expect(r.alreadyTracked).toBe(1);
    expect(r.promoted).toBe(0);
    // The existing pursuit is NOT modified…
    expect(b.inserts).toHaveLength(0);
    expect(b.pipelineUpdates).toHaveLength(0);
    // …but the shortlist row IS resolved, so the Map stops reconsidering it.
    expect(b.shortlistUpdates).toHaveLength(1);
    expect(b.shortlistUpdates[0]).toMatchObject({ claimed_by: 'buyer@example.com' });
    expect(b.shortlistUpdates[0].claimed_at).toBeTruthy();
  });

  it('a 23505 race is also already-tracked, not an error', async () => {
    const b = recordingDb({
      shortlistRows: [{ id: 'sl-1', notice_id: UUID }],
      insertErr: { code: '23505', message: 'duplicate key' },
    });
    const r = await claimAnonShortlist(b.db, ANON, {
      verifiedEmail: 'buyer@example.com', workspaceId: 'ws-1',
      asClient: false, clientOwnerEmail: 'ws-1@clients.getmindy.ai',
    });
    expect(r.ok).toBe(true);
    expect(r.alreadyTracked).toBe(1);
    expect(r.failed).toBe(0);
    expect(b.shortlistUpdates).toHaveLength(1);
  });
});

// ── 6. FAILURE LEAVES THE ROW FOR RETRY ────────────────────────────────────

describe('a failure is UNKNOWN, never a silent skip', () => {
  it('a metadata read error leaves the row unclaimed and is counted', async () => {
    const b = recordingDb({
      shortlistRows: [{ id: 'sl-1', notice_id: UUID }],
      oppErr: { message: 'connection reset' },
    });
    const r = await claimAnonShortlist(b.db, ANON, {
      verifiedEmail: 'buyer@example.com', workspaceId: 'ws-1',
      asClient: false, clientOwnerEmail: 'ws-1@clients.getmindy.ai',
    });
    expect(r.failed).toBe(1);
    expect(r.promoted).toBe(0);
    expect(r.alreadyTracked).toBe(0);
    expect(b.inserts).toHaveLength(0);
    expect(b.shortlistUpdates).toHaveLength(0);  // retryable
  });

  it('a pursuit write error leaves the row unclaimed and is counted', async () => {
    const b = recordingDb({
      shortlistRows: [{ id: 'sl-1', notice_id: UUID }],
      insertErr: { code: '42501', message: 'permission denied' },
    });
    const r = await claimAnonShortlist(b.db, ANON, {
      verifiedEmail: 'buyer@example.com', workspaceId: 'ws-1',
      asClient: false, clientOwnerEmail: 'ws-1@clients.getmindy.ai',
    });
    expect(r.failed).toBe(1);
    expect(r.promoted).toBe(0);
    expect(b.shortlistUpdates).toHaveLength(0);
  });

  it('the pursuit exists BEFORE the shortlist row is marked', async () => {
    // The ordering invariant that makes retry safe, asserted on the source.
    const claimFn = SHORTLIST_LIB.slice(SHORTLIST_LIB.indexOf('export async function claimAnonShortlist'));
    const writeAt = claimFn.indexOf('createCanonicalPursuit(');
    const markAt = claimFn.indexOf('const marked = await markClaimed(row);', writeAt);
    const promoteAt = claimFn.indexOf('promoted += 1;', markAt);
    expect(writeAt).toBeGreaterThan(-1);
    // pursuit write -> mark -> only then count it promoted
    expect(markAt).toBeGreaterThan(writeAt);
    expect(promoteAt).toBeGreaterThan(markAt);
  });

  it('the route reports `failed` rather than hiding a partial failure', () => {
    expect(SHORTLIST_ROUTE).toMatch(/failed: r\.failed/);
  });
});

// ── 7. DOCUMENT FETCH KEEPS ITS after() + maxDuration CONTRACT ──────────────

describe('background document fetch survives the extraction', () => {
  it('the writer returns the task instead of running it inline', async () => {
    const a = recordingDb();
    const r = await createCanonicalPursuit(CTX(a.db), { ...pipelineDraft });
    expect(r.kind).toBe('created');
    if (r.kind !== 'created') return;
    expect(typeof r.postWrite).toBe('function');
    // Not yet called — scheduling is the route's job.
    expect(fetchPursuitDocsAuto).not.toHaveBeenCalled();
    await r.postWrite!();
    expect(fetchPursuitDocsAuto).toHaveBeenCalledTimes(1);
  });

  it('both routes schedule it with after() and declare maxDuration = 300', () => {
    expect(PIPELINE).toMatch(/if \(result\.postWrite\) after\(result\.postWrite\)/);
    expect(PIPELINE).toMatch(/export const maxDuration = 300/);
    expect(SHORTLIST_ROUTE).toMatch(/for \(const task of r\.postWrite\) after\(task\)/);
    expect(SHORTLIST_ROUTE).toMatch(/export const maxDuration = 300/);
  });

  it('a claim returns one task per pursuit created', async () => {
    const b = recordingDb({ shortlistRows: [{ id: 'sl-1', notice_id: UUID }] });
    const r = await claimAnonShortlist(b.db, ANON, {
      verifiedEmail: 'buyer@example.com', workspaceId: 'ws-1',
      asClient: false, clientOwnerEmail: 'ws-1@clients.getmindy.ai',
    });
    expect(r.postWrite).toHaveLength(1);
  });
});

// ── 8. FAMILY TRUTH ────────────────────────────────────────────────────────

describe('a claimed pursuit is not second-class', () => {
  it('family attachment runs and family_id is persisted', async () => {
    const a = recordingDb();
    const r = await createCanonicalPursuit(CTX(a.db), { ...pipelineDraft });
    expect(r.kind).toBe('created');
    if (r.kind !== 'created') return;
    expect(r.family).toMatchObject({ family_id: 'fam-1' });
    expect(a.pipelineUpdates.some((u) => u.family_id === 'fam-1')).toBe(true);
  });

  it('the same attachment happens on the claim path', async () => {
    const b = recordingDb({ shortlistRows: [{ id: 'sl-1', notice_id: UUID }] });
    await claimAnonShortlist(b.db, ANON, {
      verifiedEmail: 'buyer@example.com', workspaceId: 'ws-1',
      asClient: false, clientOwnerEmail: 'ws-1@clients.getmindy.ai',
    });
    expect(b.pipelineUpdates.some((u) => u.family_id === 'fam-1')).toBe(true);
  });
});

// ── 9. DISCOVERED_AT — RECOVERED, NEVER INVENTED ───────────────────────────

describe('discovered_at', () => {
  it('canonical behaviour is unchanged: the caller alone is searched', async () => {
    const a = recordingDb();
    await createCanonicalPursuit(CTX(a.db), { ...pipelineDraft });
    // The account has no earlier view, so the save moment is the honest floor.
    const iso = a.inserts[0].discovered_at as string;
    expect(new Date(iso).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('a claim recovers the ANONYMOUS first view, which is a real observation', async () => {
    const b = recordingDb({ shortlistRows: [{ id: 'sl-1', notice_id: UUID }] });
    await claimAnonShortlist(b.db, ANON, {
      verifiedEmail: 'buyer@example.com', workspaceId: 'ws-1',
      asClient: false, clientOwnerEmail: 'ws-1@clients.getmindy.ai',
    });
    // NOT claim time — the anon identity's earlier logged view of this notice.
    expect(b.inserts[0].discovered_at).toBe('2026-09-01T00:00:00.000Z');
  });

  it('the claim passes BOTH identities and takes the earliest', () => {
    expect(SHORTLIST_LIB).toMatch(/discoveryIdentities: \[owner, email\]/);
    expect(WRITER).toMatch(/if \(new Date\(seen\)\.getTime\(\) < new Date\(earliest\)\.getTime\(\)\) earliest = seen/);
  });

  it('an explicit caller-supplied discovered_at still wins', async () => {
    const a = recordingDb();
    await createCanonicalPursuit(CTX(a.db), { ...pipelineDraft, discovered_at: '2020-01-01T00:00:00.000Z' });
    expect(a.inserts[0].discovered_at).toBe('2020-01-01T00:00:00.000Z');
  });
});

// ── 10. THE REGRESSIONS THE OLD ROUTE ALREADY GUARDED ──────────────────────

describe('behaviour carried over from /api/pipeline', () => {
  it('the canonical SAM UUID replaces a solicitation number', async () => {
    const a = recordingDb();
    await createCanonicalPursuit(CTX(a.db), { ...pipelineDraft, notice_id: '70203926CGASHED' });
    expect(a.inserts[0].notice_id).toBe(UUID);
  });

  it('a malformed notice_id is dropped rather than stored', async () => {
    const a = recordingDb();
    await createCanonicalPursuit(CTX(a.db), { ...pipelineDraft, notice_id: 'deadline-140R6026Q0068' });
    // Nulled, then recovered from the canonical lookup.
    expect(a.inserts[0].notice_id).toBe(UUID);
  });

  it('a display-label value_estimate is rejected', async () => {
    const a = recordingDb();
    await createCanonicalPursuit(CTX(a.db), { ...pipelineDraft, value_estimate: 'Due in 6 days' });
    expect(a.inserts[0].value_estimate).toBeUndefined();
  });

  it('the unknown-column retry is bounded and only ever REMOVES keys', () => {
    expect(WRITER).toMatch(/attempt < 5 && error/);
    expect(WRITER).toMatch(/error\.code === '42703' \|\| error\.code === 'PGRST204'/);
    expect(WRITER).toMatch(/delete body\[col\]/);
  });

  it('a duplicate returns the existing row and never a new one', async () => {
    const a = recordingDb({ insertErr: { code: '23505', message: 'duplicate key' } });
    const r = await createCanonicalPursuit(CTX(a.db), { ...pipelineDraft });
    expect(r.kind).toBe('duplicate');
    expect(PIPELINE).toMatch(/Opportunity already in pipeline/);
    expect(PIPELINE).toMatch(/status: 409/);
  });

  it('the caller draft object is not mutated', async () => {
    const a = recordingDb();
    const draft = { ...pipelineDraft, notice_type: 'Solicitation' } as Record<string, unknown>;
    await createCanonicalPursuit(CTX(a.db), draft as never);
    expect(draft.notice_type).toBe('Solicitation');
    expect(draft.workspace_id).toBeUndefined();
  });
});

// ── 11. THE CLAIM MARKER MUST BE FALSIFIABLE ───────────────────────────────

const CLAIM_CTX = {
  verifiedEmail: 'buyer@example.com', workspaceId: 'ws-1',
  asClient: false, clientOwnerEmail: 'ws-1@clients.getmindy.ai',
};

describe('resolving a shortlist row is proven, never assumed', () => {
  it('scopes the mutation defensively and counts it exactly', () => {
    const fn = SHORTLIST_LIB.slice(SHORTLIST_LIB.indexOf('const markClaimed'));
    expect(fn).toMatch(/\{ count: 'exact' \}/);
    expect(fn).toMatch(/\.eq\('id', row\.id\)/);
    expect(fn).toMatch(/\.eq\('owner_anon_id', owner\)/);
    expect(fn).toMatch(/\.is\('claimed_at', null\)/);
  });

  it('a mark UPDATE database error counts as failed, never as resolved', async () => {
    const b = recordingDb({
      shortlistRows: [{ id: 'sl-1', notice_id: UUID }],
      markErr: { message: 'connection reset' },
    });
    const r = await claimAnonShortlist(b.db, ANON, CLAIM_CTX);
    expect(r.failed).toBe(1);
    expect(r.promoted).toBe(0);
    expect(r.alreadyTracked).toBe(0);
    // The real pursuit was created and STAYS.
    expect(b.inserts).toHaveLength(1);
  });

  it('a mark UPDATE affecting ZERO rows is not a clean resolution', async () => {
    const b = recordingDb({
      shortlistRows: [{ id: 'sl-1', notice_id: UUID }],
      markCount: 0,
      markReadBack: { claimed_at: null },   // still unclaimed → genuinely unresolved
    });
    const r = await claimAnonShortlist(b.db, ANON, CLAIM_CTX);
    expect(r.failed).toBe(1);
    expect(r.promoted).toBe(0);
  });

  it('a NULL count is UNKNOWN, never resolved', async () => {
    const b = recordingDb({
      shortlistRows: [{ id: 'sl-1', notice_id: UUID }],
      markCount: null,
    });
    const r = await claimAnonShortlist(b.db, ANON, CLAIM_CTX);
    expect(r.failed).toBe(1);
    expect(r.promoted).toBe(0);
  });

  it('ZERO rows BUT provably claimed concurrently IS a resolution', async () => {
    const b = recordingDb({
      shortlistRows: [{ id: 'sl-1', notice_id: UUID }],
      markCount: 0,
      markReadBack: { claimed_at: '2026-09-21T00:00:00Z' },  // someone else resolved it
    });
    const r = await claimAnonShortlist(b.db, ANON, CLAIM_CTX);
    expect(r.promoted).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('new pursuit created + mark fails → postWrite still returned, row retryable', async () => {
    const b = recordingDb({
      shortlistRows: [{ id: 'sl-1', notice_id: UUID }],
      markErr: { message: 'update rejected' },
    });
    const r = await claimAnonShortlist(b.db, ANON, CLAIM_CTX);
    // The pursuit exists, so its documents are still fetched…
    expect(r.postWrite).toHaveLength(1);
    // …and it is never rolled back.
    expect(b.inserts).toHaveLength(1);
    // The claim attempt is unresolved, so the next retry re-resolves it.
    expect(r.failed).toBe(1);
    expect(r.promoted).toBe(0);
  });

  it('existing pursuit + mark succeeds → untouched, resolved, alreadyTracked', async () => {
    const b = recordingDb({
      shortlistRows: [{ id: 'sl-1', notice_id: UUID }],
      alreadyTracked: [UUID],
    });
    const r = await claimAnonShortlist(b.db, ANON, CLAIM_CTX);
    expect(r.alreadyTracked).toBe(1);
    expect(r.failed).toBe(0);
    expect(b.inserts).toHaveLength(0);       // existing pursuit untouched
    expect(b.pipelineUpdates).toHaveLength(0);
    expect(b.shortlistUpdates).toHaveLength(1);
  });

  it('existing pursuit + mark FAILS → failed, not a false alreadyTracked', async () => {
    const b = recordingDb({
      shortlistRows: [{ id: 'sl-1', notice_id: UUID }],
      alreadyTracked: [UUID],
      markErr: { message: 'update rejected' },
    });
    const r = await claimAnonShortlist(b.db, ANON, CLAIM_CTX);
    expect(r.failed).toBe(1);
    expect(r.alreadyTracked).toBe(0);
    expect(b.inserts).toHaveLength(0);
  });
});

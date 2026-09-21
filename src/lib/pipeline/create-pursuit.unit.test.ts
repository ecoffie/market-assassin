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

beforeEach(() => vi.clearAllMocks());

// ── 1. THE CONTRACT IS SHARED, NOT COPIED ──────────────────────────────────

describe('there is exactly one pursuit implementation', () => {
  it('/api/pipeline POST delegates to the canonical writer', () => {
    expect(PIPELINE).toMatch(/createCanonicalPursuit\(/);
  });

  it('the shortlist NEVER creates a pursuit — a save is not a pursuit', () => {
    // RETURNING IS THE CONVERSION. A saved listing is discovery; a pursuit is
    // execution. Signing in is not a statement of intent to bid, so the claim
    // transfers saves and touches user_pipeline not at all.
    const code = SHORTLIST_LIB.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/createCanonicalPursuit/);
    expect(code).not.toMatch(/user_pipeline/);
    // …while the writer remains the ONE pursuit contract for /api/pipeline.
    expect(PIPELINE).toMatch(/createCanonicalPursuit\(/);
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

  it('/api/pipeline schedules it with after() and declares maxDuration = 300', () => {
    expect(PIPELINE).toMatch(/if \(result\.postWrite\) after\(result\.postWrite\)/);
    expect(PIPELINE).toMatch(/export const maxDuration = 300/);
  });

  it('the shortlist route schedules NO background work — it creates no pursuits', () => {
    const code = SHORTLIST_ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bafter\(/);
    expect(code).not.toMatch(/maxDuration/);
  });

});

// ── 8. FAMILY TRUTH ────────────────────────────────────────────────────────

describe('family truth', () => {
  it('family attachment runs and family_id is persisted', async () => {
    const a = recordingDb();
    const r = await createCanonicalPursuit(CTX(a.db), { ...pipelineDraft });
    expect(r.kind).toBe('created');
    if (r.kind !== 'created') return;
    expect(r.family).toMatchObject({ family_id: 'fam-1' });
    expect(a.pipelineUpdates.some((u) => u.family_id === 'fam-1')).toBe(true);
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

  it('the multi-identity resolver takes the EARLIEST real observation', async () => {
    const a = recordingDb();
    await createCanonicalPursuit(CTX(a.db), { ...pipelineDraft }, { discoveryIdentities: [ANON, 'buyer@example.com'] });
    // The anon identity carries an earlier logged view; neither is invented.
    expect(a.inserts[0].discovered_at).toBe('2026-09-01T00:00:00.000Z');
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


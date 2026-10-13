/**
 * Scanner-save side-effect suppression (hotfix 2026-10-06).
 *
 * Pins: (1) only RECORDED T1 pursuits lose their change-alert digest entries and automatic document
 * fetch; (2) ordinary and user-confirmed pursuits still trigger normally; (3) a lookup failure fails
 * OPEN (nothing suppressed); (4) a user-initiated document fetch is never suppressed; (5) the
 * suppression never writes to user_pipeline; (6) the candidate SQL is T1-only, pre-cutoff,
 * excludes confirmed saves, and is read-only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { suppressedPipelineIds, dropSuppressedFromDigests } from './side-effect-suppression';

type Res = { data?: unknown; error?: { message: string } | null };
function client(resolve: (table: string, inIds: string[], col: string | null) => Res) {
  const calls: { table: string; op: string }[] = [];
  return {
    calls,
    sb: {
      from(table: string) {
        let inIds: string[] = []; let col: string | null = null;
        const chain: Record<string, unknown> = {
          select: () => { calls.push({ table, op: 'select' }); return chain; },
          in: (_c: string, ids: string[]) => { inIds = ids; return chain; },
          eq: (c: string) => { col = c; return chain; },
          update: () => { calls.push({ table, op: 'update' }); return chain; },
          insert: () => { calls.push({ table, op: 'insert' }); return chain; },
          then: (res: (v: unknown) => void) => { const r = resolve(table, inIds, col); res({ data: r.data ?? null, error: r.error ?? null }); },
        };
        return chain;
      },
    } as never,
  };
}

const SUPPRESSED = new Set(['p-scanner-1', 'p-scanner-2']);
const recorded = (table: string, ids: string[], col: string | null): Res => {
  expect(table).toBe('pipeline_side_effect_suppressions');
  expect(col === 'suppress_change_notifications' || col === 'suppress_doc_fetch').toBe(true);
  return { data: ids.filter((i) => SUPPRESSED.has(i)).map((pipeline_id) => ({ pipeline_id })) };
};

describe('suppressedPipelineIds', () => {
  it('returns only the recorded pursuits', async () => {
    const { sb } = client(recorded);
    const { ids, error } = await suppressedPipelineIds(sb, ['p-scanner-1', 'p-human', 'p-confirmed'], 'change_notifications');
    expect(error).toBeNull();
    expect([...ids]).toEqual(['p-scanner-1']);
  });

  it('fails OPEN: a lookup error suppresses nothing', async () => {
    const { sb } = client(() => ({ error: { message: 'relation does not exist' } }));
    const { ids, error } = await suppressedPipelineIds(sb, ['p-scanner-1'], 'change_notifications');
    expect(ids.size).toBe(0);
    expect(error).toContain('does not exist');
  });

  it('chunks large id lists and never writes', async () => {
    const { sb, calls } = client(recorded);
    const many = Array.from({ length: 450 }, (_, i) => `p-${i}`).concat(['p-scanner-2']);
    const { ids } = await suppressedPipelineIds(sb, many, 'doc_fetch');
    expect([...ids]).toEqual(['p-scanner-2']);
    expect(calls.filter((c) => c.op === 'select')).toHaveLength(3); // 451 ids → 3 chunks of ≤ 200
    expect(calls.some((c) => c.op !== 'select')).toBe(false);
  });
});

describe('change-alert digests', () => {
  const digests = () => new Map([
    ['scanned-only@example.org', [{ pursuitId: 'p-scanner-1', title: 'A' }]],
    ['mixed@example.org', [{ pursuitId: 'p-scanner-2', title: 'B' }, { pursuitId: 'p-confirmed', title: 'C' }]],
    ['ordinary@example.org', [{ pursuitId: 'p-human', title: 'D' }]],
  ]);

  it('drops suppressed pursuits, keeps ordinary and confirmed ones', () => {
    const d = digests();
    const dropped = dropSuppressedFromDigests(d, SUPPRESSED);
    expect(dropped).toBe(2);
    expect(d.has('scanned-only@example.org')).toBe(false);             // no email at all
    expect(d.get('mixed@example.org')!.map((x) => x.pursuitId)).toEqual(['p-confirmed']);
    expect(d.get('ordinary@example.org')!.map((x) => x.pursuitId)).toEqual(['p-human']);
  });

  it('with nothing suppressed (or a failed lookup) every digest goes out unchanged', () => {
    const d = digests();
    expect(dropSuppressedFromDigests(d, new Set())).toBe(0);
    expect([...d.keys()]).toHaveLength(3);
  });

  it('the cron keeps writing the change log (in-app badge) and filters only the outbound digest', () => {
    const src = readFileSync('src/app/api/cron/pursuit-changes/route.ts', 'utf8');
    const logWrite = src.indexOf("from('pursuit_change_log').insert(");
    const filter = src.indexOf('dropSuppressedFromDigests(changesByUser, suppressed)');
    const sms = src.indexOf('const affectedOwners = Array.from(changesByUser.keys())');
    const send = src.indexOf('await sendEmail({');
    expect(logWrite).toBeGreaterThan(0);
    expect(filter).toBeGreaterThan(logWrite); // log rows are written first, for every pursuit
    expect(sms).toBeGreaterThan(filter);      // SMS + email are built from the filtered digests
    expect(send).toBeGreaterThan(filter);
    expect(src).toContain(".in('pursuit_id', items.map((it) => it.pursuitId))"); // emailed=true only for sent rows
  });
});

// ── document fetch gate ───────────────────────────────────────────────────────
const gate = vi.hoisted(() => ({ suppressed: false, calls: 0 }));
vi.mock('@/lib/pipeline/side-effect-suppression', async (orig) => ({
  ...(await orig<typeof import('./side-effect-suppression')>()),
  isSideEffectSuppressed: vi.fn(async () => { gate.calls += 1; return gate.suppressed; }),
}));
const writes = vi.hoisted(() => ({ ops: [] as string[] }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'or', 'order', 'limit', 'not', 'is', 'ilike', 'gte', 'lt']) chain[m] = () => chain;
    for (const m of ['update', 'insert', 'upsert', 'delete']) chain[m] = () => { writes.ops.push(m); return chain; };
    chain.maybeSingle = async () => ({ data: null, error: { message: 'stop here (test)' } });
    chain.single = chain.maybeSingle;
    chain.then = (res: (v: unknown) => void) => res({ data: [], error: null, count: 0 });
    return { from: () => chain, storage: { from: () => chain }, rpc: async () => ({ data: null, error: null }) };
  },
}));

describe('automatic document fetch', () => {
  beforeEach(() => {
    gate.suppressed = false; gate.calls = 0; writes.ops = [];
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
    // Hermetic: the ordinary path proceeds into SAM discovery; answer it locally with a failure.
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
  });

  it('is skipped for a recorded scanner pursuit, before ANY write to the row', async () => {
    gate.suppressed = true;
    const { fetchPursuitDocs } = await import('@/lib/sam/fetch-pursuit-docs');
    // 'opp-' prefix would normally trigger the notice-id normalization UPDATE — it must not happen.
    const r = await fetchPursuitDocs({ pipelineId: 'p-scanner-1', userEmail: 'x@example.org', noticeId: 'opp-233276dfd7c74b4c8026b4be094581b5' });
    expect(r).toMatchObject({ suppressed: true, attempted: 0, status: 'none' });
    expect(writes.ops).toEqual([]);
  });

  it('still runs for an ordinary pursuit (gate consulted, not suppressed)', async () => {
    gate.suppressed = false;
    const { fetchPursuitDocs } = await import('@/lib/sam/fetch-pursuit-docs');
    const r = await fetchPursuitDocs({ pipelineId: 'p-human', userEmail: 'x@example.org', noticeId: 'opp-233276dfd7c74b4c8026b4be094581b5' }).catch(() => ({ suppressed: false }));
    expect(gate.calls).toBe(1);
    expect((r as { suppressed?: boolean }).suppressed).not.toBe(true);
    expect(writes.ops.length).toBeGreaterThan(0); // proceeded into normal work (the normalization write)
  });

  it('a user-initiated fetch is never suppressed (gate not even consulted)', async () => {
    gate.suppressed = true;
    const { fetchPursuitDocs } = await import('@/lib/sam/fetch-pursuit-docs');
    const r = await fetchPursuitDocs({ pipelineId: 'p-scanner-1', userEmail: 'x@example.org', noticeId: 'opp-233276dfd7c74b4c8026b4be094581b5', userInitiated: true }).catch(() => ({ suppressed: false }));
    expect(gate.calls).toBe(0);
    expect((r as { suppressed?: boolean }).suppressed).not.toBe(true);
  });

  it('the Proposal Assist route passes userInitiated through fetchPursuitDocsAuto', () => {
    expect(readFileSync('src/app/api/app/proposal/pursuit-docs/route.ts', 'utf8')).toContain('userInitiated: true');
    expect(readFileSync('src/lib/grants/fetch-grant-docs.ts', 'utf8')).toContain('userInitiated: opts.userInitiated');
  });
});

describe('candidate selection (migration)', () => {
  const sql = readFileSync('supabase/migrations/20261006_pipeline_side_effect_suppressions.sql', 'utf8');
  const body = sql.split('AS $function$')[1].split('$function$')[0];

  it('is T1 only: < 120 s after the alert AND a ±1 s burst, before the cutoff', () => {
    expect(body).toMatch(/< 120/);
    expect(body).toMatch(/burst_peers >= 1/);
    expect(body).toMatch(/interval '1 second'/);
    expect(body).toMatch(/created_at < p_cutoff/);
    expect(body).toMatch(/source = 'daily_alert'/);
  });

  it('never selects a user-confirmed save', () => {
    expect(body).toMatch(/NOT EXISTS \(SELECT 1 FROM pipeline_save_confirmations/);
  });

  it('is read-only and does not alter user_pipeline anywhere in the migration', () => {
    expect(sql).toMatch(/STABLE/);
    expect(sql).toMatch(/SECURITY INVOKER/);
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
    expect(sql).not.toMatch(/ALTER TABLE public\.user_pipeline|UPDATE public\.user_pipeline|DELETE FROM public\.user_pipeline/i);
  });
});

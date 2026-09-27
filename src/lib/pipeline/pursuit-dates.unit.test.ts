/**
 * #1705 — POST /api/pipeline 500'd with
 *   invalid input syntax for type timestamp with time zone: "" (22007)
 * because clients send `response_deadline: ''` for an unknown deadline and the
 * writer passed it straight into the TIMESTAMPTZ column.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/app/workspace', () => ({ recordAppActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/grants/fetch-grant-docs', () => ({ fetchPursuitDocsAuto: vi.fn(async () => {}) }));
vi.mock('@/lib/sam/solicitation-family', () => ({ familyAttachmentForNotice: vi.fn(async () => null) }));
// The failing case: SAM knows nothing about this notice, so no deadline backfill.
vi.mock('@/lib/pipeline/sam-opportunity-lookup', () => ({
  lookupSamOpportunityForPipeline: vi.fn(async () => null),
}));
vi.mock('@/lib/pipeline/discovered-at', () => ({
  resolveDiscoveredAt: vi.fn(async (_db: unknown, o: { nowIso: string }) => o.nowIso),
}));

import { normalizePursuitDates, PURSUIT_DATE_FIELDS } from './pursuit-dates';
import { createCanonicalPursuit } from './create-pursuit';

describe('normalizePursuitDates', () => {
  it('"" becomes null (the honest unknown)', () => {
    const b: Record<string, unknown> = { response_deadline: '' };
    expect(normalizePursuitDates(b)).toEqual({ ok: true });
    expect(b.response_deadline).toBeNull();
  });

  it('whitespace-only becomes null', () => {
    const b: Record<string, unknown> = { response_deadline: '   ', next_action_date: '\t' };
    expect(normalizePursuitDates(b).ok).toBe(true);
    expect(b.response_deadline).toBeNull();
    expect(b.next_action_date).toBeNull();
  });

  it('an absent / undefined key is left untouched (a PATCH must not clear it)', () => {
    const b: Record<string, unknown> = { title: 'x' };
    normalizePursuitDates(b);
    expect('response_deadline' in b).toBe(false);
    const c: Record<string, unknown> = { response_deadline: undefined };
    normalizePursuitDates(c);
    expect(c.response_deadline).toBeUndefined();
  });

  it('null stays null', () => {
    const b: Record<string, unknown> = { outcome_date: null };
    expect(normalizePursuitDates(b).ok).toBe(true);
    expect(b.outcome_date).toBeNull();
  });

  it.each([
    '2026-11-01',
    '2026-11-01T17:00:00Z',
    '2026-10-15T17:00:00-04:00',
    '2026-11-01T17:00:00.000Z',
    '10/15/2026',
  ])('a valid date passes through unchanged: %s', (v) => {
    const b: Record<string, unknown> = { response_deadline: v };
    expect(normalizePursuitDates(b)).toEqual({ ok: true });
    expect(b.response_deadline).toBe(v);
  });

  it.each(['Due in 6 days', 'TBD', '1', '2026-02-30', '2026-13-01', 'not a date'])(
    'garbage is a validation error naming the field, never a fabricated date: %s',
    (v) => {
      const b: Record<string, unknown> = { response_deadline: v };
      const r = normalizePursuitDates(b);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.field).toBe('response_deadline');
      expect(b.response_deadline).toBe(v); // not rewritten
    },
  );

  it('a non-string (number/object) is rejected', () => {
    expect(normalizePursuitDates({ discovered_at: 1790000000000 }).ok).toBe(false);
    expect(normalizePursuitDates({ bid_decided_at: {} }).ok).toBe(false);
  });

  it('covers every date-typed user_pipeline column a body can reach', () => {
    expect([...PURSUIT_DATE_FIELDS].sort()).toEqual(
      ['bid_decided_at', 'discovered_at', 'docs_fetched_at', 'next_action_date', 'outcome_date', 'response_deadline'].sort(),
    );
  });
});

/** Minimal db stub: records the user_pipeline insert; SAM lookups find nothing. */
function recordingDb() {
  const inserts: Record<string, unknown>[] = [];
  const make = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain; q.eq = chain; q.in = chain; q.limit = chain; q.update = chain;
    q.maybeSingle = async () => ({ data: null, error: null });
    q.insert = (row: Record<string, unknown>) => {
      if (table === 'user_pipeline') inserts.push({ ...row });
      // Emulate Postgres: '' into a TIMESTAMPTZ is 22007.
      const bad = row.response_deadline === '';
      const res = bad
        ? { data: null, error: { code: '22007', message: 'invalid input syntax for type timestamp with time zone: ""' } }
        : { data: { id: 'row-1', ...row }, error: null };
      return { select: () => ({ single: async () => res }) };
    };
    return q;
  };
  return { db: { from: (t: string) => make(t) } as never, inserts };
}

const CTX = (db: never) => ({
  db, callerEmail: 'u@example.com', workspaceId: 'ws-1', asClient: false, clientOwnerEmail: 'c@x',
});

describe('createCanonicalPursuit — the #1705 payload shape', () => {
  it('response_deadline "" with no SAM deadline is written as NULL, not "" (was 22007 → 500)', async () => {
    const { db, inserts } = recordingDb();
    const r = await createCanonicalPursuit(CTX(db), {
      title: 'Undated saved opportunity',
      notice_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      response_deadline: '',
      source: 'saved_inbox',
    });
    expect(r.kind).toBe('created');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].response_deadline).toBeNull();
  });

  it('a non-date deadline is refused before any write', async () => {
    const { db, inserts } = recordingDb();
    const r = await createCanonicalPursuit(CTX(db), { title: 'x', response_deadline: 'Due in 6 days' });
    expect(r).toMatchObject({ kind: 'invalid', field: 'response_deadline' });
    expect(inserts).toHaveLength(0);
  });

  it('a valid deadline is inserted unchanged', async () => {
    const { db, inserts } = recordingDb();
    await createCanonicalPursuit(CTX(db), { title: 'x', response_deadline: '2026-11-01T17:00:00Z' });
    expect(inserts[0].response_deadline).toBe('2026-11-01T17:00:00Z');
  });
});

describe('/api/pipeline wires the contract on both write verbs', () => {
  const ROUTE = readFileSync(join(process.cwd(), 'src/app/api/pipeline/route.ts'), 'utf8');
  it('POST maps an invalid date to 400, not 500', () => {
    expect(ROUTE).toMatch(/result\.kind === 'invalid'[\s\S]{0,300}status: 400/);
  });
  it('PATCH normalizes dates before the update', () => {
    const patch = ROUTE.slice(ROUTE.indexOf('export async function PATCH'), ROUTE.indexOf('export async function DELETE'));
    expect(patch.indexOf('normalizePursuitDates(updates)')).toBeGreaterThan(-1);
    expect(patch.indexOf('normalizePursuitDates(updates)')).toBeLessThan(patch.indexOf('runUpdate(updates)'));
  });
});

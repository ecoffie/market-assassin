import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * logMEstimate is a best-effort, append-only side effect: it must (a) insert the
 * expected shape into m_estimate_log when Supabase is healthy, and (b) NEVER throw
 * — a missing table, a network error, or missing env vars must all degrade to a
 * console.error and a resolved promise, never a rejected one (the estimate itself
 * must still render even if logging fails entirely).
 */

let insertedRows: Record<string, unknown>[] = [];
let insertError: { message: string } | null = null;
let throwOnInsert = false;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (throwOnInsert) throw new Error('boom');
        insertedRows.push({ table, ...row });
        return Promise.resolve({ data: null, error: insertError });
      },
    }),
  }),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  insertedRows = [];
  insertError = null;
  throwOnInsert = false;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function load() {
  return await import('./m-estimate-log');
}

describe('logMEstimate — shape', () => {
  it('inserts the expected column shape into m_estimate_log', async () => {
    const { logMEstimate, M_ESTIMATE_MODEL_VERSION } = await load();
    await logMEstimate({
      noticeId: 'notice-123',
      solicitationNumber: 'SOL-456',
      naics: '541512',
      agency: 'DEPT OF DEFENSE',
      subAgency: 'ARMY',
      ourLow: 100000,
      ourMedian: 250000,
      ourHigh: 400000,
      comparableN: 12,
      source: 'comparable_awards',
    });

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0];
    expect(row.table).toBe('m_estimate_log');
    expect(row.notice_id).toBe('notice-123');
    expect(row.solicitation_number).toBe('SOL-456');
    expect(row.naics).toBe('541512');
    expect(row.agency).toBe('DEPT OF DEFENSE');
    expect(row.sub_agency).toBe('ARMY');
    expect(row.our_low).toBe(100000);
    expect(row.our_median).toBe(250000);
    expect(row.our_high).toBe(400000);
    expect(row.comparable_n).toBe(12);
    expect(row.source).toBe('comparable_awards');
    expect(row.model_version).toBe(M_ESTIMATE_MODEL_VERSION);
  });

  it('defaults model_version to M_ESTIMATE_MODEL_VERSION when not passed', async () => {
    const { logMEstimate, M_ESTIMATE_MODEL_VERSION } = await load();
    await logMEstimate({ noticeId: 'n1', ourLow: 1, ourMedian: 2, ourHigh: 3 });
    expect(insertedRows[0].model_version).toBe(M_ESTIMATE_MODEL_VERSION);
  });

  it('respects an explicit modelVersion override', async () => {
    const { logMEstimate } = await load();
    await logMEstimate({ noticeId: 'n1', ourLow: 1, ourMedian: 2, ourHigh: 3, modelVersion: 'v2' });
    expect(insertedRows[0].model_version).toBe('v2');
  });
});

describe('logMEstimate — never throws (best-effort side effect)', () => {
  it('does not throw when the insert returns a Postgres error (e.g. table missing pre-migration)', async () => {
    insertError = { message: 'relation "m_estimate_log" does not exist' };
    const { logMEstimate } = await load();
    await expect(logMEstimate({ noticeId: 'n1', ourLow: 1, ourMedian: 2, ourHigh: 3 })).resolves.toBeUndefined();
  });

  it('does not throw when the Supabase client itself throws synchronously', async () => {
    throwOnInsert = true;
    const { logMEstimate } = await load();
    await expect(logMEstimate({ noticeId: 'n1', ourLow: 1, ourMedian: 2, ourHigh: 3 })).resolves.toBeUndefined();
  });

  it('does not throw and skips the insert when Supabase env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { logMEstimate } = await load();
    await expect(logMEstimate({ noticeId: 'n1', ourLow: 1, ourMedian: 2, ourHigh: 3 })).resolves.toBeUndefined();
    expect(insertedRows).toHaveLength(0);
  });
});

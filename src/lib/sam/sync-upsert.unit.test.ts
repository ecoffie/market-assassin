import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isStatementTimeout, staleCleanupMode, staleCleanupOrFilters, staleRowStillLive, upsertInChunks } from './sync-upsert';

const TIMEOUT = { message: 'canceling statement due to statement timeout' };
const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

/** A fake upsert that times out whenever a statement carries more than `limit` rows. */
function fakeDb(limit: number, opts: { failWith?: { message: string }; failOnRow?: number } = {}) {
  const calls: number[] = [];
  const stored = new Set<number>();
  const upsert = async (part: number[]) => {
    calls.push(part.length);
    if (opts.failOnRow != null && part.includes(opts.failOnRow)) return { error: opts.failWith ?? TIMEOUT };
    if (part.length > limit) return { error: TIMEOUT };
    part.forEach((r) => stored.add(r));
    return { error: null };
  };
  return { calls, stored, upsert };
}

describe('upsertInChunks', () => {
  it('a 1,000-row page is written as ten 100-row statements', async () => {
    const db = fakeDb(1000);
    const r = await upsertInChunks(rows(1000), db.upsert);
    expect(r).toMatchObject({ ok: true, written: 1000, statements: 10, splits: 0 });
    expect(db.stored.size).toBe(1000);
  });

  it('the old shape (one 1,000-row statement) is exactly what fails when the database allows fewer rows', async () => {
    const db = fakeDb(400);
    const old = await db.upsert(rows(1000));
    expect(old.error?.message).toMatch(/statement timeout/);
    const r = await upsertInChunks(rows(1000), fakeDb(400).upsert);
    expect(r.ok).toBe(true);
  });

  it('a timed-out chunk is halved and retried until it fits', async () => {
    const db = fakeDb(30);
    const r = await upsertInChunks(rows(100), db.upsert);
    expect(r.ok).toBe(true);
    expect(r.written).toBe(100);
    expect(r.splits).toBeGreaterThan(0);
    expect(Math.max(...db.calls.filter((_, i) => i > 0))).toBeLessThanOrEqual(50);
    expect(db.stored.size).toBe(100);
  });

  it('a timeout that persists at the minimum chunk fails the page, with no infinite loop', async () => {
    const db = fakeDb(5);
    const r = await upsertInChunks(rows(100), db.upsert, { chunk: 100, minChunk: 10 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/statement timeout/);
    expect(db.calls.length).toBeLessThan(40);
  });

  it('a non-timeout error fails the page immediately (no retry)', async () => {
    const db = fakeDb(1000, { failOnRow: 250, failWith: { message: 'duplicate key value violates unique constraint' } });
    const r = await upsertInChunks(rows(1000), db.upsert);
    expect(r).toMatchObject({ ok: false, written: 200, splits: 0 });
    expect(r.error).toMatch(/duplicate key/);
  });

  it('empty input writes nothing and succeeds', async () => {
    const db = fakeDb(10);
    expect(await upsertInChunks([], db.upsert)).toMatchObject({ ok: true, written: 0, statements: 0 });
  });

  it('recognises the production timeout messages', () => {
    expect(isStatementTimeout('canceling statement due to statement timeout')).toBe(true);
    expect(isStatementTimeout('canceling statement due to lock timeout')).toBe(true);
    expect(isStatementTimeout('violates foreign key constraint')).toBe(false);
    expect(isStatementTimeout(null)).toBe(false);
  });
});

describe('stale cleanup never deactivates a notice SAM still considers live', () => {
  const NOW = new Date('2026-11-09T23:00:00Z');

  it('future response deadline → still live (the 706 rows the old rule would have deactivated)', () => {
    expect(staleRowStillLive({ response_deadline: '2026-12-15T17:00:00Z', archive_date: '2026-12-30T00:00:00Z' }, NOW)).toBe(true);
  });

  it('deadline passed but archive date in the future → still live (SAM has not archived it)', () => {
    expect(staleRowStillLive({ response_deadline: '2026-10-01T00:00:00Z', archive_date: '2026-11-20T00:00:00Z' }, NOW)).toBe(true);
  });

  it('no deadline, future archive date → still live', () => {
    expect(staleRowStillLive({ response_deadline: null, archive_date: '2026-11-25T00:00:00Z' }, NOW)).toBe(true);
  });

  it('deadline and archive date both past → may be deactivated', () => {
    expect(staleRowStillLive({ response_deadline: '2026-10-01T00:00:00Z', archive_date: '2026-10-16T00:00:00Z' }, NOW)).toBe(false);
  });

  it('no dates at all → may be deactivated (the old behaviour for undated rows)', () => {
    expect(staleRowStillLive({ response_deadline: null, archive_date: null }, NOW)).toBe(false);
  });

  it('the PostgREST filters are the exact complement of staleRowStillLive', () => {
    const [d, a] = staleCleanupOrFilters(NOW);
    expect(d).toBe('response_deadline.is.null,response_deadline.lt."2026-11-09T23:00:00.000Z"');
    expect(a).toBe('archive_date.is.null,archive_date.lt."2026-11-09T23:00:00.000Z"');
    const cases = [
      { response_deadline: null, archive_date: null },
      { response_deadline: '2026-12-01T00:00:00Z', archive_date: null },
      { response_deadline: null, archive_date: '2026-12-01T00:00:00Z' },
      { response_deadline: '2026-10-01T00:00:00Z', archive_date: '2026-10-02T00:00:00Z' },
      { response_deadline: '2026-10-01T00:00:00Z', archive_date: '2026-12-02T00:00:00Z' },
    ];
    const passes = (v: string | null) => v == null || new Date(v) < NOW; // what each .or() selects
    for (const c of cases) {
      const selected = passes(c.response_deadline) && passes(c.archive_date);
      expect(selected).toBe(!staleRowStillLive(c, NOW));
    }
  });
});

describe('the sync route uses both safeguards', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/api/cron/sync-sam-opportunities/route.ts'), 'utf8');

  it('no page is upserted as a single statement any more', () => {
    expect(SRC).not.toMatch(/\.upsert\(firstBatch,/);
    expect(SRC).not.toMatch(/\.upsert\(batch,/);
    expect(SRC.match(/upsertInChunks\(/g)?.length).toBe(2);
  });

  it('stale cleanup applies both date predicates on its selection', () => {
    expect(SRC).toMatch(/staleCleanupOrFilters\(new Date\(\)\)/);
    expect(SRC).toMatch(/\.lt\('synced_at', cutoff\)\s*\.or\(deadlineOver\)\s*\.or\(archiveOver\)\s*\.limit\(STALE_CHUNK\)/);
  });

  it('cleanup defaults to REPORT: nothing is deactivated unless SAM_STALE_CLEANUP=apply', () => {
    expect(staleCleanupMode(undefined)).toBe('report');
    expect(staleCleanupMode('')).toBe('report');
    expect(staleCleanupMode('yes')).toBe('report');
    expect(staleCleanupMode('APPLY')).toBe('apply');
    expect(staleCleanupMode('off')).toBe('off');
    expect(SRC).toMatch(/staleMode === 'apply' && staleChunks < STALE_MAX_CHUNKS/);
    expect(SRC).toMatch(/staleEligible = count \?\? null/);
  });

  it('cleanup is still gated on a fully successful full sync', () => {
    expect(SRC).toMatch(/if \(!dryRun && isFullSuccess && syncType === 'full'\)/);
  });
});

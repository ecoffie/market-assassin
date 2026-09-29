import { describe, expect, it } from 'vitest';
import { cronHeaderAuthorized } from './auth';
import { fetchDatePageRowsPaged, type GscRow } from './observe';
import { coverageDays, stratumOf } from './types';
import { evaluateCompletion } from './watchdog';

describe('stratumOf', () => {
  it('assigns every URL exactly one stratum by path', () => {
    const o = 'https://getmindy.ai';
    expect(stratumOf(`${o}/`)).toBe('hub');
    expect(stratumOf(`${o}/pricing`)).toBe('hub');
    expect(stratumOf(`${o}/contractors`)).toBe('hub');
    expect(stratumOf(`${o}/contractors/the-boeing-company`)).toBe('contractor_root');
    expect(stratumOf(`${o}/contractors/acme/contracts`)).toBe('contractor_contracts');
    expect(stratumOf(`${o}/contractors/acme/agencies`)).toBe('contractor_agencies');
    expect(stratumOf(`${o}/contractors/acme/naics`)).toBe('contractor_naics');
    expect(stratumOf(`${o}/contractors/acme/other`)).toBe('programmatic_other');
    expect(stratumOf(`${o}/opportunity/abc-123`)).toBe('programmatic_other');
    expect(stratumOf(`${o}/top/defense-contractors`)).toBe('programmatic_other');
  });
});

describe('coverageDays (honest rotation math)', () => {
  it('matches the measured population: 11,770 contractor roots at 50 inspections/run is 236 days', () => {
    expect(coverageDays(11_770, 50)).toBe(236);
    expect(coverageDays(36_058, 150)).toBe(241); // the unstratified figure from the review
    expect(coverageDays(0, 10)).toBe(0);
    expect(coverageDays(10, 0)).toBeNull();
  });
});

describe('fetchDatePageRowsPaged', () => {
  const rows = (n: number, offset = 0): GscRow[] => Array.from({ length: n }, (_, i) => ({ keys: ['2026-09-20', `https://getmindy.ai/p${offset + i}`], clicks: 0, impressions: 1 }));

  it('paginates with startRow until a final partial page, and reports it complete', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const r = await fetchDatePageRowsPaged(async (body) => {
      bodies.push(body);
      const start = body.startRow as number;
      return { rows: start === 0 ? rows(3) : start === 3 ? rows(3, 3) : rows(1, 6) };
    }, '2026-08-27', '2026-09-26', 3);
    expect(bodies.map((b) => b.startRow)).toEqual([0, 3, 6]);
    expect(bodies.every((b) => b.rowLimit === 3 && (b.dimensions as string[]).join() === 'date,page')).toBe(true);
    expect(r).toMatchObject({ rowCount: 7, pages: 3, complete: true });
  });

  it('an exactly-full last page needs one more (empty) request before it is complete', async () => {
    const r = await fetchDatePageRowsPaged(async (body) => ({ rows: (body.startRow as number) === 0 ? rows(3) : [] }), 'a', 'b', 3);
    expect(r).toMatchObject({ rowCount: 3, pages: 2, complete: true });
  });

  it('marks the result incomplete (never throws) when any page fails', async () => {
    const r = await fetchDatePageRowsPaged(async (body) => {
      if ((body.startRow as number) === 3) throw new Error('GSC API 500');
      return { rows: rows(3) };
    }, 'a', 'b', 3);
    expect(r.complete).toBe(false);
    expect(r.rowCount).toBe(3);
    expect(r.error).toMatch(/page 2 failed: GSC API 500/);
  });
});

describe('cronHeaderAuthorized (header only)', () => {
  const env = { CRON_SECRET: 's3cret' };
  it('accepts the dispatcher bearer and Vercel cron header', () => {
    expect(cronHeaderAuthorized(new Headers({ authorization: 'Bearer s3cret' }), env)).toBe(true);
    expect(cronHeaderAuthorized(new Headers({ 'x-vercel-cron': '1' }), env)).toBe(true);
  });
  it('rejects a wrong bearer, a bare secret, no CRON_SECRET configured, and anything in the URL', () => {
    expect(cronHeaderAuthorized(new Headers({ authorization: 'Bearer nope' }), env)).toBe(false);
    expect(cronHeaderAuthorized(new Headers({ authorization: 's3cret' }), env)).toBe(false);
    expect(cronHeaderAuthorized(new Headers({ authorization: 'Bearer ' }), {})).toBe(false);
    // The function takes headers only: there is no way to pass a ?password= query.
    expect(cronHeaderAuthorized.length).toBeLessThanOrEqual(2);
  });
});

describe('evaluateCompletion (watchdog)', () => {
  const now = Date.parse('2026-09-29T13:30:00Z');
  const run = (id: number, status: string, started: string, finished: string | null) => ({ id, status, started_at: started, finished_at: finished });

  it('healthy when a run completed ok/partial within 26h', () => {
    expect(evaluateCompletion([run(2, 'partial', '2026-09-29T12:00:00Z', '2026-09-29T12:04:00Z')], now).healthy).toBe(true);
  });

  it('stale when nothing completed in 26h, or nothing ever completed', () => {
    const v = evaluateCompletion([run(1, 'ok', '2026-09-27T12:00:00Z', '2026-09-27T12:04:00Z')], now);
    expect(v.healthy).toBe(false);
    expect(v.problems[0].kind).toBe('stale');
    expect(evaluateCompletion([], now).problems[0].message).toMatch(/no SEO health run has ever completed/);
  });

  it('stuck when a run has been running over 30 minutes (died mid-run), even if yesterday was fine', () => {
    const v = evaluateCompletion([
      run(3, 'running', '2026-09-29T12:00:00Z', null),
      run(2, 'ok', '2026-09-28T12:00:00Z', '2026-09-28T12:04:00Z'),
    ], now);
    expect(v.problems.map((p) => p.kind)).toContain('stuck');
  });

  it('flags a failed most-recent run', () => {
    const v = evaluateCompletion([
      run(3, 'failed', '2026-09-29T12:00:00Z', '2026-09-29T12:01:00Z'),
      run(2, 'ok', '2026-09-29T00:00:00Z', '2026-09-29T00:04:00Z'),
    ], now);
    expect(v.problems.map((p) => p.kind)).toEqual(['failed']);
  });
});

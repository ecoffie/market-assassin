import { describe, it, expect } from 'vitest';
import { findUnclosedRuns, UNCLOSED_MARGIN_MS } from './unclosed-runs';

const now = new Date('2026-11-23T12:00:00Z');
const jobs = [
  { job_name: 'sync-dibbs', timeout_ms: 300_000 },          // long, self-reports
  { job_name: 'refresh-quiet-long', timeout_ms: 300_000 },  // long, never self-reports
  { job_name: 'health-check-email', timeout_ms: 50_000 },   // short
];
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const run = (id: string, job: string, status: string, m: number) => ({ id, job_name: job, status, started_at: minsAgo(m) });

describe('findUnclosedRuns', () => {
  it('flags a `running` row past timeout + margin for any job (dispatcher never closed it)', () => {
    const out = findUnclosedRuns({ openRuns: [run('a', 'health-check-email', 'running', 60)], jobs, selfReportEvidence: new Map(), now });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ job_name: 'health-check-email', status: 'running', runs: 1, run_ids: ['a'] });
    expect(out[0].deadline_ms).toBe(50_000 + UNCLOSED_MARGIN_MS);
  });

  it('does not flag a row still inside timeout + margin', () => {
    // 300s timeout + 15 min margin = 20 min; 19 min old is still within it.
    const out = findUnclosedRuns({ openRuns: [run('a', 'sync-dibbs', 'running', 19)], jobs, selfReportEvidence: new Map(), now });
    expect(out).toEqual([]);
  });

  it('flags `dispatched` only for a job with EARLIER self-report evidence', () => {
    const evidence = new Map([['sync-dibbs', minsAgo(3 * 24 * 60)]]);
    const out = findUnclosedRuns({
      openRuns: [run('d1', 'sync-dibbs', 'dispatched', 120), run('d2', 'sync-dibbs', 'dispatched', 600), run('q1', 'refresh-quiet-long', 'dispatched', 600)],
      jobs, selfReportEvidence: evidence, now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ job_name: 'sync-dibbs', status: 'dispatched', runs: 2, run_ids: ['d1', 'd2'] });
    expect(out[0].newest_started_at).toBe(minsAgo(120));
    expect(out[0].oldest_started_at).toBe(minsAgo(600));
  });

  it('ignores `dispatched` rows that predate the job adopting self-reporting', () => {
    const evidence = new Map([['sync-dibbs', minsAgo(60)]]);
    const out = findUnclosedRuns({ openRuns: [run('old', 'sync-dibbs', 'dispatched', 600)], jobs, selfReportEvidence: evidence, now });
    expect(out).toEqual([]);
  });

  it('ignores terminal rows and jobs that are not enabled', () => {
    const out = findUnclosedRuns({
      openRuns: [run('s', 'sync-dibbs', 'success', 600), run('x', 'gone-job', 'running', 600)],
      jobs, selfReportEvidence: new Map(), now,
    });
    expect(out).toEqual([]);
  });
});

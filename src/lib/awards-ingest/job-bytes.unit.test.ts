import { describe, it, expect } from 'vitest';
import { formatJobBytes, mergeJobIds, parseChildJobIds, parseJobBytes } from './job-bytes';

describe('merge job byte reporting', () => {
  it('job ids are deterministic, BigQuery-safe and distinct per step', () => {
    const ids = mergeJobIds(new Date('2026-10-11T14:03:05.123Z'), 'run-123/abc');
    expect(ids).toEqual({ locate: 'awards_merge_locate_20261011140305_run-123abc', script: 'awards_merge_script_20261011140305_run-123abc' });
    expect(ids.locate).toMatch(/^[A-Za-z0-9_-]{1,1024}$/);
  });

  it('reads processed/billed bytes and the statement type from bq show', () => {
    const s = parseJobBytes(JSON.stringify({
      jobReference: { jobId: 'script_job_1' },
      statistics: { totalBytesProcessed: '4144144384', query: { statementType: 'MERGE', totalBytesProcessed: '4144144384', totalBytesBilled: '4144168960' } },
      status: { state: 'DONE' },
    }));
    expect(s).toEqual({ jobId: 'script_job_1', statementType: 'MERGE', processedBytes: 4144144384, billedBytes: 4144168960, state: 'DONE', error: null });
    expect(formatJobBytes('merge', s)).toBe('[bytes] merge MERGE job=script_job_1 processed=3.86 GiB billed=3.86 GiB state=DONE');
  });

  it('an absent statistic is "unmeasured", never 0', () => {
    const s = parseJobBytes(JSON.stringify({ jobReference: { jobId: 'j' }, status: { state: 'DONE', errorResult: { message: 'ASSERT failed' } } }));
    expect(s.processedBytes).toBeNull();
    expect(formatJobBytes('guard', s)).toContain('processed=unmeasured');
    expect(formatJobBytes('guard', s)).toContain('error="ASSERT failed"');
  });

  it('lists the child statements of the transactional script', () => {
    expect(parseChildJobIds(JSON.stringify([{ jobReference: { jobId: 'c1' } }, { jobReference: {} }, { jobReference: { jobId: 'c2' } }]))).toEqual(['c1', 'c2']);
    expect(parseChildJobIds('[]')).toEqual([]);
  });
});

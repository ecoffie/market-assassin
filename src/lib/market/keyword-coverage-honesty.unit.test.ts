import { describe, it, expect, vi, beforeEach } from 'vitest';

const runMock = vi.fn();

vi.mock('./keyword-coverage-bq', async () => {
  const actual = await vi.importActual<typeof import('./keyword-coverage-bq')>(
    './keyword-coverage-bq',
  );
  return {
    ...actual,
    runKeywordCoverageBq: (...args: unknown[]) => runMock(...args),
  };
});

import {
  CoverageDeadlineError,
  KeywordCoverageNotEstablishedError,
  __resetKeywordCoverageCacheForTests,
  keywordCoverage,
  queryKeywordCoverage,
} from './keyword-coverage';

beforeEach(() => {
  runMock.mockReset();
  __resetKeywordCoverageCacheForTests();
});

function foundRow(over: Record<string, unknown> = {}) {
  return {
    keyword: 'patrol',
    fiscalYear: 2025,
    transactionCount: 762,
    uniqueAwardCount: 484,
    totalMarket: 902_600_000,
    maxActionDate: '2025-09-30',
    naics: [{ code: '336611', name: 'Ship Building and Repairing', amount: 709_000_000 }],
    pscs: [{ code: '1905', name: 'Combat Ships and Landing Vessels', amount: 400_000_000 }],
    agencies: [{ name: 'DEPARTMENT OF DEFENSE', amount: 800_000_000 }],
    naicsCount: 1,
    pscCount: 1,
    ...over,
  };
}

describe('keywordCoverage honesty + cache', () => {
  it('FOUND caches a healthy payload and does not re-query inside TTL', async () => {
    runMock.mockResolvedValue(foundRow());
    const a = await keywordCoverage('patrol');
    const b = await keywordCoverage('patrol');
    expect(a?.source).toBe('bigquery_usaspending_awards');
    expect(a?.primarySense).toBe('work_text');
    expect(a?.totalMarket).toBe(902_600_000);
    expect(a?.allNaics[0].code).toBe('336611');
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it('NO_MATCHES_MEASURED is grounded-empty, not degraded, and is cacheable', async () => {
    runMock.mockResolvedValue(foundRow({
      transactionCount: 0,
      uniqueAwardCount: 0,
      totalMarket: 0,
      naics: [],
      pscs: [],
      agencies: [],
      naicsCount: 0,
      pscCount: 0,
    }));
    const result = await queryKeywordCoverage('zxqvplm');
    expect(result.status).toBe('NO_MATCHES_MEASURED');
    expect(result.degraded).toBe(false);
    expect(result.coverage).toBeNull();
    expect(await keywordCoverage('zxqvplm')).toBeNull();
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('BQ failure is NOT_ESTABLISHED — never $0, never cached as empty', async () => {
    runMock.mockRejectedValue(new Error('BigQuery job failed'));
    const result = await queryKeywordCoverage('patrol');
    expect(result.status).toBe('NOT_ESTABLISHED');
    expect(result.degraded).toBe(true);
    expect(result.coverage).toBeNull();
    await expect(keywordCoverage('patrol')).rejects.toBeInstanceOf(KeywordCoverageNotEstablishedError);

    runMock.mockResolvedValue(foundRow());
    const recovered = await keywordCoverage('patrol');
    expect(recovered?.totalMarket).toBe(902_600_000);
    expect(recovered?.naicsIdentityStatus).toBe('NOT_ESTABLISHED');
    expect(runMock).toHaveBeenCalledTimes(3);
  });

  it('does not treat a net-zero obligation market with real actions as empty', async () => {
    runMock.mockResolvedValue(foundRow({ totalMarket: 0, transactionCount: 4 }));
    const result = await queryKeywordCoverage('guard');
    expect(result.status).toBe('MARKET_EVIDENCE_FOUND');
    expect(result.coverage?.transactionCount).toBe(4);
    expect(result.coverage?.totalMarket).toBe(0);
  });

  it('throws CoverageDeadlineError when already aborted — not an empty market', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(keywordCoverage('patrol', 0.9, { signal: ac.signal }))
      .rejects.toBeInstanceOf(CoverageDeadlineError);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('aborts mid-flight as deadline, not NOT_ESTABLISHED and not $0', async () => {
    const ac = new AbortController();
    runMock.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal?.aborted) return fail();
        signal?.addEventListener('abort', fail, { once: true });
      });
    });
    const p = keywordCoverage('patrol boat', 0.9, { signal: ac.signal, perFetchMs: 60_000 });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toBeInstanceOf(CoverageDeadlineError);
  });
});

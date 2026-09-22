/**
 * EMPTY IS KNOWLEDGE, FAILURE IS UNKNOWN — the coverage layer (Credit Integrity follow-up).
 *
 * The market report treats these as its REQUIRED measurement. A failure that reads as
 * "zero awards" would publish a billable insufficient_evidence for a market Mindy never
 * actually measured.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mapKeywordCoverageBqRow } from './keyword-coverage-bq';
import { codeMarketSize } from './keyword-coverage';

const INPUT = { keyword: 'x', fiscalYear: 2025 };

describe('mapKeywordCoverageBqRow — malformed aggregate is a failure, not zero', () => {
  it('a real zero count is measured-empty', () => {
    expect(mapKeywordCoverageBqRow({ transaction_count: 0 } as never, INPUT).transactionCount).toBe(0);
    expect(mapKeywordCoverageBqRow({ transaction_count: { value: '0' } } as never, INPUT).transactionCount).toBe(0);
  });
  it.each([[undefined], [null], [''], ['n/a'], [{ value: null }]])('transaction_count=%j throws', (v) => {
    expect(() => mapKeywordCoverageBqRow({ transaction_count: v } as never, INPUT)).toThrow(/malformed/);
  });
});

describe('codeMarketSize — strict mode separates empty from failed', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (naics: () => Response, psc: () => Response = () => new Response(JSON.stringify({ results: [] }))) =>
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/naics/') ? naics() : psc())));

  it('HTTP 500: lenient returns null (existing callers unchanged); strict throws', async () => {
    respond(() => new Response('boom', { status: 500 }));
    expect(await codeMarketSize({ naics: '336411' })).toBeNull();
    await expect(codeMarketSize({ naics: '336411', strict: true })).rejects.toThrow(/HTTP 500/);
  });

  it('malformed body: strict throws', async () => {
    respond(() => new Response(JSON.stringify({ oops: true })));
    await expect(codeMarketSize({ naics: '336411', strict: true })).rejects.toThrow(/malformed/);
  });

  it('network error: strict throws', async () => {
    respond(() => { throw new TypeError('fetch failed'); });
    await expect(codeMarketSize({ naics: '336411', strict: true })).rejects.toThrow(/fetch failed/);
  });

  it('a successful query with zero awards is null (measured empty) even in strict mode', async () => {
    respond(() => new Response(JSON.stringify({ results: [] })));
    expect(await codeMarketSize({ naics: '999990', strict: true })).toBeNull();
  });

  it('enrichment category failing does not fail the strict basis measurement', async () => {
    respond(
      () => new Response(JSON.stringify({ results: [{ code: '336411', name: 'AIRCRAFT', amount: 10 }] })),
      () => new Response('down', { status: 503 }),
    );
    const r = await codeMarketSize({ naics: '336411', strict: true });
    expect(r?.totalMarket).toBe(10);
  });
});

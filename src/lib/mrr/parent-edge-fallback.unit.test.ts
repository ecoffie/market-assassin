import { beforeEach, describe, expect, it, vi } from 'vitest';

const bqQueryMock = vi.fn();

vi.mock('@/lib/bigquery/client', () => ({
  BQ_TABLES: {
    awards: '`market-assasin.usaspending.awards`',
    recipients: '`market-assasin.usaspending.recipients`',
  },
  bqJobOptions: (opts: Record<string, unknown>) => opts,
  bqQuery: (...args: unknown[]) => bqQueryMock(...args),
}));

import {
  batchParentEdgeLookup,
  resolveCorporateFamily,
  PARENT_EDGE_BATCH_MAX_BYTES,
  PARENT_EDGE_BATCH_MAX_UEIS,
  PARENT_EDGE_SINGLE_MAX_BYTES,
  assertBoundedParentBatch,
} from './corporate-family';

const CHILD = 'CHILD000000A';
const PARENT_A = 'PARENT00000A';
const PARENT_B = 'PARENT00000B';

beforeEach(() => {
  bqQueryMock.mockReset();
});

describe('parent-edge batch — no ANY_VALUE recipients fallback', () => {
  it('collects distinct parents; one supported parent may resolve', async () => {
    bqQueryMock.mockResolvedValueOnce([
      {
        recipient_uei: CHILD,
        parent_uei: PARENT_A,
        parent_name: 'Acme',
        award_count: 4,
        as_of: '2026-01-01',
      },
    ]);
    const lookup = batchParentEdgeLookup([CHILD, CHILD]);
    const resolved = await resolveCorporateFamily(CHILD, lookup);
    expect(bqQueryMock).toHaveBeenCalledTimes(1);
    expect(String(bqQueryMock.mock.calls[0]?.[0]?.query ?? '')).toMatch(/GROUP BY recipient_uei, parent_uei/);
    expect(String(bqQueryMock.mock.calls[0]?.[0]?.query ?? '')).not.toMatch(/recipients/);
    expect(resolved.method).toBe('usaspending_parent_uei');
    expect(resolved.ruleOfTwoEligible).toBe(true);
    expect(resolved.canonical?.familyKey).toBe(PARENT_A);
  });

  it('conflicting parents remain ambiguous — never a high-confidence parent', async () => {
    bqQueryMock.mockResolvedValueOnce([
      {
        recipient_uei: CHILD,
        parent_uei: PARENT_A,
        parent_name: 'Acme',
        award_count: 4,
        as_of: '2026-01-01',
      },
      {
        recipient_uei: CHILD,
        parent_uei: PARENT_B,
        parent_name: 'Beta',
        award_count: 2,
        as_of: '2026-02-01',
      },
    ]);
    const resolved = await resolveCorporateFamily(CHILD, batchParentEdgeLookup([CHILD]));
    expect(resolved.method).toBe('conflicting_parent_uei');
    expect(resolved.confidence).toBe('unresolved');
    expect(resolved.ruleOfTwoEligible).toBe(false);
  });

  it('quotaExceeded does not activate a weaker recipients fallback', async () => {
    const quota = Object.assign(new Error('QueryUsagePerDay'), {
      errors: [{ reason: 'quotaExceeded' }],
    });
    bqQueryMock.mockRejectedValueOnce(quota);
    const lookup = batchParentEdgeLookup([CHILD]);
    const resolved = await resolveCorporateFamily(CHILD, lookup);
    expect(bqQueryMock).toHaveBeenCalledTimes(1);
    expect(String(bqQueryMock.mock.calls[0]?.[0]?.query ?? '')).not.toMatch(/FROM `market-assasin.usaspending.recipients`/);
    expect(resolved.method).toBe('lookup_failed');
    expect(resolved.ruleOfTwoEligible).toBe(false);
  });

  it('a UEI missing from the batch does not trigger a second awards scan', async () => {
    bqQueryMock.mockResolvedValueOnce([]);
    const lookup = batchParentEdgeLookup([CHILD]);
    await lookup(CHILD);
    const other = await lookup('OTHER0000001');
    expect(bqQueryMock).toHaveBeenCalledTimes(1);
    expect(other.ok).toBe(false);
    expect(other.error).toMatch(/refusing a second awards scan/);
  });

  it('repeated parent keys among children still issue one awards scan', async () => {
    const sibling = 'CHILD000000B';
    bqQueryMock.mockResolvedValueOnce([
      {
        recipient_uei: CHILD,
        parent_uei: PARENT_A,
        parent_name: 'Acme',
        award_count: 4,
        as_of: '2026-01-01',
      },
      {
        recipient_uei: sibling,
        parent_uei: PARENT_A,
        parent_name: 'Acme',
        award_count: 3,
        as_of: '2026-01-02',
      },
    ]);
    const lookup = batchParentEdgeLookup([CHILD, sibling, CHILD]);
    const a = await resolveCorporateFamily(CHILD, lookup);
    const b = await resolveCorporateFamily(sibling, lookup);
    expect(bqQueryMock).toHaveBeenCalledTimes(1);
    expect(a.canonical?.familyKey).toBe(PARENT_A);
    expect(b.canonical?.familyKey).toBe(PARENT_A);
  });

  it('refuses 51 unique UEIs before querying', () => {
    const ueis = Array.from({ length: 51 }, (_, i) => `CHILD${String(i).padStart(7, '0')}`);
    expect(() => assertBoundedParentBatch(ueis)).toThrow(/51 unique UEIs exceeds the 50-UEI bound/);
    expect(() => batchParentEdgeLookup(ueis)).toThrow(/51 unique UEIs exceeds the 50-UEI bound/);
    expect(bqQueryMock).not.toHaveBeenCalled();
  });

  it('duplicate UEIs are queried once', async () => {
    bqQueryMock.mockResolvedValueOnce([]);
    const lookup = batchParentEdgeLookup([CHILD, CHILD, CHILD.toLowerCase()]);
    await lookup(CHILD);
    await lookup(CHILD);
    expect(bqQueryMock).toHaveBeenCalledTimes(1);
    expect(bqQueryMock.mock.calls[0]?.[0]?.params?.ueis).toEqual([CHILD]);
  });

  it('runs the parent query at most once per batch (per MRR run cache)', async () => {
    bqQueryMock.mockResolvedValueOnce([]);
    const lookup = batchParentEdgeLookup([CHILD, 'CHILD000000B']);
    await lookup(CHILD);
    await lookup('CHILD000000B');
    await lookup(CHILD);
    expect(bqQueryMock).toHaveBeenCalledTimes(1);
  });

  it('maximumBytesBilled failure causes zero retries and no recipients fallback', async () => {
    const billed = Object.assign(
      new Error('Query exceeded limit for bytes billed: 1073741824. 1454734807 or higher required.'),
      { errors: [{ reason: 'bytesBilledLimitExceeded' }] },
    );
    bqQueryMock.mockRejectedValueOnce(billed);
    const lookup = batchParentEdgeLookup([CHILD]);
    const resolved = await resolveCorporateFamily(CHILD, lookup);
    expect(bqQueryMock).toHaveBeenCalledTimes(1);
    expect(String(bqQueryMock.mock.calls[0]?.[0]?.query ?? '')).not.toMatch(/recipients/);
    expect(resolved.method).toBe('lookup_failed');
    expect(resolved.ruleOfTwoEligible).toBe(false);
  });

  it('quotaExceeded causes zero retries', async () => {
    const quota = Object.assign(new Error('QueryUsagePerDay quotaExceeded'), {
      errors: [{ reason: 'quotaExceeded' }],
    });
    bqQueryMock.mockRejectedValueOnce(quota);
    const lookup = batchParentEdgeLookup([CHILD]);
    await resolveCorporateFamily(CHILD, lookup);
    await resolveCorporateFamily(CHILD, lookup);
    expect(bqQueryMock).toHaveBeenCalledTimes(1);
  });

  it('configures the parent batch ceiling at exactly 2 GiB and keeps the single/activity ceilings at 1 GiB', async () => {
    expect(PARENT_EDGE_BATCH_MAX_BYTES).toBe(2 * 1024 * 1024 * 1024);
    expect(PARENT_EDGE_SINGLE_MAX_BYTES).toBe(1024 * 1024 * 1024);
    expect(PARENT_EDGE_BATCH_MAX_UEIS).toBe(50);
    bqQueryMock.mockResolvedValueOnce([]);
    await batchParentEdgeLookup([CHILD])(CHILD);
    expect(bqQueryMock.mock.calls[0]?.[0]?.maximumBytesBilled).toBe(PARENT_EDGE_BATCH_MAX_BYTES);
  });

  it('does not promote a malformed batch parent_uei into a high-confidence family', async () => {
    bqQueryMock.mockResolvedValueOnce([
      {
        recipient_uei: CHILD,
        parent_uei: 'BAD!!',
        parent_name: 'Garbage',
        award_count: 3,
        as_of: '2026-01-01',
      },
    ]);
    const resolved = await resolveCorporateFamily(CHILD, batchParentEdgeLookup([CHILD]));
    expect(resolved.confidence).toBe('unresolved');
    expect(resolved.canonical?.familyKey).not.toBe('BAD!!');
    expect(resolved.method).toBe('malformed_uei');
  });
});

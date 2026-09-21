import { beforeEach, describe, expect, it, vi } from 'vitest';

const bqQueryMock = vi.hoisted(() => vi.fn());

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return {
    ...actual,
    bqQuery: bqQueryMock,
  };
});

import {
  lookupFamilyMembers,
  lookupFamilyMembersBatch,
  resetFamilyMemberCacheForTests,
} from './family-members';

const FAMILY_A = 'PARENT000001';
const FAMILY_B = 'PARENT000002';

describe('recipient-rollup family member lookup', () => {
  beforeEach(() => {
    resetFamilyMemberCacheForTests();
    bqQueryMock.mockReset();
  });

  it('caches repeated family lookups for the life of the process', async () => {
    bqQueryMock.mockResolvedValue([{
      rollup_uei: FAMILY_A,
      rollup_name: 'Parent A',
      child_ueis: ['CHILD000000A', 'CHILD000000B'],
      as_of: '2026-08-28',
    }]);

    const first = await lookupFamilyMembers(FAMILY_A);
    const second = await lookupFamilyMembers(FAMILY_A.toLowerCase());
    const third = await lookupFamilyMembers(` ${FAMILY_A} `);

    expect(bqQueryMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(first).toMatchObject({
      ok: true,
      familyKey: FAMILY_A,
      memberUeis: [FAMILY_A, 'CHILD000000A', 'CHILD000000B'],
    });
  });

  it('deduplicates family keys and resolves a bounded batch in one query', async () => {
    bqQueryMock.mockResolvedValue([
      {
        rollup_uei: FAMILY_A,
        rollup_name: 'Parent A',
        child_ueis: ['CHILD000000A'],
        as_of: '2026-08-28',
      },
      {
        rollup_uei: FAMILY_B,
        rollup_name: 'Parent B',
        child_ueis: ['CHILD000000B'],
        as_of: '2026-08-28',
      },
    ]);

    const results = await lookupFamilyMembersBatch([
      FAMILY_A,
      FAMILY_B,
      FAMILY_A,
      FAMILY_B.toLowerCase(),
    ]);

    expect(bqQueryMock).toHaveBeenCalledTimes(1);
    expect(bqQueryMock.mock.calls[0][0].params.familyKeys).toEqual([FAMILY_A, FAMILY_B]);
    expect(results.size).toBe(2);

    const queryOptions = bqQueryMock.mock.calls[0][0];
    expect(queryOptions.query).toContain('recipients_rollup_merged');
    expect(queryOptions.query).toContain('rollup_uei IN UNNEST(@familyKeys)');
    expect(queryOptions.query).not.toMatch(/COALESCE\s*\(\s*parent_uei\s*,\s*recipient_uei\s*\)/i);
    expect(Number(queryOptions.maximumBytesBilled)).toBeLessThan(4_088_153_031);
    expect(queryOptions.labels).toEqual({
      feature: 'recipient-rollup',
      tool: 'family-member-expansion',
      query_family: 'rollup-child-ueis-batch',
    });
  });

  it('keeps failures and missing rollups unknown instead of zero-member success', async () => {
    bqQueryMock.mockRejectedValue(new Error('QueryUsagePerDay quota exceeded'));
    const failed = await lookupFamilyMembers(FAMILY_A);
    expect(failed).toEqual(expect.objectContaining({
      ok: false,
      reason: 'lookup_failed',
      memberUeis: [],
    }));

    resetFamilyMemberCacheForTests();
    bqQueryMock.mockReset();
    bqQueryMock.mockResolvedValue([]);
    const missing = await lookupFamilyMembers(FAMILY_A);
    expect(missing).toEqual(expect.objectContaining({
      ok: false,
      reason: 'rollup_not_found',
      memberUeis: [],
    }));
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  attempts: 0,
  constructorOptions: null as null | {
    retryOptions?: {
      retryableErrorFn?: (error: Error & {
        code?: number;
        errors?: Array<{ reason?: string; message?: string }>;
      }) => boolean;
    };
  },
  queryOptions: null as null | Record<string, unknown>,
  error: null as Error | null,
  rows: [] as unknown[],
}));

vi.mock('@google-cloud/bigquery', () => ({
  BigQuery: class MockBigQuery {
    constructor(options: typeof sdk.constructorOptions) {
      sdk.constructorOptions = options;
    }

    async query(options: Record<string, unknown>): Promise<[unknown[]]> {
      sdk.queryOptions = options;
      sdk.attempts += 1;
      if (sdk.error) {
        const retry = sdk.constructorOptions?.retryOptions?.retryableErrorFn?.(
          sdk.error,
        );
        // Simulate the SDK making a second HTTP attempt only when its configured
        // retry classifier permits one.
        if (retry) sdk.attempts += 1;
        throw sdk.error;
      }
      return [sdk.rows];
    }
  },
}));

import {
  assertSafeBigQueryShape,
  bqJobOptions,
  bqQuery,
  shouldRetryBigQueryError,
} from './client';

describe('BigQuery quota retry and job attribution', () => {
  beforeEach(() => {
    sdk.attempts = 0;
    sdk.queryOptions = null;
    sdk.error = null;
    sdk.rows = [];
  });

  it('fails QueryUsagePerDay once instead of automatically retrying', async () => {
    sdk.error = Object.assign(new Error(
      'Custom quota exceeded: Your usage exceeded the custom quota for QueryUsagePerDay',
    ), {
      code: 403,
      errors: [{ reason: 'quotaExceeded' }],
    });

    await expect(bqQuery({ query: 'SELECT 1' })).rejects.toThrow(/QueryUsagePerDay/);
    expect(sdk.attempts).toBe(1);
    expect(shouldRetryBigQueryError(sdk.error)).toBe(false);
  });

  it('fails maximumBytesBilled once instead of automatically retrying', async () => {
    sdk.error = Object.assign(new Error(
      'Query exceeded limit for bytes billed: 1073741824. 1454734807 or higher required.',
    ), {
      code: 400,
      errors: [{ reason: 'bytesBilledLimitExceeded' }],
    });

    await expect(bqQuery({ query: 'SELECT 1' })).rejects.toThrow(/bytes billed/);
    expect(sdk.attempts).toBe(1);
    expect(shouldRetryBigQueryError(sdk.error)).toBe(false);
  });

  it('preserves bounded retries for transient server failures', () => {
    const transient = Object.assign(new Error('backend unavailable'), { code: 503 });
    expect(shouldRetryBigQueryError(transient)).toBe(true);
  });

  it('passes normalized labels and the requested byte cap to the query job', async () => {
    await bqQuery({
      query: 'SELECT @uei AS recipient_uei',
      params: { uei: 'CHILD000000A' },
      ...bqJobOptions({
        feature: 'Recipient Rollup',
        tool: 'Contractor Route',
        queryFamily: 'Family Members',
        maximumBytesBilled: 64 * 1024 * 1024,
      }),
    });

    expect(sdk.queryOptions).toMatchObject({
      maximumBytesBilled: String(64 * 1024 * 1024),
      labels: {
        feature: 'recipient_rollup',
        tool: 'contractor_route',
        query_family: 'family_members',
      },
    });
  });

  it('blocks the unclustered full-family COALESCE equality before creating a job', async () => {
    const unsafe = `
      SELECT recipient_uei
      FROM \`market-assasin.usaspending.awards\`
      WHERE COALESCE(parent_uei, recipient_uei) = @familyKey
    `;

    expect(() => assertSafeBigQueryShape(unsafe)).toThrow(/Unsafe corporate-family scan/);
    await expect(bqQuery({ query: unsafe })).rejects.toThrow(/Unsafe corporate-family scan/);
    expect(sdk.attempts).toBe(0);
  });
});

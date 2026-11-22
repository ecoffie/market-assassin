import { describe, it, expect } from 'vitest';
import {
  classifyShareLookup,
  lookupOpportunityShare,
  type ShareLookupClient,
} from './opportunity-share-lookup';

function fakeClient(result: { data: unknown; error: unknown } | Error): ShareLookupClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (result instanceof Error) throw result;
            return result as { data: unknown; error: unknown };
          },
        }),
      }),
    }),
  };
}

describe('classifyShareLookup', () => {
  it('a row is found', () => {
    expect(classifyShareLookup({ data: { share_id: 'abc' }, error: null })).toBe('found');
  });
  it('no row and no error is missing (a real dead link)', () => {
    expect(classifyShareLookup({ data: null, error: null })).toBe('missing');
  });
  it('a query error is unknown, never missing', () => {
    expect(classifyShareLookup({ data: null, error: { message: 'timeout' } })).toBe('unknown');
  });
});

describe('lookupOpportunityShare', () => {
  it('returns missing for a nonexistent share id (page must 404)', async () => {
    await expect(lookupOpportunityShare('bogus-id-123', fakeClient({ data: null, error: null })))
      .resolves.toBe('missing');
  });
  it('returns found for an existing share id', async () => {
    await expect(lookupOpportunityShare('Ab3dEf7h', fakeClient({ data: { share_id: 'Ab3dEf7h' }, error: null })))
      .resolves.toBe('found');
  });
  it('returns unknown when the client throws', async () => {
    await expect(lookupOpportunityShare('x', fakeClient(new Error('fetch failed')))).resolves.toBe('unknown');
  });
  it('returns unknown when no client is available (missing env)', async () => {
    await expect(lookupOpportunityShare('x', null)).resolves.toBe('unknown');
  });
  it('returns missing for an empty share id', async () => {
    await expect(lookupOpportunityShare('', fakeClient({ data: { share_id: 'a' }, error: null }))).resolves.toBe('missing');
  });
});

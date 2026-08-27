/**
 * Regression: resolvePiidToId must include full IDV subtypes (esp. IDV_B_B).
 * FA461025D0001 is a real USASpending IDIQ (type IDV_B_B). Coarse IDV_A..E
 * filters return 0 rows; the award only appears when IDV_B_B is in the request.
 *
 * Network is fully mocked — this suite must never call USASpending live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePiidToId } from '@/lib/usaspending/award-detail';
import { CONTRACT_CODES, IDV_CODES } from '@/lib/usaspending/award-type-codes';

const FIXTURE_PIID = 'FA461025D0001';
const FIXTURE_GENERATED_ID = 'CONT_IDV_FA461025D0001_9700';
const DEFINITIVE_PIID = '140F0822D0024';
const DEFINITIVE_GENERATED_ID = 'CONT_AWD_140F0822D0024_1448';
const IDV_A_PIID = 'HT001421D0001';
const IDV_A_GENERATED_ID = 'CONT_IDV_HT001421D0001_9700';

type SearchBody = {
  filters?: { award_type_codes?: string[]; keywords?: string[] };
};

function parseBody(init?: RequestInit): SearchBody {
  if (!init?.body) return {};
  return JSON.parse(String(init.body)) as SearchBody;
}

/** USASpending-shaped mock: IDV_B_B rows only when IDV_B_B is in award_type_codes. */
function stubUsaSpendingSearch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = parseBody(init);
    const codes = body.filters?.award_type_codes ?? [];
    const keyword = String(body.filters?.keywords?.[0] ?? '').toUpperCase();
    const isIdvGroup = codes.some((c) => c.startsWith('IDV_'));
    const isContractGroup = codes.every((c) => ['A', 'B', 'C', 'D'].includes(c)) && codes.length > 0;

    let results: Array<{ 'Award ID': string; generated_internal_id: string }> = [];

    if (keyword === FIXTURE_PIID && codes.includes('IDV_B_B')) {
      results = [{ 'Award ID': FIXTURE_PIID, generated_internal_id: FIXTURE_GENERATED_ID }];
    } else if (keyword === IDV_A_PIID && codes.includes('IDV_A')) {
      results = [{ 'Award ID': IDV_A_PIID, generated_internal_id: IDV_A_GENERATED_ID }];
    } else if (keyword === DEFINITIVE_PIID && isContractGroup && !isIdvGroup) {
      results = [{ 'Award ID': DEFINITIVE_PIID, generated_internal_id: DEFINITIVE_GENERATED_ID }];
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

describe('resolvePiidToId — IDV type-code alignment', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = stubUsaSpendingSearch() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('includes IDV_B_B in the IDV award_type_codes request group', async () => {
    await resolvePiidToId(FIXTURE_PIID);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const idvCalls = fetchMock.mock.calls
      .map(([, init]) => parseBody(init as RequestInit))
      .filter((b) => (b.filters?.award_type_codes ?? []).some((c) => c.startsWith('IDV_')));
    expect(idvCalls.length).toBeGreaterThan(0);
    const codes = idvCalls[0].filters?.award_type_codes ?? [];
    expect(codes).toContain('IDV_B_B');
    expect(codes).toEqual(expect.arrayContaining([...IDV_CODES]));
  });

  it('resolves FA461025D0001 (IDV_B_B) to the fixture generated_internal_id', async () => {
    await expect(resolvePiidToId(FIXTURE_PIID)).resolves.toBe(FIXTURE_GENERATED_ID);
  });

  it('still resolves a definitive contract PIID via the contract type group', async () => {
    await expect(resolvePiidToId(DEFINITIVE_PIID)).resolves.toBe(DEFINITIVE_GENERATED_ID);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const contractCalls = fetchMock.mock.calls
      .map(([, init]) => parseBody(init as RequestInit))
      .filter((b) => {
        const codes = b.filters?.award_type_codes ?? [];
        return codes.length > 0 && codes.every((c) => ['A', 'B', 'C', 'D'].includes(c));
      });
    expect(contractCalls.length).toBeGreaterThan(0);
    expect(contractCalls[0].filters?.award_type_codes).toEqual(expect.arrayContaining([...CONTRACT_CODES]));
  });

  it('still resolves other supported IDV types (IDV_A)', async () => {
    await expect(resolvePiidToId(IDV_A_PIID)).resolves.toBe(IDV_A_GENERATED_ID);
  });

  it('returns null for an unknown PIID (grounded miss, not an upstream throw)', async () => {
    await expect(resolvePiidToId('ZZZZZZ99Z9999')).resolves.toBeNull();
  });

  it('does not require a live network call', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await resolvePiidToId(FIXTURE_PIID);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toContain('api.usaspending.gov');
    }
    expect(fetchMock).toHaveBeenCalled();
    // Stubbed Response only — no real socket.
    expect(fetchMock.mock.results.every((r) => r.type === 'return')).toBe(true);
  });
});

describe('canonical IDV_CODES shared across consumers', () => {
  it('award-detail, awards-search, and idv-search import the shared constant (no local IDV_CODES literal)', () => {
    const files = [
      resolve(__dirname, 'award-detail.ts'),
      resolve(__dirname, 'awards-search.ts'),
      resolve(__dirname, '../idv-search.ts'),
    ];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src).toMatch(/award-type-codes/);
      expect(src).toMatch(/\bIDV_CODES\b/);
      expect(src).not.toMatch(/const\s+IDV_CODES\s*=/);
    }
  });

  it('canonical list matches the supported IDV subtypes', () => {
    expect([...IDV_CODES]).toEqual([
      'IDV_A',
      'IDV_B',
      'IDV_B_A',
      'IDV_B_B',
      'IDV_B_C',
      'IDV_C',
      'IDV_D',
      'IDV_E',
    ]);
  });
});

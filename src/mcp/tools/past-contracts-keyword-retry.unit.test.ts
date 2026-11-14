/**
 * search_past_contracts keyword retry-on-zero (acceptance attempt 6, R5). USASpending keyword search is
 * an exact phrase: "Navy ID card" (agency Navy already filtered) found nothing although the Navy awards
 * read "IDENTIFICATION CARD ...". The retry removes agency words and spells out abbreviations, and is
 * reported in applied_filters.keyword_retry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchMock = vi.fn();
vi.mock('@/lib/usaspending/awards-search', () => ({ searchAwardsByLocation: (args: unknown) => searchMock(args) }));
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { aiHint: false } }));

import { searchPastContracts, keywordVariants } from './past-contracts';

const empty = { awards: [], count: 0, totalEstimate: 0, degraded: false, requestsFired: 1 };
const hit = (kw: string) => ({ awards: [{ awardId: 'N0018925CZ092', recipientName: 'X', awardAmount: 1, agency: 'DOD' }], count: 1, totalEstimate: 1, degraded: false, requestsFired: 1, textFilters: { keyword: { value: kw, applied: 'server_keyword' } } });

beforeEach(() => searchMock.mockReset());

describe('keywordVariants', () => {
  it('removes words the agency filter covers, then spells out abbreviations', () => {
    expect(keywordVariants('Navy ID card', 'Navy')).toEqual(['ID card', 'identification card']);
    expect(keywordVariants('identification card', 'Navy')).toEqual([]);
    expect(keywordVariants('Navy', 'Navy')).toEqual([]); // never empties the keyword
  });
});

describe('retry on zero', () => {
  it('retries an empty keyword search and reports what was used', async () => {
    searchMock.mockImplementation(async (a?: { keyword?: string }) => (a?.keyword === 'identification card' ? hit('identification card') : empty));
    const r = await searchPastContracts({ keyword: 'Navy ID card', agency: 'Navy', state: 'TN', state_scope: 'pop' });
    expect(r.awards.length).toBe(1);
    expect((r._meta as any).applied_filters.keyword_retry).toEqual({ requested: 'Navy ID card', used: 'identification card' });
  });
  it('does not retry when the first search finds awards', async () => {
    searchMock.mockResolvedValue(hit('identification card'));
    await searchPastContracts({ keyword: 'identification card', agency: 'Navy', state: 'TN', state_scope: 'pop' });
    expect(searchMock).toHaveBeenCalledTimes(1);
  });
});

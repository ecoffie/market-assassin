/**
 * Call site for lookupNaicsProfile: /naics/<code> may 404 only when the profile read ANSWERED
 * "no such code". An unknown read must throw SeoTemporarilyUnavailableError (a 5xx that ISR
 * does not cache), never notFound() (a 404 held for 7 days). CLAUDE.md rule 5.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.fn();
vi.mock('@/lib/bigquery/naics', () => ({
  lookupNaicsProfile: (code: string) => lookup(code),
  getTopRecipientsForNaics: vi.fn(async () => []),
  getTopAgenciesForNaics: vi.fn(async () => []),
  getNaicsSetAsideAndPsc: vi.fn(async () => null),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

import NaicsCodePage, { generateMetadata } from './page';
import { isSeoTemporarilyUnavailable } from '@/lib/seo/seo-unavailable';

const params = (code: string) => ({ params: Promise.resolve({ code }) });

beforeEach(() => lookup.mockReset());

describe('/naics/[code] outside the top 100', () => {
  it('unknown profile read -> temporary 5xx, not a 404', async () => {
    lookup.mockResolvedValue({ kind: 'unavailable', reason: 'failed' });
    const err = await NaicsCodePage(params('236210')).catch((e: unknown) => e);
    expect(isSeoTemporarilyUnavailable(err)).toBe(true);
    const meta = await generateMetadata(params('236210'));
    expect(String(meta.title)).not.toMatch(/not found/i);
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('measured absent -> 404', async () => {
    lookup.mockResolvedValue({ kind: 'absent' });
    await expect(NaicsCodePage(params('999999'))).rejects.toThrow('NEXT_NOT_FOUND');
    const meta = await generateMetadata(params('999999'));
    expect(String(meta.title)).toMatch(/not found/i);
  });

  it('found profile -> renders the page', async () => {
    lookup.mockResolvedValue({
      kind: 'found',
      profile: {
        naics_code: '236210',
        naics_description: 'Industrial Building Construction',
        total_obligated: 1_000_000,
        recipient_count: 12,
        agency_count: 3,
        transaction_count: 40,
      },
    });
    const el = await NaicsCodePage(params('236210'));
    expect(el).toBeTruthy();
    const meta = await generateMetadata(params('236210'));
    expect(String(meta.title)).toContain('NAICS 236210: Industrial Building Construction');
  });
});

/**
 * Contracts pages past SERVED_MAX_PAGES are never built, so they 308 to the listing instead of spending a
 * cold-budget unit and 5xx-ing (2026-11-23/24: 209 page-4 500s). HELD for Eric — branch only.
 */
import { describe, it, expect, vi } from 'vitest';

const nav = vi.hoisted(() => ({ redirects: [] as string[] }));
vi.mock('next/navigation', () => ({
  permanentRedirect: (u: string) => { nav.redirects.push(u); throw new Error(`REDIRECT:${u}`); },
  notFound: () => { throw new Error('NOT_FOUND'); },
}));
const reads = vi.hoisted(() => ({ resolve: 0, load: 0 }));
vi.mock('@/lib/seo/contractor-page-data', () => ({
  resolveContractorForPage: vi.fn(async () => { reads.resolve++; return { kind: 'not_found' }; }),
  loadContractsPage: vi.fn(async () => { reads.load++; return { kind: 'unavailable', reason: 'x' }; }),
}));

import { SERVED_MAX_PAGES } from '@/lib/awards-serving';

describe('contracts pages beyond SERVED_MAX_PAGES', () => {
  it(`page ${SERVED_MAX_PAGES + 1} 308s to /contracts before any read (page and metadata)`, async () => {
    const mod = await import('../page');
    const params = Promise.resolve({ slug: 'hodges-transportation-inc', page: [String(SERVED_MAX_PAGES + 1)] });
    await expect(mod.default({ params })).rejects.toThrow('REDIRECT:/contractors/hodges-transportation-inc/contracts');
    await expect(mod.generateMetadata({ params: Promise.resolve({ slug: 'hodges-transportation-inc', page: ['4'] }) }))
      .rejects.toThrow('REDIRECT:/contractors/hodges-transportation-inc/contracts');
    expect(reads.resolve).toBe(0);
    expect(reads.load).toBe(0);
  });
  it(`page ${SERVED_MAX_PAGES} is not redirected (it is built)`, async () => {
    const mod = await import('../page');
    await expect(mod.default({ params: Promise.resolve({ slug: 'x', page: [String(SERVED_MAX_PAGES)] }) })).rejects.toThrow('NOT_FOUND');
    expect(nav.redirects.filter((u) => u.endsWith('/x/contracts'))).toHaveLength(0);
  });
});

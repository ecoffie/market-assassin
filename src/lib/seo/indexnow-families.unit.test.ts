import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/seo/sitemap-sections', () => ({
  SITE_URL: 'https://getmindy.ai',
  officeEntries: vi.fn(async () => [{ url: 'https://getmindy.ai/offices/W912PL' }]),
  closedOpportunityEntries: vi.fn(async () => [{ url: 'https://getmindy.ai/opportunity/x-1' }]),
  recompeteEntries: vi.fn(async (c: number) => [{ url: `https://getmindy.ai/recompetes/r--${c}` }]),
}));
vi.mock('@/lib/seo/forecast-pages', () => ({
  getForecastSitemapEntries: vi.fn(async () => [{ slug: 'it-support-abc' }]),
}));
vi.mock('@/lib/seo/recompetes', () => ({ RECOMPETE_SITEMAP_CHILD_COUNT: 3 }));

import { familyUrls, nextSlice, INDEXNOW_MAX } from './indexnow-families';
import { officeEntries } from '@/lib/seo/sitemap-sections';

describe('nextSlice', () => {
  it('walks a large family in IndexNow-sized slices and wraps', () => {
    expect(nextSlice(25_000, 0)).toEqual({ start: 0, end: INDEXNOW_MAX, next: INDEXNOW_MAX });
    expect(nextSlice(25_000, 20_000)).toEqual({ start: 20_000, end: 25_000, next: 0 });
  });
  it('restarts at 0 when the stored cursor is past a shrunken set', () => {
    expect(nextSlice(500, 9_000)).toEqual({ start: 0, end: 500, next: 0 });
  });
  it('an empty family submits nothing', () => {
    expect(nextSlice(0, 0)).toEqual({ start: 0, end: 0, next: 0 });
  });
});

describe('familyUrls reads the same gated lists as the sitemaps', () => {
  it('maps each family to public URLs', async () => {
    expect(await familyUrls('offices')).toEqual(['https://getmindy.ai/offices/W912PL']);
    expect(await familyUrls('closed')).toEqual(['https://getmindy.ai/opportunity/x-1']);
    expect(await familyUrls('forecasts')).toEqual(['https://getmindy.ai/forecasts/it-support-abc']);
    expect(await familyUrls('recompetes')).toEqual([0, 1, 2].map((c) => `https://getmindy.ai/recompetes/r--${c}`));
  });
  it('a failed read throws instead of submitting an empty list', async () => {
    vi.mocked(officeEntries).mockRejectedValueOnce(new Error('db down'));
    await expect(familyUrls('offices')).rejects.toThrow('db down');
  });
});

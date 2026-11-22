/**
 * Key public pages must carry a share image.
 *
 * Next.js REPLACES a parent's `openGraph` when a page sets its own, so any page that declares
 * `openGraph` without `images` loses the root opengraph-image card. Live 2026-11-21: /, /pricing,
 * /opportunity/<slug>, /forecasts and /naics/336413/va had 0 og:image tags, and the homepage
 * twitter:title still read the root's "Meet Mindy." These tests call the real metadata exports
 * (the call sites), not just the helper.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';

const NOTICE = '0fdb5f972b2a46648adf2e2b8a6558ce';

vi.mock('@/lib/seo/opportunities', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/opportunities')>()),
  getOpportunityBySlug: vi.fn(async () => ({
    noticeId: NOTICE,
    title: 'Lawn Mowing Services',
    department: 'Department of the Army',
    subTier: null,
    solicitationNumber: 'W1234',
    naicsCode: '561730',
    noticeType: 'Solicitation',
    responseDeadline: '2099-01-01T00:00:00Z',
    active: true,
    awardeeName: null,
    awardDate: null,
  })),
  getRelatedOpenOpportunities: vi.fn(async () => []),
}));

vi.mock('@/lib/seo/forecasts-summary', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/forecasts-summary')>()),
  getForecastSummary: vi.fn(async () => ({ available: false })),
}));

vi.mock('@/lib/seo/forecast-pages', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/forecast-pages')>()),
  getForecastById: vi.fn(async (id: string) => ({
    forecast: {
      id,
      title: 'Base operations support',
      sourceAgency: 'DHS',
      department: null,
      fiscalYear: null,
      anticipatedQuarter: null,
      naicsCode: null,
      valueMin: null,
      valueMax: null,
      valueRangeText: null,
      setAside: null,
    },
    indexability: { indexable: true },
    canonicalId: id,
    canonicalSlug: `base-operations-support-${id}`,
  })),
}));

vi.mock('@/lib/bigquery/naics', () => ({
  getNaicsProfile: vi.fn(async () => null),
  getTopRecipientsForNaics: vi.fn(async () => []),
  getTopAgenciesForNaics: vi.fn(async () => []),
  getNaicsSetAsideAndPsc: vi.fn(async () => null),
}));

import { SITE_SHARE_IMAGE, opportunityShareImages, siteShareImages } from './share-image';

function ogImages(m: Metadata): Array<{ url: string }> {
  const imgs = (m.openGraph as { images?: unknown } | undefined)?.images;
  return (Array.isArray(imgs) ? imgs : imgs ? [imgs] : []) as Array<{ url: string }>;
}

describe('share-image helper', () => {
  it('site card is the root opengraph-image (1200x630)', () => {
    expect(siteShareImages()).toEqual([
      { url: 'https://getmindy.ai/opengraph-image', width: 1200, height: 630, alt: SITE_SHARE_IMAGE.alt },
    ]);
  });
  it('opportunity card uses the existing per-notice OG route', () => {
    expect(opportunityShareImages(NOTICE.toUpperCase(), 'X')[0].url).toBe(`https://getmindy.ai/opportunity-map/og/${NOTICE}`);
  });
  it('a non-notice id falls back to the site card, never a broken URL', () => {
    expect(opportunityShareImages('not-an-id')).toEqual(siteShareImages());
    expect(opportunityShareImages(null)).toEqual(siteShareImages());
  });
});

describe('page metadata call sites carry og:image', () => {
  it('homepage: og:image + its own twitter block (no stale "Meet Mindy.")', async () => {
    const { metadata } = await import('@/app/home/page');
    expect(ogImages(metadata)[0]?.url).toBe(SITE_SHARE_IMAGE.url);
    const tw = metadata.twitter as { card?: string; title?: string; images?: Array<{ url: string }> };
    expect(tw.card).toBe('summary_large_image');
    expect(tw.title).toBe(metadata.title);
    expect(tw.title).not.toBe('Meet Mindy.');
    expect(tw.images?.[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('pricing', async () => {
    const { metadata } = await import('@/app/pricing/page');
    expect(ogImages(metadata)[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('naics index', async () => {
    const { metadata } = await import('@/app/naics/page');
    expect(ogImages(metadata)[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('naics code page', async () => {
    const { generateMetadata } = await import('@/app/naics/[code]/page');
    const m = await generateMetadata({ params: Promise.resolve({ code: '541330' }) });
    expect(ogImages(m)[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('naics state facet page', async () => {
    const { generateMetadata } = await import('@/app/naics/[code]/[state]/page');
    const m = await generateMetadata({ params: Promise.resolve({ code: '336413', state: 'va' }) });
    expect(ogImages(m)[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('forecasts index', async () => {
    const { generateMetadata } = await import('@/app/forecasts/page');
    const m = await generateMetadata();
    expect(ogImages(m)[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('forecast detail page', async () => {
    const { generateMetadata } = await import('@/app/forecasts/[id]/page');
    const id = '3f2b8c1e-1d2a-4b5c-8d9e-0a1b2c3d4e5f';
    const m = await generateMetadata({ params: Promise.resolve({ id: `base-operations-support-${id}` }) });
    expect(ogImages(m)[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('opportunity page uses that notice’s own card', async () => {
    const { generateMetadata } = await import('@/app/opportunity/[slug]/page');
    const m = await generateMetadata({ params: Promise.resolve({ slug: 'lawn-mowing-services-8a6558ce' }) });
    expect(ogImages(m)[0]?.url).toBe(`https://getmindy.ai/opportunity-map/og/${NOTICE}`);
  });
});

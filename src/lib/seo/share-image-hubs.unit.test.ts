/**
 * Hub and blog pages must carry a share image (scout, 2026-11-22).
 *
 * Live before this fix: /contractors, /offices, /offices/FA2518, /recompetes, /blog and
 * /blog/federal-contract-recompetes-guide had og:title but 0 og:image tags, because each sets
 * its own `openGraph` object (Next.js replaces the root opengraph-image card instead of merging).
 * These tests call the real metadata exports (the call sites), following #2267.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';

vi.mock('@/lib/seo/offices', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/offices')>()),
  getOfficeHubEntries: vi.fn(async () => []),
  getOfficePageData: vi.fn(async () => ({
    dodaac: 'FA2518',
    name: 'USSF SPOC/SAIO',
    agency: 'Department of Defense',
    subAgency: 'Department of the Air Force',
    openCount: 3,
    activeNotices: 5,
    contacts: { count: 2, capped: false },
    indexable: true,
  })),
}));

vi.mock('@/lib/seo/recompetes', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/recompetes')>()),
  getRecompeteHubLinks: vi.fn(async () => []),
}));

import { SITE_SHARE_IMAGE } from './share-image';
import { BLOG_POSTS } from '@/data/blog-posts';

function ogImages(m: Metadata): Array<{ url: string }> {
  const imgs = (m.openGraph as { images?: unknown } | undefined)?.images;
  return (Array.isArray(imgs) ? imgs : imgs ? [imgs] : []) as Array<{ url: string }>;
}
function twImages(m: Metadata): Array<{ url: string }> {
  const imgs = (m.twitter as { images?: unknown } | undefined)?.images;
  return (Array.isArray(imgs) ? imgs : imgs ? [imgs] : []) as Array<{ url: string }>;
}

describe('hub and blog metadata call sites carry og:image', () => {
  it('contractors directory (og + twitter)', async () => {
    const { metadata } = await import('@/app/contractors/page');
    expect(ogImages(metadata)[0]?.url).toBe(SITE_SHARE_IMAGE.url);
    expect(twImages(metadata)[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('buying offices hub', async () => {
    const { generateMetadata } = await import('@/app/offices/page');
    expect(ogImages(await generateMetadata())[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('office page', async () => {
    const { generateMetadata } = await import('@/app/offices/[dodaac]/page');
    const m = await generateMetadata({ params: Promise.resolve({ dodaac: 'FA2518' }) });
    expect(ogImages(m)[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('recompetes hub', async () => {
    const { generateMetadata } = await import('@/app/recompetes/page');
    expect(ogImages(await generateMetadata())[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('blog index', async () => {
    const { metadata } = await import('@/app/blog/page');
    expect(ogImages(metadata)[0]?.url).toBe(SITE_SHARE_IMAGE.url);
  });

  it('every blog post (og + twitter)', async () => {
    const { generateMetadata } = await import('@/app/blog/[slug]/page');
    expect(BLOG_POSTS.length).toBeGreaterThan(0);
    for (const p of BLOG_POSTS) {
      const m = await generateMetadata({ params: Promise.resolve({ slug: p.slug }) });
      expect(ogImages(m)[0]?.url, p.slug).toBe(SITE_SHARE_IMAGE.url);
      expect(twImages(m)[0]?.url, p.slug).toBe(SITE_SHARE_IMAGE.url);
    }
  });
});

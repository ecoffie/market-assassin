/**
 * Static sitemap pages must carry a share image (scout, 2026-11-22).
 *
 * Live before this fix: 177 of 346 static sitemap URLs had 0 og:image tags — glossary (65),
 * /top (65), /learn (26), /compare (6), /set-asides (5), /research (4), /market-intelligence,
 * /roadmap, /lifetime, /lazy-contractors-blueprint — and glossary pages inherited the root
 * twitter:title "Meet Mindy.". These tests call the real metadata exports and raw-HTML
 * renderers (the call sites), following #2267.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';

vi.mock('@/lib/ghl/event-registration', () => ({ countContactsByTag: vi.fn(async () => null) }));

import { SITE_SHARE_IMAGE, shareImageMetaTags } from './share-image';
import { glossaryTerms as GLOSSARY_TERMS } from '@/data/glossary';
import { LISTICLES } from '@/data/top-listicles';
import { COMPETITORS } from '@/data/competitors';
import { learnIndexHtml, missionHtml } from '@/lib/learn/render';
import { MISSIONS } from '@/lib/learn/missions';
import { govPage } from '@/lib/gov/shell';

function list(v: unknown): Array<{ url: string }> {
  return (Array.isArray(v) ? v : v ? [v] : []) as Array<{ url: string }>;
}
const ogUrl = (m: Metadata) => list((m.openGraph as { images?: unknown } | undefined)?.images)[0]?.url;
const twUrl = (m: Metadata) => list((m.twitter as { images?: unknown } | undefined)?.images)[0]?.url;
const twTitle = (m: Metadata) => (m.twitter as { title?: unknown } | undefined)?.title;

const STATIC_METADATA: Array<[string, () => Promise<{ metadata: Metadata }>]> = [
  ['/glossary', () => import('@/app/glossary/page')],
  ['/top', () => import('@/app/top/page')],
  ['/compare/govwin', () => import('@/app/compare/govwin/page')],
  ['/compare/sam-gov', () => import('@/app/compare/sam-gov/page')],
  ['/set-asides', () => import('@/app/set-asides/page')],
  ['/set-asides/8a', () => import('@/app/set-asides/8a/page')],
  ['/set-asides/hubzone', () => import('@/app/set-asides/hubzone/page')],
  ['/set-asides/sdvosb', () => import('@/app/set-asides/sdvosb/page')],
  ['/set-asides/wosb', () => import('@/app/set-asides/wosb/page')],
  ['/market-intelligence', () => import('@/app/market-intelligence/layout')],
  ['/roadmap', () => import('@/app/roadmap/page')],
  ['/lifetime', () => import('@/app/lifetime/page')],
  ['/lazy-contractors-blueprint', () => import('@/app/lazy-contractors-blueprint/page')],
];

describe('static page metadata carries og:image', () => {
  for (const [path, load] of STATIC_METADATA) {
    it(path, async () => {
      const { metadata } = await load();
      expect(ogUrl(metadata)).toBe(SITE_SHARE_IMAGE.url);
    });
  }

  it('/glossary index has its own twitter title + image', async () => {
    const { metadata } = await import('@/app/glossary/page');
    expect(twTitle(metadata)).not.toBe('Meet Mindy.');
    expect(twTitle(metadata)).toBeTruthy();
    expect(twUrl(metadata)).toBe(SITE_SHARE_IMAGE.url);
  });

  it('every glossary term: og + twitter image, term-specific twitter title', async () => {
    const { generateMetadata } = await import('@/app/glossary/[slug]/page');
    expect(GLOSSARY_TERMS.length).toBeGreaterThan(0);
    for (const t of GLOSSARY_TERMS) {
      const m = await generateMetadata({ params: Promise.resolve({ slug: t.slug }) });
      expect(ogUrl(m), t.slug).toBe(SITE_SHARE_IMAGE.url);
      expect(twUrl(m), t.slug).toBe(SITE_SHARE_IMAGE.url);
      expect(twTitle(m), t.slug).toContain(t.term);
    }
  });

  it('every /top listicle (og + twitter)', async () => {
    const { generateMetadata } = await import('@/app/top/[slug]/page');
    for (const l of LISTICLES) {
      const m = await generateMetadata({ params: Promise.resolve({ slug: l.slug }) });
      expect(ogUrl(m), l.slug).toBe(SITE_SHARE_IMAGE.url);
      expect(twUrl(m), l.slug).toBe(SITE_SHARE_IMAGE.url);
    }
  });

  it('every data-driven /compare page', async () => {
    const { generateMetadata } = await import('@/app/compare/[competitor]/page');
    for (const c of COMPETITORS) {
      const m = await generateMetadata({ params: Promise.resolve({ competitor: c.slug }) });
      expect(ogUrl(m), c.slug).toBe(SITE_SHARE_IMAGE.url);
    }
  });
});

describe('raw-HTML pages carry og:image', () => {
  const ogTag = `<meta property="og:image" content="${SITE_SHARE_IMAGE.url}">`;

  it('shareImageMetaTags emits og + twitter image tags', () => {
    const tags = shareImageMetaTags();
    expect(tags).toContain(ogTag);
    expect(tags).toContain('<meta property="og:image:width" content="1200">');
    expect(tags).toContain(`<meta name="twitter:image" content="${SITE_SHARE_IMAGE.url}">`);
  });

  it('/learn index and every mission', () => {
    expect(learnIndexHtml()).toContain(ogTag);
    expect(MISSIONS.length).toBeGreaterThan(0);
    for (const m of MISSIONS) expect(missionHtml(m), m.slug).toContain(ogTag);
  });

  it('gov shell (/research, /research/about, /research/how-we-publish)', () => {
    const html = govPage({ title: 'T', description: 'D', active: 'research', body: '' });
    expect(html).toContain(ogTag);
  });
});

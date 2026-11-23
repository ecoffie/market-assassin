/**
 * Share-card images for pages that declare their own `openGraph` metadata.
 *
 * Next.js replaces (does not merge) a parent's `openGraph` object when a page sets its own, so the
 * root `src/app/opengraph-image.tsx` convention card is DROPPED on every such page unless the page
 * lists `images` itself. Before this helper, /, /pricing, /opportunity/<slug>, /forecasts and the
 * /naics pages shipped zero og:image tags and shared links showed no picture (scout, 2026-11-21).
 *
 * `SITE_SHARE_IMAGE` points at the root card (served at /opengraph-image, 1200×630 PNG; alt text
 * mirrors that file's `alt` export). `opportunityShareImage` points at the per-notice card that
 * already exists for Opportunity Map shares (src/app/opportunity-map/og/[id]/route.tsx).
 */
const SITE_URL = 'https://getmindy.ai';

export interface ShareImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export const SITE_SHARE_IMAGE: ShareImage = {
  url: `${SITE_URL}/opengraph-image`,
  width: 1200,
  height: 630,
  alt: 'Mindy — Your 24/7 Federal Market Intelligence Analyst',
};

/** The root card as an `openGraph.images` / `twitter.images` value. */
export function siteShareImages(): ShareImage[] {
  return [{ ...SITE_SHARE_IMAGE }];
}

const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The root card as raw `<meta>` tags, for pages rendered as HTML strings by route handlers
 * (/learn, the gov shell behind /research), which never receive Next's metadata output.
 */
export function shareImageMetaTags(img: ShareImage = SITE_SHARE_IMAGE): string {
  const url = escAttr(img.url);
  return [
    `<meta property="og:image" content="${url}">`,
    `<meta property="og:image:width" content="${img.width}">`,
    `<meta property="og:image:height" content="${img.height}">`,
    `<meta property="og:image:alt" content="${escAttr(img.alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image" content="${url}">`,
  ].join('\n');
}

/**
 * The per-opportunity card. The route renders a generic card for an unknown id, so this never
 * points at a broken image; an id that is not a SAM notice id falls back to the site card.
 */
export function opportunityShareImages(noticeId: string | null | undefined, title?: string | null): ShareImage[] {
  if (!noticeId || !/^[a-f0-9]{32}$/i.test(noticeId)) return siteShareImages();
  return [
    {
      url: `${SITE_URL}/opportunity-map/og/${encodeURIComponent(noticeId.toLowerCase())}`,
      width: 1200,
      height: 630,
      alt: title ? `${title} — federal opportunity` : 'Federal government opportunity',
    },
  ];
}

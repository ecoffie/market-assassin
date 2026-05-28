/**
 * Blog post registry
 * ==================
 *
 * Source of truth for the /blog index, sitemap iteration, related-post
 * links, and JSON-LD `Blog` schema. The actual post BODIES live in each
 * post's own page.tsx (src/app/blog/[slug]/page.tsx — wait, dynamic
 * route), so this file only carries metadata.
 *
 * Why no MDX / no CMS:
 *   - We're launching with 3 posts. MDX tooling adds bundle weight,
 *     loader config, and a new failure surface for what amounts to
 *     three static pages.
 *   - JSX-in-page-file gives us full TS typing on the body, server
 *     rendering by default, and Tailwind class-checking in the editor.
 *   - When the post count crosses ~10-15, refactor to MDX (or pull
 *     content from Supabase). Until then, the cost of MDX > the cost
 *     of writing JSX inline.
 *
 * Slug rules:
 *   - kebab-case, no trailing slash, no leading slash
 *   - Slug is the URL: /blog/{slug}
 *   - Don't change slugs after publish — it breaks inbound links and
 *     resets Google's accumulated ranking signals. If you must rename,
 *     add a redirect in next.config.ts.
 */

export interface BlogPostMeta {
  slug: string;
  title: string;
  /** SEO meta description — 150-160 chars ideal. Shows in SERPs. */
  description: string;
  /** Short blurb for the /blog index cards. 1-2 sentences, plain prose. */
  summary: string;
  /** ISO 8601 date. Used for sort + JSON-LD datePublished. */
  publishedAt: string;
  /** ISO 8601 date. Equals publishedAt at launch; update on edits. */
  updatedAt: string;
  /** Author name. We use "Mindy" consistently — the AI persona is the author. */
  author: string;
  /** Estimated read time, displayed on cards. Calculated by hand at ~225 wpm. */
  readTime: string;
  /** Tags for browsing/filtering (future). Currently informational only. */
  tags: string[];
  /** Target keywords for SEO. Mirrored into <meta name="keywords">. */
  keywords: string[];
}

export const BLOG_POSTS: BlogPostMeta[] = [
  {
    slug: 'how-to-find-federal-contracts',
    title: 'How to Find Federal Contracts in 2026 (Without Spending Sundays on SAM.gov)',
    description:
      'The 4 data sources, 5 filters, and 3 mistakes that decide whether you find the right federal contracts — or burn weekends on the wrong ones.',
    summary:
      'There are 1,500+ new federal opportunities posted every day across 15+ government websites. Here\'s how to find the ones that fit your business without losing your weekends.',
    publishedAt: '2026-05-27',
    updatedAt: '2026-05-27',
    author: 'Mindy',
    readTime: '8 min read',
    tags: ['Getting Started', 'SAM.gov', 'Opportunity Discovery'],
    keywords: [
      'how to find federal contracts',
      'find government contracts',
      'sam.gov search',
      'federal contracting for small business',
    ],
  },
  {
    slug: 'sam-gov-alerts-why-they-fail',
    title: 'SAM.gov Alerts: Why They Fail (And What to Use Instead)',
    description:
      'SAM.gov keyword alerts miss perfect-fit contracts and flood you with noise. Here\'s why — and what intelligent alerts actually look like.',
    summary:
      'If you\'ve ever gotten a SAM.gov alert for a contract that had nothing to do with your business — or missed one that did — the problem isn\'t you. It\'s how keyword alerts work.',
    publishedAt: '2026-05-27',
    updatedAt: '2026-05-27',
    author: 'Mindy',
    readTime: '6 min read',
    tags: ['SAM.gov', 'Alerts', 'Workflow'],
    keywords: [
      'sam.gov alerts',
      'sam.gov alerts not working',
      'sam.gov keyword alerts',
      'federal contract alerts',
    ],
  },
  {
    slug: 'federal-contract-recompetes-guide',
    title: 'Federal Contract Recompetes: The $2B Opportunity Hiding in Plain Sight',
    description:
      'Every federal contract eventually expires. Here\'s the 18-month rule, the 4 plays to displace an incumbent, and how to find recompetes before everyone else.',
    summary:
      'Roughly $2B in federal contracts come up for recompete every business day. Most small businesses find out 30 days before the close date — too late to compete. Here\'s the timeline that actually works.',
    publishedAt: '2026-05-27',
    updatedAt: '2026-05-27',
    author: 'Mindy',
    readTime: '7 min read',
    tags: ['Recompetes', 'Capture Strategy', 'Pipeline'],
    keywords: [
      'federal contract recompetes',
      'contract recompete strategy',
      'incumbent contract',
      'recompete capture',
    ],
  },
];

/**
 * Look up a post by slug. Returns undefined for unknown slugs so the
 * caller can render a 404 (notFound() from next/navigation).
 */
export function getBlogPost(slug: string): BlogPostMeta | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

/**
 * Sorted list for the /blog index — newest first. Memoize at module
 * scope because the array is static and sorting on every render is
 * waste; the const itself is captured by closure.
 */
export const BLOG_POSTS_SORTED: BlogPostMeta[] = [...BLOG_POSTS].sort(
  (a, b) => (a.publishedAt < b.publishedAt ? 1 : -1),
);

/**
 * Related posts = every post except the current one. With 3 posts the
 * "related" section just shows the other two; once we have more we'll
 * want to add tag-based scoring.
 */
export function getRelatedPosts(currentSlug: string, limit = 2): BlogPostMeta[] {
  return BLOG_POSTS_SORTED.filter((p) => p.slug !== currentSlug).slice(0, limit);
}

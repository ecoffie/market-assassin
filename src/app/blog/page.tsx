import Link from 'next/link';
import type { Metadata } from 'next';
import { BLOG_POSTS_SORTED } from '@/data/blog-posts';

/**
 * /blog — index of all Mindy blog posts.
 *
 * Server component. Reads the static registry, renders cards sorted by
 * publish date (newest first). The registry is the single source of
 * truth so this list stays in sync with the sitemap and post pages.
 */

export const metadata: Metadata = {
  title:
    'Federal Contracting Blog — Daily Intelligence for Small Business | Mindy',
  description:
    'Tactics, frameworks, and plain-English explainers for small businesses pursuing federal contracts. Written by Mindy — your AI market intelligence analyst.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'The Mindy Blog — Federal Contracting Intelligence, Demystified',
    description:
      'Tactics, frameworks, and plain-English explainers for small businesses pursuing federal contracts.',
    type: 'website',
    url: 'https://getmindy.ai/blog',
  },
};

export default function BlogIndexPage() {
  const posts = BLOG_POSTS_SORTED;

  // Blog schema with blogPost array — gives Google an explicit map of
  // the posts on this index. The individual BlogPosting nodes also
  // appear on each post page (with full content); listing them here
  // tells crawlers "these belong together under one publication."
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': 'https://getmindy.ai/blog#blog',
    name: 'The Mindy Blog',
    description:
      'Federal contracting intelligence for small businesses, from Mindy.',
    url: 'https://getmindy.ai/blog',
    publisher: {
      '@type': 'Organization',
      '@id': 'https://getmindy.ai/#organization',
      name: 'Mindy',
    },
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      description: p.description,
      datePublished: p.publishedAt,
      dateModified: p.updatedAt,
      author: { '@type': 'Person', name: p.author },
      url: `https://getmindy.ai/blog/${p.slug}`,
      keywords: p.keywords.join(', '),
    })),
  };

  return (
    <main className="bg-(--mp-paper)">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumb — mirrors the post-page pattern so the site has a
          consistent crumb chain everywhere. */}
      <nav
        aria-label="Breadcrumb"
        className="max-w-4xl mx-auto px-4 pt-8 text-sm text-(--mp-muted)"
      >
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="hover:text-(--mp-navy-hover) transition">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-(--mp-muted)" aria-current="page">
            Blog
          </li>
        </ol>
      </nav>

      {/* Hero */}
      <section className="py-16 px-4 bg-(--mp-wash)">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-(--mp-navy)">
              <span className="text-(--mp-surface) font-bold text-xl">M</span>
            </div>
            <span className="text-(--mp-navy) font-semibold tracking-wide uppercase text-sm">
              The Mindy Blog
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-(--mp-ink) mb-4 font-(family-name:--mp-font-serif)">
            Federal Contracting Intelligence, Demystified.
          </h1>
          <p className="text-lg md:text-xl text-(--mp-body) max-w-2xl mx-auto">
            Tactics, frameworks, and plain-English explainers for small
            businesses pursuing federal contracts.
          </p>
        </div>
      </section>

      {/* Post list */}
      <section className="max-w-4xl mx-auto px-4 py-12">
        <ul className="space-y-6">
          {posts.map((post) => {
            const publishedLabel = new Date(
              post.publishedAt + 'T00:00:00Z',
            ).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              timeZone: 'UTC',
            });

            return (
              <li key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="group block rounded-lg border border-(--mp-line) hover:border-(--mp-navy) bg-(--mp-wash) hover:bg-(--mp-surface) p-6 md:p-8 transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    {post.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-xs font-medium uppercase tracking-wide text-(--mp-navy) bg-(--mp-navy-wash) border border-(--mp-line) rounded-lg px-3 py-1"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-(--mp-ink) group-hover:text-(--mp-navy-hover) transition-colors mb-3 leading-tight font-(family-name:--mp-font-serif)">
                    {post.title}
                  </h2>
                  <p className="text-(--mp-body) mb-4 leading-relaxed">
                    {post.summary}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-(--mp-muted)">
                    <span className="text-(--mp-body)">{post.author}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={post.publishedAt}>{publishedLabel}</time>
                    <span aria-hidden="true">·</span>
                    <span>{post.readTime}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* CTA strip — soft pitch for the email digest, since blog readers
          are a high-intent surface. */}
      <section className="max-w-4xl mx-auto px-4 pb-20">
        <div className="rounded-lg border border-(--mp-line) p-8 md:p-10 text-center bg-(--mp-wash)">
          <h2 className="text-2xl md:text-3xl font-bold text-(--mp-ink) mb-3 font-(family-name:--mp-font-serif)">
            Want this kind of intel in your inbox?
          </h2>
          <p className="text-(--mp-body) max-w-xl mx-auto mb-6">
            Mindy sends a daily briefing of federal opportunities matched to
            your NAICS codes — plus tactical playbooks like the ones above.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3 bg-white hover:bg-(--mp-wash) text-(--mp-navy) font-bold rounded-lg transition-colors"
          >
            Start Free — No Credit Card
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-(--mp-line) py-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-(--mp-navy) flex items-center justify-center">
              <span className="text-(--mp-surface) font-bold text-sm">M</span>
            </div>
            <span className="text-(--mp-ink) font-semibold">Mindy</span>
          </div>
          <p className="text-(--mp-muted) text-sm mb-2">
            <Link href="/blog" className="text-(--mp-muted) hover:text-(--mp-ink) transition">
              Blog
            </Link>
            <span className="mx-3">·</span>
            <Link href="/" className="text-(--mp-muted) hover:text-(--mp-ink) transition">
              Home
            </Link>
            <span className="mx-3">·</span>
            <a
              href="mailto:hello@getmindy.ai"
              className="text-(--mp-muted) hover:text-(--mp-ink) transition"
            >
              hello@getmindy.ai
            </a>
          </p>
          <p className="text-(--mp-body) text-xs mt-2 italic">
            &quot;The big contractors have armies. You have Mindy.&quot;
          </p>
        </div>
      </footer>
    </main>
  );
}

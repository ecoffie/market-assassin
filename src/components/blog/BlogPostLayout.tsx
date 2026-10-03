import Link from 'next/link';
import type { ReactNode } from 'react';
import type { BlogPostMeta } from '@/data/blog-posts';

/**
 * Shared chrome for every blog post.
 *
 * Identical structure across all 3 launch posts — hero, breadcrumb,
 * body (children), related posts, final CTA — so extracting saves
 * ~150 lines of dup per post and gives us one place to evolve the
 * post template later (sticky TOC, share buttons, newsletter inline
 * unit, etc.).
 *
 * Server component. The post BODY is passed in as children, so each
 * post page stays a pure JSX expression that's easy to scan and SEO-
 * audit. We pass meta separately rather than reaching into the
 * registry here, so the post page can be the source of truth for its
 * own metadata exports (`generateMetadata`) without circular reads.
 */
export function BlogPostLayout({
  meta,
  related,
  children,
}: {
  meta: BlogPostMeta;
  related: BlogPostMeta[];
  children: ReactNode;
}) {
  // Pretty date for the dateline. Use UTC to keep server + client
  // identical (Date locale parsing was a hydration mismatch source
  // in earlier versions of this site).
  const publishedLabel = new Date(meta.publishedAt + 'T00:00:00Z').toLocaleDateString(
    'en-US',
    { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' },
  );

  return (
    <main className="bg-(--mp-paper)">
      {/* Breadcrumb — visible nav + matches the BreadcrumbList JSON-LD
          on the post page so Google sees the same hierarchy crawlers
          and humans see. */}
      <nav
        aria-label="Breadcrumb"
        className="max-w-3xl mx-auto px-4 pt-8 text-sm text-(--mp-muted)"
      >
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="hover:text-(--mp-navy-hover) transition">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/blog" className="hover:text-(--mp-navy-hover) transition">
              Blog
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-(--mp-muted) truncate max-w-[18rem]" aria-current="page">
            {meta.title}
          </li>
        </ol>
      </nav>

      {/* Hero / dateline */}
      <header className="max-w-3xl mx-auto px-4 pt-10 pb-8">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {meta.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs font-medium uppercase tracking-wide text-(--mp-navy) bg-(--mp-navy-wash) border border-(--mp-line) rounded-lg px-3 py-1"
            >
              {tag}
            </span>
          ))}
        </div>
        <h1 className="text-3xl md:text-5xl font-bold text-(--mp-ink) leading-tight mb-6 font-(family-name:--mp-font-serif)">
          {meta.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-(--mp-muted)">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-md bg-(--mp-navy) flex items-center justify-center text-white text-xs font-bold">
              M
            </span>
            <span className="text-(--mp-body)">{meta.author}</span>
          </div>
          <span aria-hidden="true">·</span>
          <time dateTime={meta.publishedAt}>{publishedLabel}</time>
          <span aria-hidden="true">·</span>
          <span>{meta.readTime}</span>
        </div>
      </header>

      {/* Body — children rendered inside a prose-style wrapper. We
          don't use @tailwindcss/typography because we want tight
          control over heading color, link color, and spacing on the
          dark Mindy theme. The `blog-prose` class is defined inline
          below via Tailwind utilities applied to children, but we
          also expose escape hatches via direct className on elements
          in each post body. */}
      <article className="max-w-3xl mx-auto px-4 pb-16 blog-prose">
        {children}
      </article>

      {/* Final CTA card — same offer on every post. Goal: convert the
          reader who finished the article. "Start free, no credit card"
          is the wording the landing page uses, so we stay consistent. */}
      <section className="max-w-3xl mx-auto px-4 pb-16">
        <div className="rounded-lg border border-(--mp-line) p-8 md:p-10 text-center bg-(--mp-wash)">
          <h2 className="text-2xl md:text-3xl font-bold text-(--mp-ink) mb-3 font-(family-name:--mp-font-serif)">
            Stop reading about it. Start finding contracts.
          </h2>
          <p className="text-(--mp-body) max-w-xl mx-auto mb-6">
            Mindy delivers a personalized briefing of federal opportunities matched
            to your business — every morning, before your first coffee.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3 bg-white hover:bg-(--mp-wash) text-(--mp-navy) font-bold rounded-lg transition-colors"
          >
            Start Free — No Credit Card
          </Link>
          <p className="text-xs text-(--mp-muted) mt-4">
            Free forever plan. Upgrade to Pro ($149/mo) when you&apos;re ready.
          </p>
        </div>
      </section>

      {/* Related posts */}
      {related.length > 0 && (
        <section className="max-w-3xl mx-auto px-4 pb-20">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-(--mp-muted) mb-4">
            Keep reading
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {related.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block rounded-lg border border-(--mp-line) hover:border-(--mp-navy) bg-(--mp-wash) hover:bg-(--mp-surface) p-5 transition-colors"
              >
                <div className="text-xs text-(--mp-navy) mb-2">
                  {post.tags[0]}
                </div>
                <h3 className="text-lg font-semibold text-(--mp-ink) mb-2 leading-snug">
                  {post.title}
                </h3>
                <p className="text-sm text-(--mp-muted) line-clamp-2">{post.summary}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Footer — matches landing page footer for brand consistency.
          Kept lean (no nav columns) because blog readers came here for
          the article, not the marketing site. */}
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

/**
 * Reusable typography primitives used inside post bodies. Importing
 * these instead of remembering Tailwind classes keeps every post on
 * the same scale and color ramp.
 *
 * Why functions, not a custom MDX renderer: each post is hand-written
 * JSX, and using these primitives means a Cmd+F across posts can find
 * every `<H2>` without scanning Tailwind class strings.
 */

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="text-2xl md:text-3xl font-bold text-(--mp-ink) mt-12 mb-4 scroll-mt-24 font-(family-name:--mp-font-serif)"
    >
      {children}
    </h2>
  );
}

export function H3({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3
      id={id}
      className="text-xl md:text-2xl font-semibold text-(--mp-ink) mt-8 mb-3 scroll-mt-24 font-(family-name:--mp-font-serif)"
    >
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-(--mp-body) leading-relaxed mb-5">{children}</p>;
}

export function Lead({ children }: { children: ReactNode }) {
  // Lead paragraph — bigger, lighter, sits right under the H1 to set
  // the tone before body copy starts.
  return (
    <p className="text-lg md:text-xl text-(--mp-ink) leading-relaxed mb-8">
      {children}
    </p>
  );
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc list-outside pl-6 mb-6 space-y-2 text-(--mp-body) marker:text-(--mp-navy)">
      {children}
    </ul>
  );
}

export function OL({ children }: { children: ReactNode }) {
  return (
    <ol className="list-decimal list-outside pl-6 mb-6 space-y-2 text-(--mp-body) marker:text-(--mp-navy)">
      {children}
    </ol>
  );
}

export function LI({ children }: { children: ReactNode }) {
  return <li className="leading-relaxed">{children}</li>;
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const isExternal = href.startsWith('http');
  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-(--mp-navy) hover:text-(--mp-navy-hover) underline decoration-(--mp-navy) hover:decoration-(--mp-navy) underline-offset-2"
      >
        {children}
      </a>
    );
  }
  return (
    <Link
      href={href}
      className="text-(--mp-navy) hover:text-(--mp-navy-hover) underline decoration-(--mp-navy) hover:decoration-(--mp-navy) underline-offset-2"
    >
      {children}
    </Link>
  );
}

export function Callout({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside className="my-8 rounded-lg border border-(--mp-line) bg-(--mp-navy-wash) p-5">
      {title && (
        <div className="text-sm font-semibold uppercase tracking-wide text-(--mp-navy) mb-2">
          {title}
        </div>
      )}
      <div className="text-(--mp-ink) [&_p]:mb-2 [&_p:last-child]:mb-0">{children}</div>
    </aside>
  );
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="text-(--mp-ink) font-semibold">{children}</strong>;
}

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
    <main className="min-h-screen bg-slate-950">
      {/* Breadcrumb — visible nav + matches the BreadcrumbList JSON-LD
          on the post page so Google sees the same hierarchy crawlers
          and humans see. */}
      <nav
        aria-label="Breadcrumb"
        className="max-w-3xl mx-auto px-4 pt-8 text-sm text-slate-400"
      >
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="hover:text-purple-300 transition">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/blog" className="hover:text-purple-300 transition">
              Blog
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-slate-500 truncate max-w-[18rem]" aria-current="page">
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
              className="text-xs font-medium uppercase tracking-wide text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded-full px-3 py-1"
            >
              {tag}
            </span>
          ))}
        </div>
        <h1 className="text-3xl md:text-5xl font-bold text-white leading-tight mb-6">
          {meta.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-md bg-purple-600 flex items-center justify-center text-white text-xs font-bold">
              M
            </span>
            <span className="text-slate-300">{meta.author}</span>
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
        <div className="rounded-2xl border border-purple-500/40 bg-gradient-to-br from-purple-900/40 via-slate-900 to-slate-950 p-8 md:p-10 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
            Stop reading about it. Start finding contracts.
          </h2>
          <p className="text-slate-300 max-w-xl mx-auto mb-6">
            Mindy delivers a personalized briefing of federal opportunities matched
            to your business — every morning, before your first coffee.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3 bg-white hover:bg-slate-100 text-purple-700 font-bold rounded-xl shadow-lg transition-all hover:scale-105"
          >
            Start Free — No Credit Card
          </Link>
          <p className="text-xs text-slate-500 mt-4">
            Free forever plan. Upgrade to Pro ($149/mo) when you&apos;re ready.
          </p>
        </div>
      </section>

      {/* Related posts */}
      {related.length > 0 && (
        <section className="max-w-3xl mx-auto px-4 pb-20">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">
            Keep reading
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {related.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block rounded-xl border border-slate-800 hover:border-purple-500/50 bg-slate-900/50 hover:bg-slate-900 p-5 transition-all"
              >
                <div className="text-xs text-purple-300 mb-2">
                  {post.tags[0]}
                </div>
                <h3 className="text-lg font-semibold text-white mb-2 leading-snug">
                  {post.title}
                </h3>
                <p className="text-sm text-slate-400 line-clamp-2">{post.summary}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Footer — matches landing page footer for brand consistency.
          Kept lean (no nav columns) because blog readers came here for
          the article, not the marketing site. */}
      <footer className="border-t border-slate-800 py-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span className="text-white font-semibold">Mindy</span>
          </div>
          <p className="text-slate-500 text-sm mb-2">
            <Link href="/blog" className="text-slate-400 hover:text-white transition">
              Blog
            </Link>
            <span className="mx-3">·</span>
            <Link href="/" className="text-slate-400 hover:text-white transition">
              Home
            </Link>
            <span className="mx-3">·</span>
            <a
              href="mailto:hello@getmindy.ai"
              className="text-slate-400 hover:text-white transition"
            >
              hello@getmindy.ai
            </a>
          </p>
          <p className="text-slate-700 text-xs mt-2 italic">
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
      className="text-2xl md:text-3xl font-bold text-white mt-12 mb-4 scroll-mt-24"
    >
      {children}
    </h2>
  );
}

export function H3({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3
      id={id}
      className="text-xl md:text-2xl font-semibold text-white mt-8 mb-3 scroll-mt-24"
    >
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-slate-300 leading-relaxed mb-5">{children}</p>;
}

export function Lead({ children }: { children: ReactNode }) {
  // Lead paragraph — bigger, lighter, sits right under the H1 to set
  // the tone before body copy starts.
  return (
    <p className="text-lg md:text-xl text-slate-200 leading-relaxed mb-8">
      {children}
    </p>
  );
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc list-outside pl-6 mb-6 space-y-2 text-slate-300 marker:text-purple-400">
      {children}
    </ul>
  );
}

export function OL({ children }: { children: ReactNode }) {
  return (
    <ol className="list-decimal list-outside pl-6 mb-6 space-y-2 text-slate-300 marker:text-purple-400">
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
        className="text-purple-400 hover:text-purple-300 underline decoration-purple-400/40 hover:decoration-purple-300 underline-offset-2"
      >
        {children}
      </a>
    );
  }
  return (
    <Link
      href={href}
      className="text-purple-400 hover:text-purple-300 underline decoration-purple-400/40 hover:decoration-purple-300 underline-offset-2"
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
    <aside className="my-8 rounded-xl border border-purple-500/30 bg-purple-500/5 p-5">
      {title && (
        <div className="text-sm font-semibold uppercase tracking-wide text-purple-300 mb-2">
          {title}
        </div>
      )}
      <div className="text-slate-200 [&_p]:mb-2 [&_p:last-child]:mb-0">{children}</div>
    </aside>
  );
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="text-white font-semibold">{children}</strong>;
}

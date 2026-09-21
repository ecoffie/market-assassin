/**
 * /glossary/[slug] — individual GovCon glossary term detail page.
 *
 * One page per term. Each one is a candidate for Google's "definition"
 * rich result via DefinedTerm JSON-LD, so the canonical, metadata,
 * and structured data all need to mirror the same term consistently.
 *
 * Statically prerendered via generateStaticParams — every term is
 * known at build time, none come from a runtime database, so there's
 * no reason to defer rendering. Builds emit ~60 static HTML files
 * that ship straight off the edge cache.
 *
 * Layout: main column = definition + "How Mindy uses this" callout +
 * footer CTA. Right rail = related terms + back-to-index link.
 * Breadcrumbs sit above the H1 for both SEO and human navigation.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  glossaryTerms,
  getGlossaryTerm,
  getRelatedTerms,
} from '@/data/glossary';

// Pre-render every glossary term at build time. Cheap (60 entries),
// keeps the routes static so they hit edge cache and don't burn
// serverless invocations on every crawl.
export async function generateStaticParams() {
  return glossaryTerms.map((t) => ({ slug: t.slug }));
}

// Metadata is per-term — title, description, and canonical all
// reference the specific term so each page ranks on its own merits
// (NAICS, CAGE, FAR, etc. each have their own search intent).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const term = getGlossaryTerm(slug);

  if (!term) {
    return {
      title: 'Term not found | Mindy GovCon Glossary',
      description: 'The glossary term you requested could not be found.',
    };
  }

  // Description capped at ~155 chars per Google's snippet truncation —
  // tighter than the default meta description to avoid mid-word
  // cutoffs in SERPs.
  const trimmedDef =
    term.definition.length > 155
      ? `${term.definition.slice(0, 152).trimEnd()}...`
      : term.definition;

  return {
    title: `${term.term} — Federal Contracting Glossary | Mindy`,
    description: trimmedDef,
    alternates: {
      canonical: `https://getmindy.ai/glossary/${term.slug}`,
    },
    openGraph: {
      title: `${term.term} — Federal Contracting Glossary | Mindy`,
      description: trimmedDef,
      type: 'article',
      url: `https://getmindy.ai/glossary/${term.slug}`,
    },
    keywords: [
      term.term.toLowerCase(),
      `what is ${term.term.toLowerCase()}`,
      `${term.term.toLowerCase()} definition`,
      'govcon glossary',
      'federal contracting terms',
    ],
  };
}

export default async function GlossaryTermPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const term = getGlossaryTerm(slug);

  if (!term) notFound();

  const related = getRelatedTerms(term, 5);

  // DefinedTerm + BreadcrumbList JSON-LD. DefinedTerm is the rich
  // result target — Google may render the definition inline. Breadcrumb
  // schema cleans up the SERP path display ("Home > Glossary > Term").
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'DefinedTerm',
        '@id': `https://getmindy.ai/glossary/${term.slug}#term`,
        name: term.term,
        description: term.definition,
        url: `https://getmindy.ai/glossary/${term.slug}`,
        inDefinedTermSet: {
          '@type': 'DefinedTermSet',
          '@id': 'https://getmindy.ai/glossary#termset',
          name: 'Mindy GovCon Glossary',
          url: 'https://getmindy.ai/glossary',
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: 'https://getmindy.ai',
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Glossary',
            item: 'https://getmindy.ai/glossary',
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: term.term,
            item: `https://getmindy.ai/glossary/${term.slug}`,
          },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen bg-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumbs */}
      <div className="bg-slate-950 border-b border-slate-900">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <nav
            aria-label="Breadcrumb"
            className="text-sm text-slate-400 flex flex-wrap items-center gap-2"
          >
            <Link href="/" className="hover:text-purple-300 transition">
              Home
            </Link>
            <span aria-hidden className="text-slate-600">/</span>
            <Link
              href="/glossary"
              className="hover:text-purple-300 transition"
            >
              Glossary
            </Link>
            <span aria-hidden className="text-slate-600">/</span>
            <span className="text-slate-300">{term.term}</span>
          </nav>
        </div>
      </div>

      {/* Header */}
      <section className="bg-gradient-to-br from-purple-900/40 via-slate-900 to-slate-950 py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/30 rounded-full mb-4">
            <span className="text-purple-300 text-xs font-semibold uppercase tracking-wide">
              GovCon Glossary
            </span>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 leading-tight">
            {term.term}
          </h1>
        </div>
      </section>

      {/* Body — two column on desktop, stacked on mobile */}
      <section className="px-4 py-12">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-8">
          {/* Main definition */}
          <article className="md:col-span-2 space-y-6">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-purple-400 mb-3">
                Definition
              </h2>
              <p className="text-lg text-slate-200 leading-relaxed">
                {term.definition}
              </p>
            </div>

            {/* "How Mindy uses this" callout — the soft conversion */}
            <aside className="bg-gradient-to-br from-purple-900/30 to-slate-900 border border-purple-500/30 rounded-xl p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-lg shadow-purple-500/30">
                  <span className="text-white font-bold text-lg">M</span>
                </div>
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-purple-300 mb-2">
                    How Mindy uses this
                  </h2>
                  <p className="text-slate-200 leading-relaxed">
                    {term.mindyUse}
                  </p>
                  {term.productLink && (
                    <Link
                      href={term.productLink.href}
                      className="inline-flex items-center gap-1 mt-4 text-purple-300 hover:text-purple-200 font-semibold transition text-sm"
                    >
                      {term.productLink.label}{' '}
                      <span aria-hidden>→</span>
                    </Link>
                  )}
                </div>
              </div>
            </aside>

            {/* Inline CTA so we don't depend on the rail for conversion */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <p className="text-slate-300 mb-4">
                Mindy translates {term.term} (and every other piece of
                acquisition-speak) inside your daily briefing — so you read
                opportunities, not jargon.
              </p>
              <Link
                href="/signup"
                className="inline-block px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold transition"
              >
                Get Mindy&apos;s daily briefing free
              </Link>
            </div>
          </article>

          {/* Sidebar — related terms + back link */}
          <aside className="md:col-span-1 space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-purple-400 mb-4">
                Related terms
              </h2>
              <ul className="space-y-3">
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link
                      href={`/glossary/${r.slug}`}
                      className="block group"
                    >
                      <div className="text-white font-semibold group-hover:text-purple-300 transition">
                        {r.term}
                      </div>
                      <div className="text-slate-400 text-sm line-clamp-2 mt-1">
                        {r.definition}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <Link
              href="/glossary"
              className="block bg-slate-900 border border-slate-800 hover:border-purple-500/40 rounded-xl p-6 transition group"
            >
              <div className="text-purple-400 text-sm font-semibold mb-1">
                ← Back to glossary
              </div>
              <div className="text-slate-300 text-sm">
                Browse all {glossaryTerms.length} federal contracting terms.
              </div>
            </Link>
          </aside>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="px-4 pb-20">
        <div className="max-w-3xl mx-auto bg-gradient-to-br from-purple-900/40 via-slate-900 to-slate-950 border border-purple-500/30 rounded-2xl p-8 md:p-12 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Stop looking up terms. Start winning contracts.
          </h2>
          <p className="text-lg text-slate-300 mb-8 max-w-xl mx-auto">
            Mindy delivers personalized federal opportunities every morning —
            with the acquisition-speak already translated. 500+ small businesses
            wake up to a Mindy briefing.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-500/30 transition-all hover:scale-105"
          >
            Meet Mindy — Free Daily Briefing
          </Link>
          <p className="text-slate-500 text-sm mt-4">
            No credit card. Cancel anytime. First briefing lands tomorrow morning.
          </p>
        </div>
      </section>
    </main>
  );
}

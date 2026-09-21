/**
 * /glossary — Mindy GovCon Glossary index.
 *
 * 60+ federal contracting terms in plain English. The hero, A–Z jump nav,
 * and full-list layout mirror the govcon-funnels glossary that's been
 * indexing well for "what is a CAGE code", "what is NAICS", etc. — but
 * the brand voice and CTAs are Mindy-first and link into the Mindy
 * product surface (briefings, expiring contracts, forecasts).
 *
 * Server component only — no client interactivity. Search/filter is
 * intentionally skipped so the page can render statically and let the
 * native browser Find (Cmd+F) handle term lookup. Faster, simpler,
 * better for SEO than a client-side filter widget.
 *
 * Schema: DefinedTermSet anchored at /glossary so Google can ingest
 * the whole vocabulary in one shot. Individual DefinedTerm rich
 * results live on each /glossary/[slug] page.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { glossaryTerms } from '@/data/glossary';

export const metadata: Metadata = {
  title: 'GovCon Glossary — Federal Contracting Terms Explained | Mindy',
  description:
    '45+ federal contracting acronyms and terms defined. NAICS, FAR, DCAA, 8(a), HUBZone, SDVOSB, GSA, and more — in plain English.',
  alternates: {
    canonical: 'https://getmindy.ai/glossary',
  },
  keywords: [
    'govcon glossary',
    'federal contracting terms',
    'government contracting definitions',
    'what is a cage code',
    'what is naics code',
    'what is an rfp',
    'federal acquisition glossary',
    'mindy glossary',
  ],
  openGraph: {
    title: 'GovCon Glossary — Federal Contracting Terms Explained | Mindy',
    description:
      '45+ federal contracting acronyms and terms defined in plain English. From CAGE codes to IDIQs, the vocabulary you need to win federal work.',
    type: 'website',
    url: 'https://getmindy.ai/glossary',
  },
};

export default function GlossaryIndexPage() {
  // Group terms by first letter for the A–Z layout. Numeric-leading
  // terms ("8(a) Program") bucket to '#' so they don't get an
  // alphabet anchor that doesn't exist.
  const grouped = glossaryTerms.reduce<Record<string, typeof glossaryTerms>>(
    (acc, term) => {
      const letter = term.term[0].toUpperCase();
      const key = /[A-Z]/.test(letter) ? letter : '#';
      if (!acc[key]) acc[key] = [];
      acc[key].push(term);
      return acc;
    },
    {},
  );

  // Sort each bucket alphabetically by term so the on-page order
  // matches the visual letter heading (the input array is curated,
  // not alphabetical, so we need an explicit sort here).
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => a.term.localeCompare(b.term));
  }

  const sortedKeys = Object.keys(grouped).sort((a, b) => {
    if (a === '#') return -1;
    if (b === '#') return 1;
    return a.localeCompare(b);
  });

  // DefinedTermSet JSON-LD — gives Google the whole vocabulary in one
  // structured payload so individual terms can earn definition rich
  // results without needing to crawl every detail page first.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://getmindy.ai/#organization',
        name: 'Mindy',
        alternateName: 'Mindy AI',
        url: 'https://getmindy.ai',
        logo: 'https://getmindy.ai/icon.png',
      },
      {
        '@type': 'DefinedTermSet',
        '@id': 'https://getmindy.ai/glossary#termset',
        name: 'Mindy GovCon Glossary',
        description:
          'Plain-English definitions of federal contracting terms — NAICS, FAR, DCAA, 8(a), HUBZone, SDVOSB, GSA, IDIQ, and more.',
        url: 'https://getmindy.ai/glossary',
        inLanguage: 'en-US',
        hasDefinedTerm: glossaryTerms.map((t) => ({
          '@type': 'DefinedTerm',
          '@id': `https://getmindy.ai/glossary/${t.slug}#term`,
          name: t.term,
          description: t.definition,
          url: `https://getmindy.ai/glossary/${t.slug}`,
          inDefinedTermSet: 'https://getmindy.ai/glossary#termset',
        })),
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

      {/* Hero */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-full mb-6">
            <span className="text-purple-300 text-sm font-semibold uppercase tracking-wide">
              GovCon Glossary
            </span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight">
            The GovCon glossary,<br />
            <span className="text-purple-400">demystified.</span>
          </h1>

          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-8">
            {glossaryTerms.length} federal contracting terms in plain English.
            NAICS, FAR, DCAA, IDIQ, set-asides — every acronym a small business
            actually needs, defined without the acquisition-speak.
          </p>

          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-500/30 transition-all hover:scale-105"
          >
            Get Mindy&apos;s Daily Briefing Free
          </Link>
          <p className="text-slate-500 text-sm mt-4">
            No credit card. First briefing lands tomorrow morning.
          </p>
        </div>
      </section>

      {/* A–Z Jump Nav */}
      <section className="px-4 py-10 border-b border-slate-900">
        <div className="max-w-4xl mx-auto">
          <nav
            aria-label="Jump to letter"
            className="flex flex-wrap gap-2 justify-center"
          >
            {sortedKeys.map((letter) => (
              <a
                key={letter}
                href={`#letter-${letter}`}
                className="w-10 h-10 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-lg text-purple-400 hover:bg-slate-800 hover:text-purple-300 hover:border-purple-500/40 transition text-sm font-bold"
              >
                {letter}
              </a>
            ))}
          </nav>
        </div>
      </section>

      {/* Terms */}
      <section className="px-4 py-16">
        <div className="max-w-4xl mx-auto space-y-14">
          {sortedKeys.map((letter) => (
            <div key={letter} id={`letter-${letter}`} className="scroll-mt-24">
              <h2 className="text-3xl font-bold text-purple-400 mb-6 border-b border-slate-800 pb-3">
                {letter}
              </h2>
              <div className="space-y-6">
                {grouped[letter].map((term) => (
                  <article
                    key={term.slug}
                    className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 hover:border-purple-500/40 transition"
                  >
                    <h3 className="text-xl font-bold text-white mb-2">
                      <Link
                        href={`/glossary/${term.slug}`}
                        className="hover:text-purple-300 transition"
                      >
                        {term.term}
                      </Link>
                    </h3>
                    <p className="text-slate-300 leading-relaxed mb-3">
                      {term.definition}
                    </p>
                    <Link
                      href={`/glossary/${term.slug}`}
                      className="text-purple-400 hover:text-purple-300 text-sm font-semibold transition inline-flex items-center gap-1"
                    >
                      Read full definition <span aria-hidden>→</span>
                    </Link>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer CTA — the "Mindy translates this for you" close */}
      <section className="px-4 pb-20">
        <div className="max-w-3xl mx-auto bg-gradient-to-br from-purple-900/40 via-slate-900 to-slate-950 border border-purple-500/30 rounded-2xl p-8 md:p-12 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Tired of looking up these terms manually?
          </h2>
          <p className="text-lg text-slate-300 mb-8 max-w-xl mx-auto">
            Mindy translates acquisition-speak inside your daily briefing — set-asides,
            NAICS, incumbents, recompete timing, all in plain English. So you read
            opportunities, not a glossary.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-500/30 transition-all hover:scale-105"
          >
            Meet Mindy — Free Daily Briefing
          </Link>
          <p className="text-slate-500 text-sm mt-4">
            500+ small businesses already wake up to a Mindy briefing.
          </p>
        </div>
      </section>
    </main>
  );
}

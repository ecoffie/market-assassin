/**
 * /naics — index of the top 100 NAICS codes by federal contract spend.
 *
 * The NAICS code is the primary discovery mechanism for federal
 * contracting: SAM.gov solicitations, agency forecasts, USASpending
 * awards — every record is tagged by NAICS. This page is the
 * top-of-funnel SEO surface for "naics codes for federal contracts"
 * and feeds into 100 per-code detail pages.
 *
 * Layout: hero, 2-paragraph intro explaining NAICS as discovery, then
 * a single sortable table sorted by total contract spend desc (so
 * Google sees the highest-value codes first and the page renders the
 * biggest-impact codes above the fold).
 *
 * Server component only — no client interactivity. Sort is fixed
 * (spend desc) so we can ship a static page that hits edge cache.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { NAICS_TOP_100 } from '@/data/naics-top100';

export const metadata: Metadata = {
  title:
    'NAICS Codes — Federal Contract Opportunities by Industry | Mindy',
  description:
    'Top 100 NAICS codes by federal contract spend. Engineering, R&D, software, aircraft, defense — every code links to incumbents, top buyers, and daily opportunity alerts.',
  alternates: {
    canonical: 'https://getmindy.ai/naics',
  },
  keywords: [
    'naics codes',
    'naics codes for federal contracts',
    'federal contracting naics',
    'naics code lookup',
    'government contracts by naics',
    'top naics codes federal spending',
    'mindy naics directory',
  ],
  openGraph: {
    title:
      'NAICS Codes — Federal Contract Opportunities by Industry | Mindy',
    description:
      'The top 100 NAICS codes by federal spend. Find incumbents, top federal buyers, and set daily alerts for any code.',
    type: 'website',
    url: 'https://getmindy.ai/naics',
  },
};

// Same USD formatter as the detail page. Inline here so the index
// is self-contained and doesn't pull a util just for one helper.
function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export default function NaicsIndexPage() {
  // NAICS_TOP_100 is already sorted by totalValue desc at build time.
  const entries = NAICS_TOP_100;

  // Total spend across all 100 entries — a one-number anchor for the
  // intro so readers immediately understand the scale of the dataset.
  const totalSpend = entries.reduce((sum, e) => sum + e.totalValue, 0);

  // CollectionPage + DefinedTermSet JSON-LD so Google understands
  // this is the canonical index of a defined-term collection (the
  // 100 NAICS landing pages), with each entry as a hasPart.
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
        '@type': 'CollectionPage',
        '@id': 'https://getmindy.ai/naics',
        name: 'NAICS Codes for Federal Contracting',
        description:
          'Top 100 NAICS codes by federal contract spend, with per-code pages covering top buyers, incumbents, and recompete tracking.',
        url: 'https://getmindy.ai/naics',
        isPartOf: { '@id': 'https://getmindy.ai/#organization' },
        hasPart: entries.map((e) => ({
          '@type': 'DefinedTerm',
          '@id': `https://getmindy.ai/naics/${e.code}#term`,
          name: `NAICS ${e.code}: ${e.title}`,
          termCode: e.code,
          url: `https://getmindy.ai/naics/${e.code}`,
          inDefinedTermSet: 'https://getmindy.ai/naics#termset',
        })),
      },
      {
        '@type': 'DefinedTermSet',
        '@id': 'https://getmindy.ai/naics#termset',
        name: 'NAICS Codes for Federal Contracting',
        description:
          'North American Industry Classification System codes used by US federal contracting officers to categorize procurements.',
        url: 'https://getmindy.ai/naics',
        inLanguage: 'en-US',
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
            name: 'NAICS Codes',
            item: 'https://getmindy.ai/naics',
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
              NAICS Code Directory
            </span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight">
            Federal Contracts by{' '}
            <span className="text-purple-400">NAICS Code</span>
          </h1>

          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-8">
            The top {entries.length} NAICS codes by federal contract spend.
            Pick your industry to see who&apos;s buying, who&apos;s already
            winning, and how to get daily opportunity alerts.
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

      {/* Intro — what NAICS is + why this list matters */}
      <section className="px-4 py-12 border-b border-slate-900">
        <div className="max-w-4xl mx-auto prose prose-invert prose-slate max-w-none">
          <p className="text-lg text-slate-300 leading-relaxed">
            NAICS — the North American Industry Classification System — is
            how the federal government categorizes every contractor and every
            procurement. When a contracting officer publishes a solicitation
            on SAM.gov, they tag it with one NAICS code. When you register
            your business in SAM, you pick the codes you want to win work
            under. NAICS is the discovery mechanism: get the codes wrong and
            you&apos;ll never show up in agency searches.
          </p>
          <p className="text-lg text-slate-300 leading-relaxed mt-4">
            The {entries.length} codes below represent{' '}
            <strong>{formatCurrency(totalSpend)}</strong> in tracked federal
            contract value — the industries where federal spend actually
            concentrates. Engineering services, R&amp;D, software development,
            aircraft, ammunition, facilities support: this is where the
            government writes the checks. Click any code for the incumbents,
            top buyers, and a daily alert feed.
          </p>
        </div>
      </section>

      {/* Sorted list — by spend desc (largest first) */}
      <section className="px-4 py-12">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">
              Top {entries.length} NAICS by federal spend
            </h2>
            <span className="text-slate-500 text-sm">Sorted by spend ↓</span>
          </div>

          <ol className="space-y-3">
            {entries.map((entry, i) => (
              <li key={entry.code}>
                <Link
                  href={`/naics/${entry.code}`}
                  className="block bg-slate-900/60 border border-slate-800 hover:border-purple-500/40 rounded-xl p-5 transition group"
                >
                  <div className="flex items-start gap-4">
                    {/* Rank chip */}
                    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-300 text-xs font-bold mt-0.5">
                      {i + 1}
                    </span>

                    {/* Code + title + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-purple-400 font-mono font-bold text-lg">
                          {entry.code}
                        </span>
                        <h3 className="text-white font-semibold group-hover:text-purple-200 transition leading-tight">
                          {entry.title}
                        </h3>
                      </div>
                      <p className="text-slate-400 text-sm mt-2">
                        {formatCurrency(entry.totalValue)} tracked federal
                        contract value ·{' '}
                        {entry.contractorCount.toLocaleString()} contractors
                      </p>
                    </div>

                    {/* View arrow */}
                    <span
                      aria-hidden
                      className="flex-shrink-0 text-purple-400 group-hover:text-purple-300 group-hover:translate-x-0.5 transition text-sm font-semibold mt-1"
                    >
                      View →
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="px-4 pb-20">
        <div className="max-w-3xl mx-auto bg-gradient-to-br from-purple-900/40 via-slate-900 to-slate-950 border border-purple-500/30 rounded-2xl p-8 md:p-12 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Pick your NAICS. Get the opportunities.
          </h2>
          <p className="text-lg text-slate-300 mb-8 max-w-xl mx-auto">
            Tell Mindy which NAICS codes you target and she&apos;ll scan
            SAM.gov, Grants.gov, USASpending, and agency forecasts every day
            — emailing the matches every morning. So you read opportunities,
            not search results.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-500/30 transition-all hover:scale-105"
          >
            Meet Mindy — Free Daily Briefing
          </Link>
          <p className="text-slate-500 text-sm mt-4">
            No credit card. Cancel anytime.
          </p>
        </div>
      </section>
    </main>
  );
}

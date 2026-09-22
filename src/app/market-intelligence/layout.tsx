import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * `/market-intelligence` was invisible to crawlers.
 *
 * Measured live 2026-09-21: the page is `'use client'` with `useSearchParams`,
 * an email-login box and four Stripe checkout links. Its raw HTML carried 64
 * characters of visible text, no `<h1>`, no internal links, no structured data
 * and no page-level metadata — it inherited the root layout's title. Google's
 * URL Inspection API returned "Crawled - currently not indexed".
 *
 * This layout server-renders the substance: a unique H1, real copy, JSON-LD and
 * crawlable links into the content clusters. The client upgrade UI renders
 * below it, unchanged.
 *
 * ⚠️ ONE RESERVATION, recorded so it is a decision and not an oversight: the
 * page's actual job is checkout. Copy wrapped around a pricing widget is the
 * shape Google most often declines to index, so this may stay "crawled - not
 * indexed" on its own merits. `/pricing` remains the stronger conversion
 * surface (server-rendered, with SoftwareApplication + Offer + FAQPage JSON-LD).
 * If this page is still unindexed 90 days after indexation recovers elsewhere,
 * the right move is to noindex it and let `/pricing` carry the intent.
 */
export const metadata: Metadata = {
  title: 'Federal Market Intelligence for Small Business | Mindy',
  description:
    'Federal market intelligence built on SAM.gov, USASpending and agency forecast data — who buys what you sell, who holds the work now, and when it comes up again. Nothing is estimated.',
  alternates: { canonical: 'https://getmindy.ai/market-intelligence' },
  openGraph: {
    title: 'Federal Market Intelligence for Small Business | Mindy',
    description:
      'Who buys what you sell, who holds the work now, and when it comes up again — from federal award records.',
    type: 'website',
    url: 'https://getmindy.ai/market-intelligence',
  },
};

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      '@id': 'https://getmindy.ai/market-intelligence#page',
      name: 'Federal Market Intelligence for Small Business',
      url: 'https://getmindy.ai/market-intelligence',
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://getmindy.ai' },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Market intelligence',
          item: 'https://getmindy.ai/market-intelligence',
        },
      ],
    },
  ],
};

export default function MarketIntelligenceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <section className="bg-slate-950 text-slate-200">
        <div className="mx-auto max-w-4xl px-6 py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400">
            Federal market intelligence
          </p>
          <h1 className="mt-3 text-3xl md:text-4xl font-bold text-white">
            Know who buys what you sell — before the solicitation drops.
          </h1>
          <p className="mt-5 text-lg text-slate-300">
            Every federal contract award is a public record. The problem has never been secrecy;
            it is that the records are scattered across SAM.gov, USASpending and dozens of agency
            forecast files, in formats built for auditors rather than for the small business
            trying to find its next contract.
          </p>
          <p className="mt-4 text-slate-400">
            Mindy reads those records and answers the three questions that actually decide whether
            a pursuit is worth your time: which agencies already buy your work, who holds those
            contracts today, and when each one comes up for recompete. Every figure traces back to
            a federal award record — nothing is estimated, and where the data cannot answer, the
            answer is &ldquo;unavailable&rdquo; rather than a zero.
          </p>

          <h2 className="mt-10 text-xl font-semibold text-white">Start from the public data</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            <li>
              <Link href="/contractors" className="text-purple-300 hover:underline">
                Federal contractor database
              </Link>
              <span className="block text-sm text-slate-500">
                Award history, agencies and NAICS activity per company.
              </span>
            </li>
            <li>
              <Link href="/agencies" className="text-purple-300 hover:underline">
                Federal agency directory
              </Link>
              <span className="block text-sm text-slate-500">
                What each buyer purchases, and where they post it.
              </span>
            </li>
            <li>
              <Link href="/naics" className="text-purple-300 hover:underline">
                Contracts by NAICS code
              </Link>
              <span className="block text-sm text-slate-500">
                Your industry code, and the federal demand under it.
              </span>
            </li>
            <li>
              <Link href="/spending" className="text-purple-300 hover:underline">
                The latest big federal contracts
              </Link>
              <span className="block text-sm text-slate-500">
                Recent awards, with the record behind each one.
              </span>
            </li>
            <li>
              <Link href="/set-asides" className="text-purple-300 hover:underline">
                Set-aside programs
              </Link>
              <span className="block text-sm text-slate-500">
                8(a), HUBZone, SDVOSB and WOSB contract paths.
              </span>
            </li>
            <li>
              <Link href="/glossary" className="text-purple-300 hover:underline">
                GovCon glossary
              </Link>
              <span className="block text-sm text-slate-500">
                The vocabulary, in plain English.
              </span>
            </li>
          </ul>

          <p className="mt-8 text-sm text-slate-500">
            Comparing tools? See how Mindy stacks up against{' '}
            <Link href="/compare/govwin" className="text-purple-300 hover:underline">
              GovWin
            </Link>
            ,{' '}
            <Link href="/compare/highergov" className="text-purple-300 hover:underline">
              HigherGov
            </Link>{' '}
            and{' '}
            <Link href="/compare/sam-gov" className="text-purple-300 hover:underline">
              SAM.gov itself
            </Link>
            , or read the{' '}
            <Link href="/pricing" className="text-purple-300 hover:underline">
              pricing
            </Link>
            .
          </p>
        </div>
      </section>
      {children}
    </>
  );
}

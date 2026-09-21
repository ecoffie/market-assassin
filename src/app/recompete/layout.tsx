import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * `/recompete` — brand, claim and crawlability repair, 2026-09-21.
 *
 * Three separate problems, all measured live:
 *
 * 1. BRAND. The title read "Recompete Tracker | GovCon Giants" on a getmindy.ai
 *    page — wrong brand, and a collision with the "Recompete Tracker" product
 *    name on shop.govcongiants.org. One product, one name: if this page and that
 *    product are meant to be the same thing, the canonical name needs deciding
 *    before either surface advertises it. Flagged for Eric, not guessed at here.
 *
 * 2. CLAIM. The description asserted "6,900+ contracts worth $77T+ in potential
 *    value." $77 trillion is not a federal contracting number — total annual
 *    federal contract obligations run around $750B. An unverified figure does not
 *    ship, so the claim is gone rather than restated at a number nobody checked.
 *
 * 3. CRAWLABILITY. The page is `'use client'` and served 387 characters of raw
 *    HTML. This layout server-renders the H1, the explanation and the internal
 *    links; the client tool renders below, unchanged.
 */
export const metadata: Metadata = {
  title: 'Federal Contract Recompetes — Find Expiring Contracts | Mindy',
  description:
    'Find federal contracts approaching expiration and get in front of the recompete before the solicitation drops. Built on SAM.gov and USASpending award records.',
  alternates: { canonical: 'https://getmindy.ai/recompete' },
  openGraph: {
    title: 'Federal Contract Recompetes — Find Expiring Contracts | Mindy',
    description:
      'Find federal contracts approaching expiration and get in front of the recompete before the solicitation drops.',
    type: 'website',
    url: 'https://getmindy.ai/recompete',
  },
};

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      '@id': 'https://getmindy.ai/recompete#page',
      name: 'Federal Contract Recompetes',
      url: 'https://getmindy.ai/recompete',
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://getmindy.ai' },
        { '@type': 'ListItem', position: 2, name: 'Recompetes', item: 'https://getmindy.ai/recompete' },
      ],
    },
  ],
};

export default function RecompeteLayout({
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
            Federal contract recompetes
          </p>
          <h1 className="mt-3 text-3xl md:text-4xl font-bold text-white">
            Every federal contract ends. That is when it becomes winnable.
          </h1>
          <p className="mt-5 text-lg text-slate-300">
            A recompete is what happens when an existing contract reaches the end of its period of
            performance and the agency has to buy the same work again. The incumbent is not
            guaranteed to keep it — and unlike a brand-new requirement, you can see this one coming
            years in advance, because the end date is in the public award record.
          </p>
          <p className="mt-4 text-slate-400">
            That lead time is the whole advantage. By the time a solicitation posts to SAM.gov, the
            agency has usually already talked to the vendors who introduced themselves months
            earlier. Working backward from expiration dates is how a small business gets into that
            conversation instead of reading about it afterward.
          </p>

          <h2 className="mt-10 text-xl font-semibold text-white">What to look at first</h2>
          <ul className="mt-4 space-y-3 text-slate-400">
            <li>
              <strong className="text-slate-200">Who holds it now.</strong> The incumbent&rsquo;s
              award history tells you the size of the work and whether they are a specialist or a
              generalist defending a long tail —{' '}
              <Link href="/contractors" className="text-purple-300 hover:underline">
                look the company up
              </Link>
              .
            </li>
            <li>
              <strong className="text-slate-200">Which agency buys it.</strong> Buying patterns,
              vehicles and where each office posts its work differ sharply by agency —{' '}
              <Link href="/agencies" className="text-purple-300 hover:underline">
                browse the agency directory
              </Link>
              .
            </li>
            <li>
              <strong className="text-slate-200">Whether it is set aside.</strong> A recompete
              reserved for 8(a), HUBZone, SDVOSB or WOSB firms is a much shorter list of
              competitors —{' '}
              <Link href="/set-asides" className="text-purple-300 hover:underline">
                see the programs
              </Link>
              .
            </li>
            <li>
              <strong className="text-slate-200">What it is classified as.</strong> The NAICS code
              on the original award is the one the recompete will almost certainly carry —{' '}
              <Link href="/naics" className="text-purple-300 hover:underline">
                find yours
              </Link>
              .
            </li>
          </ul>

          <p className="mt-8 text-sm text-slate-500">
            New to this?{' '}
            <Link href="/glossary" className="text-purple-300 hover:underline">
              The GovCon glossary
            </Link>{' '}
            defines the terms, and{' '}
            <Link href="/spending" className="text-purple-300 hover:underline">
              the latest big federal contracts
            </Link>{' '}
            shows what is being awarded right now.
          </p>
        </div>
      </section>
      {children}
    </>
  );
}

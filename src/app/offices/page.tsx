/**
 * /offices — hub of every DoD buying office that has a public page in the office sitemap.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * /offices/[dodaac] pages were reachable only through sitemap-offices.xml and each other. Google
 * finds pages mainly through links, so this hub (linked from the site footer and the Department
 * of Defense agency page) gives every office one server-rendered `<a href>` from a crawled page.
 *
 * DATA
 * ----
 * The SAME population and gate as the office sitemap (getOfficeHubEntries → officeSitemapEligible
 * + isDodOffice), so the hub never links a page that noindexes itself. Supabase only, never
 * BigQuery. A read failure renders an honest "temporarily unavailable" state with noindex — never
 * "0 offices" (Bug Prevention Rule #11: unknown is not zero).
 */
import type { Metadata } from 'next';
import { siteShareImages } from '@/lib/seo/share-image';
import Link from 'next/link';
import { cache } from 'react';
import { getOfficeHubEntries, groupOfficesForHub, type OfficeHubEntry } from '@/lib/seo/offices';
import { OFFICE_MIN_ACTIVE_NOTICES } from '@/lib/seo/office-gate';

const SITE_URL = 'https://getmindy.ai';
const DOD_AGENCY_SLUG = 'department-of-defense'; // src/data/agencies-seo.ts

// The office set moves daily; the read drains active notices, so cache for 6 hours. A failed read
// renders noindex and is replaced at the next revalidation.
export const revalidate = 21600;

type HubLoad = { ok: true; offices: OfficeHubEntry[] } | { ok: false };

const loadHub = cache(async (): Promise<HubLoad> => {
  try {
    return { ok: true, offices: await getOfficeHubEntries() };
  } catch (e) {
    console.error('[offices hub] read failed:', (e as Error).message);
    return { ok: false };
  }
});

export async function generateMetadata(): Promise<Metadata> {
  const hub = await loadHub();
  const url = `${SITE_URL}/offices`;
  const title = 'DoD Buying Offices — Contracting Offices by DoDAAC | Mindy';
  const description = hub.ok
    ? `${hub.offices.length.toLocaleString('en-US')} Department of Defense contracting offices with active SAM.gov notices — each with its open bids, recent awards and buying contacts, by DoDAAC.`
    : 'Department of Defense contracting offices by DoDAAC — open bids, recent awards and buying contacts.';
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: hub.ok && hub.offices.length > 0 ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, type: 'website', url, images: siteShareImages() },
  };
}

export default async function OfficesHubPage() {
  const hub = await loadHub();
  const groups = hub.ok ? groupOfficesForHub(hub.offices) : [];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${SITE_URL}/offices#page`,
        name: 'DoD buying offices',
        url: `${SITE_URL}/offices`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Department of Defense', item: `${SITE_URL}/agencies/${DOD_AGENCY_SLUG}` },
          { '@type': 'ListItem', position: 3, name: 'Buying offices', item: `${SITE_URL}/offices` },
        ],
      },
    ],
  };

  return (
    <main className="bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-5xl mx-auto px-4 py-10">
        <nav className="text-xs text-(--mp-muted) mb-4">
          <Link href="/" className="hover:underline">Home</Link>
          <span className="mx-1.5">/</span>
          <Link href={`/agencies/${DOD_AGENCY_SLUG}`} className="hover:underline">Department of Defense</Link>
          <span className="mx-1.5">/</span>
          <span>Buying offices</span>
        </nav>

        <h1 className="text-2xl md:text-3xl font-bold text-(--mp-ink) leading-tight font-(family-name:--mp-font-serif)">
          Department of Defense buying offices
        </h1>
        <p className="mt-3 text-(--mp-body) max-w-3xl">
          Every DoD solicitation number starts with the issuing office&rsquo;s six-character DoDAAC
          (W912PL-26-R-0001 is USACE Los Angeles District). Each office below has its own page with
          the bids it has open now, its recent awards and the buyers named on its notices.
        </p>

        {!hub.ok ? (
          <div className="mt-8 rounded-lg border border-(--mp-line) bg-(--mp-surface) p-5 text-sm text-(--mp-body)">
            The office list is temporarily unavailable. Please try again shortly — or{' '}
            <Link href="/opportunity-hunter" className="text-(--mp-navy) hover:underline">browse open opportunities</Link>.
          </div>
        ) : (
          <>
            <p className="mt-4 text-sm text-(--mp-muted)">
              {hub.offices.length.toLocaleString('en-US')} offices with at least {OFFICE_MIN_ACTIVE_NOTICES} notices
              SAM.gov still marks active. Counts are active notices (open now or recently closed), not only open bids.
            </p>
            {groups.map((g) => (
              <section key={g.label} className="mt-10">
                <h2 className="text-xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">
                  {g.label} <span className="text-sm font-normal text-(--mp-muted)">· {g.offices.length.toLocaleString('en-US')} offices</span>
                </h2>
                <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
                  {g.offices.map((o) => (
                    <li key={o.dodaac} className="flex items-baseline justify-between gap-3 border-b border-(--mp-hair) py-2">
                      <Link href={`/offices/${o.dodaac}`} className="text-sm text-(--mp-navy) hover:underline">
                        {o.name} <span className="font-(family-name:--mp-font-mono) text-xs text-(--mp-muted)">{o.dodaac}</span>
                      </Link>
                      <span className="shrink-0 font-(family-name:--mp-font-mono) text-xs text-(--mp-muted)">
                        {o.activeNotices.toLocaleString('en-US')} active
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        <div className="mt-12 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href={`/agencies/${DOD_AGENCY_SLUG}`} className="text-(--mp-navy) hover:underline">Department of Defense →</Link>
          <Link href="/recompetes" className="text-(--mp-navy) hover:underline">Contracts expiring soon →</Link>
          <Link href="/forecasts" className="text-(--mp-navy) hover:underline">Agency forecasts →</Link>
          <Link href="/opportunity-hunter" className="text-(--mp-navy) hover:underline">Open opportunities →</Link>
        </div>
      </div>
    </main>
  );
}

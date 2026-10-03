/**
 * /contractors/[slug]/agencies
 *
 * Lists every federal agency that has awarded this contractor, sorted
 * by total dollars. Each agency row links to /agencies/[slug] (the
 * agency profile page) — building the internal link graph between
 * contractor pages and agency pages that HigherGov has and Mindy
 * was missing.
 */
import type { Metadata } from 'next';
import { cache } from 'react';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { formatCompanyName as fmtCompanyName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';
import {
  getRollupBySlug,
  resolveCanonicalSlug,
  getAllAgenciesForRecipientWithState,
  SUBPAGE_MIN_ROWS,
} from '@/lib/bigquery/recipients';
import { decideSubpage } from '@/lib/seo/subpage-contract';
import { serveableCanonical } from '@/lib/seo/canonical-redirect';
import { SubpageLayout } from '@/components/contractors/SubpageLayout';

const SITE_URL = 'https://getmindy.ai';

export const revalidate = 604800; // 7d
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}



function agencySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * One load per request, shared by generateMetadata and the page body, so `robots`, the
 * description and the rendered table can never disagree. Cache-only (no BigQuery).
 */
const loadAgenciesSubpage = cache(async (slug: string) => {
  const recipient = await getRollupBySlug(slug);
  if (!recipient) return null;
  const { rows, state } = await getAllAgenciesForRecipientWithState(recipient.child_ueis, recipient.rollup_uei);
  return { recipient, rows, decision: decideSubpage(state, rows.length, SUBPAGE_MIN_ROWS) };
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadAgenciesSubpage(slug);
  if (!loaded) return { title: 'Contractor Not Found | Mindy' };
  const { recipient, decision } = loaded;

  const name = fmtCompanyName(recipient.rollup_name);
  const title = `${name} Federal Agency Customers | Mindy`;
  // Claim a count ONLY when it is the rendered table's (subpage-contract.ts).
  const description = decision.headlineCount !== null
    ? `${decision.headlineCount} federal agencies have awarded ${name} contracts. See top customers, agency-by-agency breakdown, and award totals.`
    : `${name} federal agency customers. The agency-by-agency breakdown is being refreshed — see the contractor profile for totals and top agencies.`;
  const canonical = recipient.canonical_slug;

  return {
    title,
    description,
    // noindex,follow unless the page renders a real, non-thin table. follow keeps equity
    // flowing to the parent profile and agency profile pages.
    robots: decision.indexable ? undefined : { index: false, follow: true },
    alternates: { canonical: `${SITE_URL}/contractors/${canonical}/agencies` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/contractors/${canonical}/agencies`,
      type: 'website',
      siteName: 'Mindy',
    },
  };
}

export default async function ContractorAgenciesPage({ params }: PageProps) {
  const { slug } = await params;
  const loaded = await loadAgenciesSubpage(slug);
  if (!loaded) {
    const canonical = await serveableCanonical(await resolveCanonicalSlug(slug));
    if (canonical) permanentRedirect(`/contractors/${canonical}/agencies`);
    notFound();
  }
  const { recipient, rows: agencies, decision } = loaded;
  if (recipient.canonical_slug !== slug) {
    permanentRedirect(`/contractors/${recipient.canonical_slug}/agencies`);
  }
  const displayName = fmtCompanyName(recipient.rollup_name);
  const slugForLinks = recipient.canonical_slug;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Contractors', item: `${SITE_URL}/contractors` },
      { '@type': 'ListItem', position: 3, name: displayName, item: `${SITE_URL}/contractors/${slugForLinks}` },
      { '@type': 'ListItem', position: 4, name: 'Agencies', item: `${SITE_URL}/contractors/${slugForLinks}/agencies` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SubpageLayout
        slug={slugForLinks}
        displayName={displayName}
        totalObligated={fmtMoney(recipient.total_obligated)}
        awardCount={recipient.award_count}
        agencyCount={recipient.distinct_agency_count}
        naicsCount={recipient.distinct_naics_count}
        activeTab="agencies"
      >
        <header className="mb-6">
          <h2 className="text-2xl font-bold font-(family-name:--mp-font-serif)">Federal Agency Customers</h2>
          {decision.headlineCount !== null && (
            <p className="mt-1 text-sm text-(--mp-muted)">
              {decision.headlineCount} federal {decision.headlineCount === 1 ? 'agency has' : 'agencies have'} awarded contracts to {displayName}, sorted by total dollars.
            </p>
          )}
        </header>

        {decision.showTable && (
          <div className="overflow-x-auto rounded-lg border border-(--mp-line) bg-(--mp-surface)">
            <table className="w-full text-sm">
              <thead className="bg-(--mp-wash) text-xs uppercase tracking-wider text-(--mp-muted)">
                <tr>
                  <th className="text-left px-4 py-3">Agency</th>
                  <th className="text-right px-4 py-3">% of Total</th>
                  <th className="text-right px-4 py-3">Total Obligated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--mp-line)">
                {agencies.map((a) => (
                  <tr key={a.awarding_agency} className="hover:bg-(--mp-wash)">
                    <td className="px-4 py-3 text-(--mp-ink)">
                      <Link
                        href={`/agencies/${agencySlug(a.awarding_agency)}`}
                        className="hover:text-(--mp-navy-hover)"
                      >
                        {a.awarding_agency}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right text-(--mp-muted) whitespace-nowrap">
                      {(Number(a.pct_of_total) * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right font-(family-name:--mp-font-mono) font-semibold text-(--mp-navy) whitespace-nowrap">
                      {fmtMoney(Number(a.total_amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {decision.notice === 'unavailable' && (
          <div data-subpage-state="unavailable" className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-6 text-sm text-(--mp-body)">
            <p>The agency-by-agency breakdown for {displayName} is being refreshed and isn&apos;t available right now.</p>
            <p className="mt-2">
              <Link href={`/contractors/${slugForLinks}`} className="text-(--mp-navy) hover:text-(--mp-navy-hover)">
                See {displayName}&apos;s contractor profile
              </Link>{' '}
              for its federal award totals and top agency customers.
            </p>
          </div>
        )}
        {decision.notice === 'none' && (
          <p data-subpage-state="none" className="text-(--mp-muted) text-sm">
            No agency-attributed federal awards are recorded for {displayName} in this dataset.
          </p>
        )}

        {/* CTA */}
        <section className="mt-12 rounded-lg border border-(--mp-line) p-8 text-center bg-(--mp-wash)">
          <h2 className="text-xl font-bold font-(family-name:--mp-font-serif)">Track {displayName}&apos;s Agency Relationships</h2>
          <p className="mt-2 max-w-2xl mx-auto text-(--mp-body) text-sm">
            Mindy watches agency spending patterns and surfaces opportunities matching {displayName}&apos;s active customers.
          </p>
          <Link
            href="/signup"
            className="mt-5 inline-flex rounded-lg bg-(--mp-navy) px-5 py-2.5 font-semibold text-white hover:bg-(--mp-navy-hover)"
          >
            Start Free
          </Link>
        </section>
      </SubpageLayout>
    </>
  );
}

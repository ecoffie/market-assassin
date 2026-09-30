/**
 * /contractors/[slug]/naics
 *
 * Full NAICS (line-of-business) breakdown for a contractor. Each row
 * links to /naics/[code] when the code is in our top-100 set, otherwise
 * shows the code without a link. Builds the contractor ↔ NAICS internal
 * link graph.
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
  getAllNaicsForRecipientWithState,
  SUBPAGE_MIN_ROWS,
} from '@/lib/bigquery/recipients';
import { decideSubpage } from '@/lib/seo/subpage-contract';
import { serveableCanonical } from '@/lib/seo/canonical-redirect';
import { SubpageLayout } from '@/components/contractors/SubpageLayout';
import { NAICS_TOP_100 } from '@/data/naics-top100';

const SITE_URL = 'https://getmindy.ai';

export const revalidate = 604800; // 7d
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

// Pre-compute the set of NAICS codes we have landing pages for so we
// can conditionally link rather than 404-ing users.
const LINKABLE_NAICS = new Set(NAICS_TOP_100.map((n) => n.code));



interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * One load per request, shared by generateMetadata and the page body, so `robots`, the
 * description and the rendered table can never disagree. Cache-only (no BigQuery).
 */
const loadNaicsSubpage = cache(async (slug: string) => {
  const recipient = await getRollupBySlug(slug);
  if (!recipient) return null;
  const { rows, state } = await getAllNaicsForRecipientWithState(recipient.child_ueis, recipient.rollup_uei);
  return { recipient, rows, decision: decideSubpage(state, rows.length, SUBPAGE_MIN_ROWS) };
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadNaicsSubpage(slug);
  if (!loaded) return { title: 'Contractor Not Found | Mindy' };
  const { recipient, decision } = loaded;

  const name = fmtCompanyName(recipient.rollup_name);
  const title = `${name} NAICS Codes & Industry Activity | Mindy`;
  // Claim a count ONLY when it is the rendered table's. The stored aggregate is never a
  // headline: it stays confident while the row cache is cold (subpage-contract.ts).
  const description = decision.headlineCount !== null
    ? `${name} federal contract activity across ${decision.headlineCount} NAICS codes. See industry concentration, top codes, and award totals.`
    : `${name} federal contracting by NAICS code. The detailed industry breakdown is being refreshed — see the contractor profile for totals and top agencies.`;
  const canonical = recipient.canonical_slug;

  return {
    title,
    description,
    // noindex,follow unless the page renders a real, non-thin table. follow keeps equity
    // flowing to the parent profile and NAICS landing pages.
    robots: decision.indexable ? undefined : { index: false, follow: true },
    alternates: { canonical: `${SITE_URL}/contractors/${canonical}/naics` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/contractors/${canonical}/naics`,
      type: 'website',
      siteName: 'Mindy',
    },
  };
}

export default async function ContractorNaicsPage({ params }: PageProps) {
  const { slug } = await params;
  const loaded = await loadNaicsSubpage(slug);
  if (!loaded) {
    const canonical = await serveableCanonical(await resolveCanonicalSlug(slug));
    if (canonical) permanentRedirect(`/contractors/${canonical}/naics`);
    notFound();
  }
  const { recipient, rows: naicsRows, decision } = loaded;
  if (recipient.canonical_slug !== slug) {
    permanentRedirect(`/contractors/${recipient.canonical_slug}/naics`);
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
      { '@type': 'ListItem', position: 4, name: 'NAICS', item: `${SITE_URL}/contractors/${slugForLinks}/naics` },
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
        activeTab="naics"
      >
        <header className="mb-6">
          <h2 className="text-2xl font-bold">NAICS Codes & Industry Activity</h2>
          {decision.headlineCount !== null && (
            <p className="mt-1 text-sm text-slate-400">
              {decision.headlineCount} NAICS {decision.headlineCount === 1 ? 'code' : 'codes'} where {displayName} has federal contracting activity, sorted by total dollars.
            </p>
          )}
        </header>

        {decision.showTable && (
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/50 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3">NAICS</th>
                  <th className="text-left px-4 py-3">Industry</th>
                  <th className="text-right px-4 py-3">Awards</th>
                  <th className="text-right px-4 py-3">Total Obligated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {naicsRows.map((n) => {
                  const codeContent = LINKABLE_NAICS.has(n.naics_code) ? (
                    <Link href={`/naics/${n.naics_code}`} className="hover:text-purple-400">
                      {n.naics_code}
                    </Link>
                  ) : (
                    n.naics_code
                  );
                  return (
                    <tr key={n.naics_code} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-mono text-slate-200">{codeContent}</td>
                      <td className="px-4 py-3 text-slate-300">{n.naics_description || '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-300 whitespace-nowrap">{n.award_count.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-purple-400 whitespace-nowrap">
                        {fmtMoney(Number(n.total_amount))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {decision.notice === 'unavailable' && (
          <div data-subpage-state="unavailable" className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
            <p>The full NAICS breakdown for {displayName} is being refreshed and isn&apos;t available right now.</p>
            <p className="mt-2">
              <Link href={`/contractors/${slugForLinks}`} className="text-purple-400 hover:text-purple-300">
                See {displayName}&apos;s contractor profile
              </Link>{' '}
              for its federal award totals, top agencies and leading NAICS codes.
            </p>
          </div>
        )}
        {decision.notice === 'none' && (
          <p data-subpage-state="none" className="text-slate-400 text-sm">
            No NAICS-coded federal awards are recorded for {displayName} in this dataset.
          </p>
        )}

        {/* CTA */}
        <section className="mt-12 rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/40 to-slate-900 p-8 text-center">
          <h2 className="text-xl font-bold">Find Opportunities in {displayName}&apos;s NAICS Codes</h2>
          <p className="mt-2 max-w-2xl mx-auto text-slate-300 text-sm">
            Mindy scans SAM.gov + agency forecasts daily for opportunities matching the same industry codes.
          </p>
          <Link
            href="/signup"
            className="mt-5 inline-flex rounded-xl bg-purple-600 px-5 py-2.5 font-semibold text-white hover:bg-purple-500 shadow-lg shadow-purple-500/20"
          >
            Start Free
          </Link>
        </section>
      </SubpageLayout>
    </>
  );
}

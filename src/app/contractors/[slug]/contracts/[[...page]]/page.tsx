/**
 * /contractors/[slug]/contracts and /contracts/[page]
 *
 * Optional-catch-all route: `/contracts` is page 1, `/contracts/2`
 * is page 2, etc. Server-rendered + ISR with the same revalidation
 * + cache pattern as the parent overview page.
 *
 * Each paginated URL is its own SEO target. For a contractor like
 * Lockheed (~4,850 dollar-bearing awards), this generates ~97
 * additional indexable URLs from a single contractor profile.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { formatCompanyName as fmtCompanyName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';
import {
  getRollupBySlug,
  resolveCanonicalSlug,
  getPaginatedAwardsForRecipient,
} from '@/lib/bigquery/recipients';
import { SubpageLayout } from '@/components/contractors/SubpageLayout';

const SITE_URL = 'https://getmindy.ai';
const PAGE_SIZE = 50;
const MAX_INDEXABLE_PAGES = 20; // we'll noindex pages past this — long tail not worth crawl budget

export const revalidate = 604800; // 7d
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}


function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}


interface PageProps {
  params: Promise<{ slug: string; page?: string[] }>;
}

function parsePage(page?: string[]): number {
  if (!page || page.length === 0) return 1;
  const n = parseInt(page[0], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, page } = await params;
  const pageNum = parsePage(page);
  const recipient = await getRollupBySlug(slug);
  if (!recipient) return { title: 'Contractor Not Found | Mindy' };

  const name = fmtCompanyName(recipient.rollup_name);
  const canonical = recipient.canonical_slug;
  const pageLabel = pageNum > 1 ? ` — Page ${pageNum}` : '';
  const title = `${name} Federal Contracts${pageLabel} | Mindy`;
  const description = `Browse ${recipient.award_count.toLocaleString()} federal contracts awarded to ${name}. ${fmtMoney(recipient.total_obligated)} obligated across ${recipient.distinct_agency_count} agencies.`;
  const canonicalPath = pageNum === 1 ? `/contractors/${canonical}/contracts` : `/contractors/${canonical}/contracts/${pageNum}`;

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}${canonicalPath}` },
    // Pages past MAX_INDEXABLE_PAGES would dilute crawl budget without
    // adding ranking value — flag them noindex,follow.
    robots: pageNum > MAX_INDEXABLE_PAGES ? { index: false, follow: true } : undefined,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${canonicalPath}`,
      type: 'website',
      siteName: 'Mindy',
    },
  };
}

export default async function ContractorContractsPage({ params }: PageProps) {
  const { slug, page } = await params;
  const pageNum = parsePage(page);
  const tail = pageNum > 1 ? `/contracts/${pageNum}` : '/contracts';
  const recipient = await getRollupBySlug(slug);
  if (!recipient) {
    const canonical = await resolveCanonicalSlug(slug);
    if (canonical) permanentRedirect(`/contractors/${canonical}${tail}`);
    notFound();
  }
  if (recipient.canonical_slug !== slug) {
    // Preserve the page number when consolidating a sibling slug onto the parent.
    permanentRedirect(`/contractors/${recipient.canonical_slug}${tail}`);
  }
  const slugForLinks = recipient.canonical_slug;

  const { rows: awards, total } = await getPaginatedAwardsForRecipient(
    recipient.child_ueis,
    recipient.rollup_uei,
    pageNum,
    PAGE_SIZE,
  );
  const totalPages = Math.ceil(total / PAGE_SIZE);
  // If user asks for a page past the end, treat as not-found
  if (pageNum > 1 && awards.length === 0) notFound();

  const displayName = fmtCompanyName(recipient.rollup_name);
  const start = (pageNum - 1) * PAGE_SIZE + 1;
  const end = Math.min(start + awards.length - 1, total);

  // BreadcrumbList JSON-LD
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Contractors', item: `${SITE_URL}/contractors` },
      { '@type': 'ListItem', position: 3, name: displayName, item: `${SITE_URL}/contractors/${slugForLinks}` },
      { '@type': 'ListItem', position: 4, name: 'Contracts', item: `${SITE_URL}/contractors/${slugForLinks}/contracts` },
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
        activeTab="contracts"
      >
        <header className="mb-6">
          <h2 className="text-2xl font-bold">Federal Contracts</h2>
          <p className="mt-1 text-sm text-slate-400">
            Showing contracts {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()} total. Sorted by action date, most recent first. Excludes $0 modifications.
          </p>
        </header>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Agency</th>
                <th className="text-left px-4 py-3">PIID</th>
                <th className="text-left px-4 py-3">NAICS</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-right px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {awards.map((a) => (
                <tr key={a.award_id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{fmtDate(a.action_date)}</td>
                  <td className="px-4 py-3 text-slate-300 max-w-[14rem]">
                    <span className="truncate block">{a.awarding_agency || '—'}</span>
                    {a.awarding_office && <span className="text-xs text-slate-500 truncate block">{a.awarding_office}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {a.piid ? (
                      <Link
                        href={`/contracts/${encodeURIComponent(a.piid)}`}
                        className="text-slate-400 hover:text-purple-400"
                      >
                        {a.piid}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{a.naics_code || '—'}</td>
                  <td className="px-4 py-3 text-slate-300 max-w-[24rem]">
                    <span className="line-clamp-2">{a.description || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-purple-400 whitespace-nowrap">
                    {fmtMoney(Number(a.obligation_amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <nav className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-slate-400">
              Page {pageNum} of {totalPages}
            </p>
            <div className="flex flex-wrap gap-2">
              {pageNum > 1 && (
                <Link
                  href={pageNum === 2 ? `/contractors/${slugForLinks}/contracts` : `/contractors/${slugForLinks}/contracts/${pageNum - 1}`}
                  className="px-3 py-1.5 rounded-md border border-slate-700 hover:border-purple-500 text-slate-300 hover:text-white"
                >
                  ← Prev
                </Link>
              )}
              {pageNum < totalPages && (
                <Link
                  href={`/contractors/${slugForLinks}/contracts/${pageNum + 1}`}
                  className="px-3 py-1.5 rounded-md border border-slate-700 hover:border-purple-500 text-slate-300 hover:text-white"
                >
                  Next →
                </Link>
              )}
            </div>
          </nav>
        )}

        {/* CTA */}
        <section className="mt-12 rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/40 to-slate-900 p-8 text-center">
          <h2 className="text-xl font-bold">Get Alerted Before {displayName}&apos;s Next Recompete</h2>
          <p className="mt-2 max-w-2xl mx-auto text-slate-300 text-sm">
            Mindy monitors active contracts and flags recompetes 12 months out so you can position to compete.
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

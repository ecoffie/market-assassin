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
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getRecipientBySlug,
  getAllAgenciesForRecipient,
} from '@/lib/bigquery/recipients';
import { SubpageLayout } from '@/components/contractors/SubpageLayout';

const SITE_URL = 'https://getmindy.ai';

export const revalidate = 604800; // 7d
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

function fmtMoney(n: number | null | undefined): string {
  if (!n) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtCompanyName(raw: string): string {
  const ACRONYMS = new Set(['INC', 'LLC', 'CORP', 'CORPORATION', 'CO', 'USA', 'US', 'NA', 'LP', 'LLP', 'LTD', 'PLC', 'PC', 'PLLC']);
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      const upper = w.toUpperCase().replace(/[.,]/g, '');
      if (ACRONYMS.has(upper)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const recipient = await getRecipientBySlug(slug);
  if (!recipient) return { title: 'Contractor Not Found | Mindy' };

  const name = fmtCompanyName(recipient.recipient_name);
  const title = `${name} Federal Agency Customers | Mindy`;
  const description = `${recipient.distinct_agency_count} federal agencies have awarded ${name} contracts. See top customers, agency-by-agency breakdown, and award totals.`;

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/contractors/${slug}/agencies` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/contractors/${slug}/agencies`,
      type: 'website',
      siteName: 'Mindy',
    },
  };
}

export default async function ContractorAgenciesPage({ params }: PageProps) {
  const { slug } = await params;
  const recipient = await getRecipientBySlug(slug);
  if (!recipient) notFound();

  const agencies = await getAllAgenciesForRecipient(recipient.recipient_uei);
  const displayName = fmtCompanyName(recipient.recipient_name);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Contractors', item: `${SITE_URL}/contractors` },
      { '@type': 'ListItem', position: 3, name: displayName, item: `${SITE_URL}/contractors/${slug}` },
      { '@type': 'ListItem', position: 4, name: 'Agencies', item: `${SITE_URL}/contractors/${slug}/agencies` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SubpageLayout
        slug={slug}
        displayName={displayName}
        totalObligated={fmtMoney(recipient.total_obligated)}
        awardCount={recipient.award_count}
        agencyCount={recipient.distinct_agency_count}
        naicsCount={recipient.distinct_naics_count}
        activeTab="agencies"
      >
        <header className="mb-6">
          <h2 className="text-2xl font-bold">Federal Agency Customers</h2>
          <p className="mt-1 text-sm text-slate-400">
            All {recipient.distinct_agency_count} federal agencies that have awarded contracts to {displayName}, sorted by total dollars.
          </p>
        </header>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="text-left px-4 py-3">Agency</th>
                <th className="text-right px-4 py-3">Awards</th>
                <th className="text-right px-4 py-3">% of Total</th>
                <th className="text-right px-4 py-3">Total Obligated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {agencies.map((a) => (
                <tr key={a.awarding_agency} className="hover:bg-slate-800/40">
                  <td className="px-4 py-3 text-slate-200">
                    <Link
                      href={`/agencies/${agencySlug(a.awarding_agency)}`}
                      className="hover:text-purple-400"
                    >
                      {a.awarding_agency}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300 whitespace-nowrap">{a.award_count.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-400 whitespace-nowrap">
                    {(Number(a.pct_of_total) * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-purple-400 whitespace-nowrap">
                    {fmtMoney(Number(a.total_amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {agencies.length === 0 && (
          <p className="mt-6 text-slate-400 text-sm">No agency data available.</p>
        )}

        {/* CTA */}
        <section className="mt-12 rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/40 to-slate-900 p-8 text-center">
          <h2 className="text-xl font-bold">Track {displayName}&apos;s Agency Relationships</h2>
          <p className="mt-2 max-w-2xl mx-auto text-slate-300 text-sm">
            Mindy watches agency spending patterns and surfaces opportunities matching {displayName}&apos;s active customers.
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

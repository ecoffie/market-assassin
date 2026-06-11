/**
 * /top/[slug] — Top-N contractor listicle pages.
 *
 * Powers the high-demand queries GSC surfaced in week 1:
 *   "top federal system integrators"
 *   "top government contractors"
 *   "largest federal contractors"
 *   "top defense contractors"
 *   "top 8a contractors"
 *
 * Each listicle is defined in src/data/top-listicles.ts and renders
 * via the right BQ helper based on `kind` (all / agency / naics /
 * set-aside).
 *
 * ISR-only. Each page makes 1 BQ query (scans ~5-8 GB cold). KV
 * cache keeps subsequent renders sub-50ms.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import MemberAwareCta from '@/components/MemberAwareCta';
import { notFound } from 'next/navigation';
import { getListicleBySlug, LISTICLES } from '@/data/top-listicles';
import {
  getTopContractors,
  getTopContractorsByAgency,
  getTopContractorsBySubAgency,
  getTopContractorsByNaics,
  getTopContractorsBySetAside,
  getTopContractorsByState,
  type TopContractorRow,
} from '@/lib/bigquery/top-listicles';
import { formatCompanyName as fmtCompanyName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';
import { recipientSlug } from '@/lib/bigquery/recipients';

const SITE_URL = 'https://getmindy.ai';
const LIMIT = 50;

export const revalidate = 604800; // 7d
export const dynamicParams = false;

export async function generateStaticParams() {
  // All listicles are well-defined upfront. Return them so each gets
  // a stable URL — but don't run BQ at build (ISR fills it on first hit).
  return LISTICLES.map((l) => ({ slug: l.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const listicle = getListicleBySlug(slug);
  if (!listicle) return { title: 'Top Contractors Not Found | Mindy' };

  return {
    title: `${listicle.title} | Mindy`,
    description: listicle.description,
    alternates: { canonical: `${SITE_URL}/top/${slug}` },
    openGraph: {
      title: listicle.title,
      description: listicle.description,
      url: `${SITE_URL}/top/${slug}`,
      type: 'article',
      siteName: 'Mindy',
    },
    twitter: {
      card: 'summary_large_image',
      title: listicle.title,
      description: listicle.description,
    },
  };
}

async function fetchRows(listicle: ReturnType<typeof getListicleBySlug>): Promise<TopContractorRow[]> {
  if (!listicle) return [];
  switch (listicle.kind) {
    case 'all':
      return getTopContractors(LIMIT);
    case 'agency':
      return getTopContractorsByAgency(listicle.filter || '', LIMIT);
    case 'sub-agency':
      return getTopContractorsBySubAgency(listicle.filterPatterns || [], LIMIT);
    case 'naics':
      return getTopContractorsByNaics(listicle.filter || '', LIMIT);
    case 'set-aside':
      return getTopContractorsBySetAside(listicle.filterPatterns || [], LIMIT);
    case 'state':
      return getTopContractorsByState(listicle.filter || '', LIMIT);
    default:
      return [];
  }
}

export default async function ListiclePage({ params }: PageProps) {
  const { slug } = await params;
  const listicle = getListicleBySlug(slug);
  if (!listicle) notFound();

  const rows = await fetchRows(listicle);

  // JSON-LD: ItemList schema for the ranked list + BreadcrumbList
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ItemList',
        '@id': `${SITE_URL}/top/${slug}#list`,
        name: listicle.title,
        description: listicle.description,
        numberOfItems: rows.length,
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        itemListElement: rows.slice(0, 25).map((row, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'Organization',
            name: fmtCompanyName(row.recipient_name),
            identifier: row.recipient_uei,
            url: `${SITE_URL}/contractors/${recipientSlug(row.recipient_name)}`,
          },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Top Contractor Lists', item: `${SITE_URL}/top` },
          { '@type': 'ListItem', position: 3, name: listicle.shortTitle, item: `${SITE_URL}/top/${slug}` },
        ],
      },
    ],
  };

  const totalAggregated = rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumb */}
      <div className="mx-auto max-w-6xl px-6 pt-6 text-sm text-slate-400">
        <Link href="/" className="hover:text-purple-400">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/top" className="hover:text-purple-400">Top Lists</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-300">{listicle.shortTitle}</span>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-6 pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400">
          Federal Contractor Ranking
        </p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight">{listicle.title}</h1>
        <p className="mt-4 max-w-3xl text-lg text-slate-300">{listicle.intro}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3 max-w-3xl">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="text-2xl font-bold text-purple-300">{rows.length}</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">Contractors Ranked</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="text-2xl font-bold text-white">{fmtMoney(totalAggregated)}</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">Combined Obligated</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="truncate text-sm font-medium text-slate-300">{listicle.cohort}</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">Cohort</div>
          </div>
        </div>
      </section>

      {/* Ranked list */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="text-left px-4 py-3 w-12">Rank</th>
                <th className="text-left px-4 py-3">Contractor</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">Awards</th>
                <th className="text-right px-4 py-3">Total Obligated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((row, idx) => (
                <tr key={row.recipient_uei} className="hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-mono text-slate-400 text-base font-semibold">
                    #{idx + 1}
                  </td>
                  <td className="px-4 py-3 text-slate-200">
                    <Link
                      href={`/contractors/${recipientSlug(row.recipient_name)}`}
                      className="hover:text-purple-400 font-medium"
                    >
                      {fmtCompanyName(row.recipient_name)}
                    </Link>
                    <p className="font-mono text-xs text-slate-500 mt-0.5">UEI {row.recipient_uei}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300 hidden md:table-cell whitespace-nowrap">
                    {Number(row.award_count).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-purple-400 whitespace-nowrap">
                    {fmtMoney(Number(row.total_amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Source: USAspending.gov, FY2016–FY2026. Mindy aggregates by contractor legal name and rolls up parent +
          subsidiary UEI relationships. Click any row to view full contracting profile.
        </p>
      </section>

      {/* Cross-link to other listicles */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <h2 className="text-2xl font-bold mb-4">Other Top Contractor Lists</h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {LISTICLES.filter((l) => l.slug !== slug)
            .slice(0, 6)
            .map((l) => (
              <Link
                key={l.slug}
                href={`/top/${l.slug}`}
                className="rounded-lg border border-slate-800 bg-slate-900 p-4 hover:border-purple-500/50 hover:bg-slate-800 transition-colors"
              >
                <p className="text-sm font-medium text-slate-100">{l.shortTitle}</p>
                <p className="mt-1 text-xs text-slate-500">{l.cohort}</p>
              </Link>
            ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/40 to-slate-900 p-8 text-center">
          <h2 className="text-2xl font-bold">Want to compete with the companies on this list?</h2>
          <p className="mt-3 mb-6 max-w-2xl mx-auto text-slate-300">
            Their contracts won&apos;t last forever. When the government re-awards that work, Mindy
            tells you up to a year early — so you have time to get ready and go after it.
          </p>
          <MemberAwareCta memberHref="/app" memberLabel="Open Mindy →">
            <Link
              href="/signup"
              className="inline-flex rounded-xl bg-purple-600 px-6 py-3 font-semibold text-white hover:bg-purple-500 shadow-lg shadow-purple-500/20"
            >
              Start free →
            </Link>
          </MemberAwareCta>
        </div>
      </section>
    </main>
  );
}

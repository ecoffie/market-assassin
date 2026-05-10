import type { Metadata } from 'next';
import Link from 'next/link';
import {
  findContractorBySlug,
  formatCompactCurrency,
  getContractorSalesHistory,
} from '@/lib/contractor-sales-history';

export const dynamic = 'force-dynamic';

const SITE_URL = 'https://mi.govcongiants.com';
const SITE_NAME = 'GovCon Giants';

/**
 * Gated content schema - tells Google which parts are free vs paywalled
 * Free preview: stats, YoY chart, top agencies/NAICS (visible to all)
 * Paid content: full award list, contacts, teaming workflows, exports
 */
function gatedContractorJsonLd({
  company,
  description,
  slug,
}: {
  company: string;
  description: string;
  slug: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${company} Federal Contract Awards & Sales History`,
    description,
    url: `${SITE_URL}/contractors/${slug}`,
    isAccessibleForFree: false,
    hasPart: [
      {
        '@type': 'WebPageElement',
        isAccessibleForFree: true,
        cssSelector: '.free-preview',
      },
      {
        '@type': 'WebPageElement',
        isAccessibleForFree: false,
        cssSelector: '.premium-content',
      },
    ],
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}

interface ContractorPageProps {
  params: Promise<{ slug: string }>;
}

function formatDate(value: string | null) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export async function generateMetadata({ params }: ContractorPageProps): Promise<Metadata> {
  const { slug } = await params;
  const contractor = findContractorBySlug(slug);

  if (!contractor) {
    return {
      title: 'Federal Contractor Not Found | GovCon Giants',
    };
  }

  const title = `${contractor.company} Federal Contract Awards & Sales History`;
  const description = `Research ${contractor.company} federal contract sales, award history, agencies, NAICS codes, and recent government contracting activity.`;

  return {
    title,
    description,
    alternates: {
      canonical: `https://mi.govcongiants.com/contractors/${slug}`,
    },
    openGraph: {
      title,
      description,
      url: `https://mi.govcongiants.com/contractors/${slug}`,
      type: 'website',
    },
  };
}

export default async function ContractorPage({ params }: ContractorPageProps) {
  const { slug } = await params;
  const contractor = findContractorBySlug(slug);

  if (!contractor) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">
            Federal contractor database
          </p>
          <h1 className="mt-4 text-3xl font-bold">Contractor not found</h1>
          <p className="mt-3 text-slate-400">
            This contractor profile may have moved or may not be indexed yet.
          </p>
          <Link
            href="/contractor-database"
            className="mt-6 inline-flex rounded-lg bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-500"
          >
            Search contractors
          </Link>
        </div>
      </main>
    );
  }

  const history = await getContractorSalesHistory({
    company: contractor.company,
    publicView: true,
    awardLimit: 5,
  });

  const maxYearAmount = Math.max(...(history?.series.map((year) => year.totalObligations) || [1]), 1);
  const totalValue = history?.summary.totalObligations || contractor.contract_value_num || 0;
  const awardCount = history?.summary.awardCount || contractor.contract_count || 'N/A';

  const jsonLd = gatedContractorJsonLd({
    company: contractor.company,
    description: `Research ${contractor.company} federal contract sales, award history, agencies, NAICS codes, and recent government contracting activity.`,
    slug,
  });

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* JSON-LD for gated content - tells Google what's free vs paid */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">
                Federal contractor sales history
              </p>
              <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-normal text-white md:text-5xl">
                {contractor.company}
              </h1>
              <p className="mt-4 max-w-3xl text-lg text-slate-300">
                Public federal award history, agency concentration, NAICS activity, and year-over-year
                sales signals for government contractors.
              </p>
            </div>
            <Link
              href="/mi"
              className="inline-flex shrink-0 rounded-lg bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-500"
            >
              Unlock full Market Intelligence
            </Link>
          </div>
        </div>
      </section>

      {/* FREE PREVIEW SECTION - Indexed by Google */}
      <div className="free-preview mx-auto max-w-6xl space-y-8 px-6 py-10">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-3xl font-bold text-white">{formatCompactCurrency(totalValue)}</div>
            <div className="mt-2 text-sm text-slate-500">Known federal sales</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-3xl font-bold text-emerald-400">{awardCount}</div>
            <div className="mt-2 text-sm text-slate-500">Award records</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-3xl font-bold text-blue-400">
              {history?.summary.latestFiscalYear || 'N/A'}
            </div>
            <div className="mt-2 text-sm text-slate-500">Latest fiscal year</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="truncate text-xl font-bold text-purple-300">
              {history?.summary.topAgency || 'Multiple agencies'}
            </div>
            <div className="mt-2 text-sm text-slate-500">Top agency signal</div>
          </div>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-bold">Year-Over-Year Federal Sales</h2>
              <p className="mt-1 text-slate-400">
                Public preview of annual obligated dollars found in GovCon Giants award data.
              </p>
            </div>
            {history?.coverage === 'limited' && (
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-sm text-amber-300">
                Limited cached coverage
              </span>
            )}
          </div>

          {history?.series.length ? (
            <div className="mt-6 space-y-4">
              {history.series.map((year) => (
                <div key={year.fiscalYear} className="grid grid-cols-[4.5rem_1fr_7rem] items-center gap-3">
                  <div className="text-sm font-semibold text-slate-300">FY {year.fiscalYear}</div>
                  <div className="h-5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.max(4, (year.totalObligations / maxYearAmount) * 100)}%` }}
                    />
                  </div>
                  <div className="text-right text-sm font-bold text-white">
                    {formatCompactCurrency(year.totalObligations)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950 p-5 text-slate-400">
              Detailed annual sales are not cached yet. The contractor database currently shows{' '}
              {formatCompactCurrency(contractor.contract_value_num || 0)} in total contract value.
            </div>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-bold">Top Agencies</h2>
            <div className="mt-5 space-y-4">
              {history?.topAgencies.length ? history.topAgencies.map((agency) => (
                <div key={agency.agency} className="flex items-center justify-between gap-5">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-100">{agency.agency}</div>
                    <div className="text-sm text-slate-500">{agency.count} awards</div>
                  </div>
                  <div className="font-bold text-emerald-400">{formatCompactCurrency(agency.amount)}</div>
                </div>
              )) : (
                <p className="text-slate-400">Agency award details are available inside Market Intelligence.</p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-bold">Top NAICS Activity</h2>
            <div className="mt-5 space-y-4">
              {history?.topNaics.length ? history.topNaics.map((naics) => (
                <div key={naics.naics} className="flex items-center justify-between gap-5">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100">{naics.naics}</div>
                    <div className="truncate text-sm text-slate-500">{naics.description || 'No description'}</div>
                  </div>
                  <div className="font-bold text-emerald-400">{formatCompactCurrency(naics.amount)}</div>
                </div>
              )) : (
                <p className="text-slate-400">
                  Known profile NAICS: {contractor.naics && contractor.naics !== 'N/A' ? contractor.naics : 'Not listed'}
                </p>
              )}
            </div>
          </section>
        </div>

      </div>

      {/* PREMIUM CONTENT SECTION - Gated, not fully indexed by Google */}
      <div className="premium-content mx-auto max-w-6xl px-6 pb-10">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-bold">Recent Public Award Preview</h2>
              <p className="mt-1 text-slate-400">
                Full award list, contacts, teaming workflows, and exports are gated in MI.
              </p>
            </div>
            <Link
              href="/mi"
              className="inline-flex rounded-lg border border-emerald-500/40 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10"
            >
              Research this contractor in MI
            </Link>
          </div>

          <div className="mt-5 space-y-3">
            {history?.recentAwards.length ? history.recentAwards.map((award) => (
              <article key={award.id} className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-semibold text-white">{award.title}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {award.agency} · {formatDate(award.startDate)}
                    </p>
                  </div>
                  <div className="font-bold text-emerald-400">{formatCompactCurrency(award.amount)}</div>
                </div>
              </article>
            )) : (
              <p className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-slate-400">
                Recent award previews are not cached yet for this contractor.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

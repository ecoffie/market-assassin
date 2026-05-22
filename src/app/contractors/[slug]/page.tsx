import type { Metadata } from 'next';
import Link from 'next/link';
import {
  findContractorBySlug,
  formatCompactCurrency,
  getContractorSalesHistory,
  getContractorSlug,
} from '@/lib/contractor-sales-history';
import contractorsData from '@/data/contractors.json';

// Revalidate every 24h. USAspending data only refreshes weekly so
// we could go longer, but daily keeps the pages fresh-ish and
// matches our agency_target_data_cache TTL convention.
export const revalidate = 86_400; // 24h in seconds

// Pre-build the top contractors at build time so the highest-value
// SEO pages are served from cache, not a cold DB hit. The rest
// hydrate on first request and stick around for `revalidate`
// seconds via Next.js ISR.
const TOP_N_STATIC = 500;

interface ContractorRow {
  company: string;
  contract_value_num?: number;
}

export async function generateStaticParams() {
  const rows = (contractorsData as ContractorRow[])
    .filter(c => c.company)
    .sort((a, b) => (b.contract_value_num || 0) - (a.contract_value_num || 0))
    .slice(0, TOP_N_STATIC);

  // De-dupe by slug — contractors.json carries a few near-dupes
  // ("OPTUM PUBLIC SECTOR SOLUTIONS INC" vs " INC.") that would
  // throw "duplicate params" warnings at build.
  const seen = new Set<string>();
  const params: Array<{ slug: string }> = [];
  for (const c of rows) {
    const slug = getContractorSlug({ company: c.company });
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    params.push({ slug });
  }
  return params;
}

// Allow ISR for any slug not in the static set. First request to
// a new slug hits the DB, generates the page, then it's cached
// for `revalidate` seconds.
export const dynamicParams = true;

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
            <div className="mt-6 space-y-2">
              {history.series.map((year) => {
                const breakdown = year.agencyBreakdown || [];
                // Use native <details> so this drill-down works
                // without client JS and Googlebot can crawl the
                // expanded content. Defaults open on the most
                // recent FY to give first-time visitors immediate
                // signal without a click.
                const isMostRecent = year.fiscalYear === history.series[0].fiscalYear;
                return (
                  <details
                    key={year.fiscalYear}
                    open={isMostRecent}
                    className="group rounded-lg border border-transparent hover:border-slate-800 open:border-slate-800 open:bg-slate-950/40 transition-colors"
                  >
                    <summary className={`grid grid-cols-[1.5rem_4.5rem_1fr_7rem] items-center gap-3 px-2 py-2 list-none ${breakdown.length > 0 ? 'cursor-pointer' : 'cursor-default'}`}>
                      <span className="text-slate-500 text-sm select-none">
                        {breakdown.length > 0 ? (
                          <>
                            <span className="group-open:hidden">▸</span>
                            <span className="hidden group-open:inline">▼</span>
                          </>
                        ) : null}
                      </span>
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
                    </summary>
                    {breakdown.length > 0 && (
                      <div className="ml-10 mr-2 mb-3 mt-1 space-y-1.5 border-l border-slate-800 pl-3">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                          Agencies awarding in FY {year.fiscalYear}
                        </p>
                        {[...breakdown]
                          .sort((a, b) => b.amount - a.amount)
                          .slice(0, 8)
                          .map((row) => (
                            <div key={`${year.fiscalYear}-${row.agency}`} className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-slate-300 truncate flex-1">{row.agency}</span>
                              <span className="text-slate-500 shrink-0">{row.count} {row.count === 1 ? 'award' : 'awards'}</span>
                              <span className="text-emerald-400 font-semibold shrink-0 w-24 text-right">
                                {formatCompactCurrency(row.amount)}
                              </span>
                            </div>
                          ))}
                        {breakdown.length > 8 && (
                          <p className="text-[10px] text-slate-600 italic pt-1">
                            +{breakdown.length - 8} more agencies in FY {year.fiscalYear}
                          </p>
                        )}
                      </div>
                    )}
                  </details>
                );
              })}
              <p className="text-[11px] text-slate-500 italic pt-2 text-center">
                Click any year to expand the per-agency breakdown.
              </p>
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

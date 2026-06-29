/**
 * /agencies/[slug] — Per-agency contract opportunities page.
 *
 * Programmatic SEO page for keyword patterns like:
 *   "[agency] contract opportunities"
 *   "who sells to [agency]"
 *   "[agency] small business contracts"
 *   "[agency] forecast"
 *
 * One page per top-tier federal agency (49 total). Statically
 * prerendered via generateStaticParams so every agency ships as a
 * cacheable HTML file off the edge.
 *
 * Sections conditionally rendered when source data is present —
 * we never fabricate a pain-points or procurement-portal block;
 * better to omit than to fill with generic filler.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AGENCIES_SEO,
  getAgencyBySlug,
  getRelatedAgencies,
  type AgencySeo,
} from '@/data/agencies-seo';
import { getBqAgencyName } from '@/data/agency-bq-mapping';
import { NAICS_TOP_100 } from '@/data/naics-top100';
import {
  getAgencyProfile,
  getTopRecipientsForAgency,
  getTopNaicsForAgency,
  type AgencyProfile,
  type TopRecipientForAgency,
  type TopNaicsForAgency,
} from '@/lib/bigquery/agencies';
import { recipientSlug } from '@/lib/bigquery/recipients';
import { formatCompanyName as fmtCompanyName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoneyCompact } from '@/lib/format-money';

// Pre-compute the set of NAICS codes we have landing pages for so we
// can conditionally link rather than 404-ing users.
const LINKABLE_NAICS = new Set(NAICS_TOP_100.map((n) => n.code));

// Pre-render every agency at build time. 49 entries — cheap, and
// ISR-only — no build-time prerender. Each agency page now makes
// 3 BQ queries (profile + top 25 recipients + top 15 NAICS). DoD
// alone scans ~8 GB, so prerendering all 49 agencies at build
// would burn ~150 GB per Vercel deploy. ISR amortizes that across
// real Googlebot crawls.
export async function generateStaticParams() {
  return [];
}

export const dynamicParams = true;
export const revalidate = 604800; // 7d

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const agency = getAgencyBySlug(slug);

  if (!agency) {
    return {
      title: 'Agency not found | Mindy',
      description: 'The federal agency you requested could not be found.',
    };
  }

  // ~155 chars — Google snippet truncation target. Templated so each
  // page reads consistently but stays unique by name + figure. When
  // we lack a budget figure we drop the spend clause entirely rather
  // than glue the words together awkwardly ("spends federal contracts").
  const spendClause = agency.fy26BudgetB
    ? `${agency.name} spends $${agency.fy26BudgetB.toLocaleString()}B/yr on federal contracts.`
    : `${agency.name} is a federal buyer worth tracking.`;
  const desc = `${spendClause} Daily opportunity alerts, NAICS tracking, recompete monitoring from Mindy.`;

  // Front-load the agency's annual contract spend — a concrete number that
  // differentiates this from generic .gov results and lifts CTR — and match
  // buyer-intent ("what they buy", set-asides) the page actually delivers.
  const title = agency.fy26BudgetB
    ? `${agency.name}: $${agency.fy26BudgetB.toLocaleString()}B/yr — What They Buy & How to Win | Mindy`
    : `${agency.name}: What They Buy & How to Win Contracts | Mindy`;

  return {
    title,
    description: desc.length > 158 ? `${desc.slice(0, 155)}...` : desc,
    alternates: {
      canonical: `https://getmindy.ai/agencies/${agency.slug}`,
    },
    openGraph: {
      title,
      description: desc,
      type: 'article',
      url: `https://getmindy.ai/agencies/${agency.slug}`,
    },
    keywords: [
      `${agency.name} contract opportunities`,
      `who sells to ${agency.name}`,
      `${agency.name} small business contracts`,
      `${agency.name} forecast`,
      `${agency.abbreviation} contracts`,
      'federal agency procurement',
    ],
  };
}

export default async function AgencyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const agency = getAgencyBySlug(slug);
  if (!agency) notFound();

  const related = getRelatedAgencies(agency, 5);

  // Federal Award Activity (BigQuery) — fetched in parallel.
  // Falls back to nulls/empty arrays on any BQ failure so the static
  // content above always renders. Section is omitted entirely when the
  // agency has no BQ counterpart (e.g. TVA, FDIC) or when the profile
  // row is missing.
  const bqAgencyName = getBqAgencyName(agency.slug, agency.name);
  const [bqProfile, bqTopRecipients, bqTopNaics] = bqAgencyName
    ? await Promise.all([
        getAgencyProfile(bqAgencyName).catch(() => null),
        getTopRecipientsForAgency(bqAgencyName, 25).catch(() => []),
        getTopNaicsForAgency(bqAgencyName, 15).catch(() => []),
      ])
    : [null, [], []];

  const jsonLd = buildJsonLd(agency);

  return (
    <main className="min-h-screen bg-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumb */}
      <div className="border-b border-slate-900">
        <nav
          aria-label="Breadcrumb"
          className="max-w-5xl mx-auto px-4 py-4 text-sm text-slate-400"
        >
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className="hover:text-purple-300 transition">
                Home
              </Link>
            </li>
            <li aria-hidden className="text-slate-600">/</li>
            <li>
              <Link
                href="/agencies"
                className="hover:text-purple-300 transition"
              >
                Agencies
              </Link>
            </li>
            <li aria-hidden className="text-slate-600">/</li>
            <li className="text-slate-300">{agency.name}</li>
          </ol>
        </nav>
      </div>

      {/* Hero */}
      <section className="bg-gradient-to-br from-purple-900/40 via-slate-900 to-slate-950 py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/30 rounded-full mb-4">
            <span className="text-purple-300 text-xs font-semibold uppercase tracking-wide">
              {agency.abbreviation || 'Federal Agency'} · Agency Code{' '}
              {agency.cgac || 'n/a'}
            </span>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 leading-tight">
            {agency.name} Contract Opportunities
          </h1>
          <p className="text-lg text-slate-300 max-w-3xl">
            Federal market intelligence for{' '}
            {agency.abbreviation || agency.name}: budget, buying patterns,
            recompete signals, and the procurement portals you can&apos;t miss.
          </p>

          <HeroStats agency={agency} />
        </div>
      </section>

      {/* Body */}
      <section className="px-4 py-12">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-3 gap-8">
          <article className="lg:col-span-2 space-y-10">
            <WhatTheyBuy agency={agency} />
            <WhereTheyPost agency={agency} />
            <PainPoints agency={agency} />
            <Priorities agency={agency} />
            <SmallBusinessNote agency={agency} />
            <FederalAwardActivity
              agency={agency}
              profile={bqProfile}
              topRecipients={bqTopRecipients}
              topNaics={bqTopNaics}
            />
            <HowMindyTracks agency={agency} />
            <InlineCta agency={agency} />
          </article>

          {/* Sidebar */}
          <aside className="lg:col-span-1 space-y-6">
            <RelatedAgencies related={related} group={agency.group} />
            <BackToIndex />
          </aside>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="px-4 pb-20">
        <div className="max-w-3xl mx-auto bg-gradient-to-br from-purple-900/40 via-slate-900 to-slate-950 border border-purple-500/30 rounded-2xl p-8 md:p-12 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Get {agency.abbreviation || agency.name} opportunity alerts free
          </h2>
          <p className="text-lg text-slate-300 mb-8 max-w-xl mx-auto">
            Mindy watches {agency.abbreviation || agency.name} every day —
            SAM.gov, forecasts, recompetes — and emails the matches that fit
            your NAICS codes. No portal-checking. No filler.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-500/30 transition-all hover:scale-105"
          >
            Start Free — No Credit Card
          </Link>
          <p className="text-slate-500 text-sm mt-4">
            First briefing lands tomorrow morning.
          </p>
        </div>
      </section>
    </main>
  );
}

/* -------------------------------- sections -------------------------------- */

function HeroStats({ agency }: { agency: AgencySeo }) {
  const items: Array<{ label: string; value: string }> = [];
  if (agency.fy26BudgetB) {
    items.push({
      label: 'FY26 Budget',
      value: `$${agency.fy26BudgetB.toLocaleString()}B`,
    });
  }
  if (agency.fy25BudgetB && agency.budgetTrend) {
    const arrow =
      agency.budgetTrend === 'growing'
        ? '↑'
        : agency.budgetTrend === 'declining'
        ? '↓'
        : '→';
    items.push({
      label: 'YoY Trend',
      value: `${arrow} ${agency.budgetTrend}`,
    });
  }
  if (agency.procurement.topVehicles.length > 0) {
    items.push({
      label: 'Contract Vehicles',
      value: `${agency.procurement.topVehicles.length} tracked`,
    });
  }
  if (agency.painPoints.length > 0) {
    items.push({
      label: 'Pain Points',
      value: `${agency.painPoints.length} mapped`,
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
      {items.map((s) => (
        <div
          key={s.label}
          className="bg-slate-900/70 border border-slate-800 rounded-xl p-4"
        >
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
            {s.label}
          </div>
          <div className="text-lg font-bold text-purple-300">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function WhatTheyBuy({ agency }: { agency: AgencySeo }) {
  const vehicles = agency.procurement.topVehicles;
  const patterns = agency.procurement.spendingPatterns;
  const hasPatterns = patterns && Object.keys(patterns).length > 0;

  // Skip the whole block if we have neither vehicle nor pattern data —
  // generic boilerplate hurts more than it helps for SEO.
  if (vehicles.length === 0 && !hasPatterns) return null;

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-4">
        What {agency.abbreviation || agency.name} buys
      </h2>

      {hasPatterns && (
        <div className="mb-6">
          <p className="text-slate-300 mb-4 leading-relaxed">
            Most {agency.abbreviation || agency.name} dollars don&apos;t go
            through open SAM.gov competitions. Here&apos;s how the spend
            actually breaks down:
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(patterns).map(([k, v]) => (
              <div
                key={k}
                className="bg-slate-900 border border-slate-800 rounded-lg p-3"
              >
                <div className="text-2xl font-bold text-purple-300">{v}%</div>
                <div className="text-xs text-slate-400 mt-1">
                  {formatPatternLabel(k)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {vehicles.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-purple-400 mb-3">
            Top Contract Vehicles
          </h3>
          <ul className="space-y-2">
            {vehicles.slice(0, 8).map((v) => (
              <li
                key={v.name}
                className="flex items-start justify-between gap-4 bg-slate-900/60 border border-slate-800 rounded-lg p-3"
              >
                <div>
                  <div className="text-white font-semibold">{v.name}</div>
                  {v.manager && (
                    <div className="text-xs text-slate-500 mt-1">
                      Managed by {v.manager}
                    </div>
                  )}
                </div>
                {v.naics && v.naics.length > 0 && (
                  <div className="text-xs text-slate-400 text-right whitespace-nowrap">
                    NAICS: {v.naics.slice(0, 3).join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function WhereTheyPost({ agency }: { agency: AgencySeo }) {
  const { primarySources, secondarySources, tips } = agency.procurement;
  if (
    primarySources.length === 0 &&
    secondarySources.length === 0 &&
    !tips
  ) {
    return null;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-4">
        Where {agency.abbreviation || agency.name} posts opportunities
      </h2>
      {primarySources.length > 0 && (
        <p className="text-slate-300 mb-4 leading-relaxed">
          Primary channels:{' '}
          <span className="text-purple-300 font-semibold">
            {primarySources.map(formatSourceLabel).join(' · ')}
          </span>
          .
        </p>
      )}

      {secondarySources.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-purple-400 mb-3">
            Agency-Specific Portals
          </h3>
          <p className="text-sm text-slate-400 mb-3">
            These channels post opportunities you won&apos;t find on SAM.gov —
            most contractors miss them.
          </p>
          <ul className="space-y-2">
            {secondarySources.map((s) => (
              <li
                key={s.name + s.url}
                className="bg-slate-900/60 border border-slate-800 rounded-lg p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-1">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="nofollow noopener"
                    className="text-white font-semibold hover:text-purple-300 transition"
                  >
                    {s.name} <span aria-hidden>↗</span>
                  </a>
                  {s.type && (
                    <span className="text-xs text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      {s.type.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                {s.notes && (
                  <p className="text-sm text-slate-400">{s.notes}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tips && (
        <aside className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4 text-sm text-purple-100 leading-relaxed">
          <span className="font-semibold text-purple-300">Mindy&apos;s tip:</span>{' '}
          {tips}
        </aside>
      )}
    </div>
  );
}

function PainPoints({ agency }: { agency: AgencySeo }) {
  if (agency.painPoints.length === 0) return null;
  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-4">
        {agency.abbreviation || agency.name} pain points
      </h2>
      <p className="text-slate-300 mb-4 leading-relaxed">
        What {agency.abbreviation || agency.name} is actively trying to fix —
        sourced from agency strategic plans, IG reports, and FY26 budget
        justifications. Map your capabilities to these and you&apos;re writing
        toward an evaluator&apos;s actual problem.
      </p>
      <ul className="space-y-2">
        {agency.painPoints.map((p, i) => (
          <li
            key={i}
            className="flex items-start gap-3 bg-slate-900/60 border border-slate-800 rounded-lg p-4"
          >
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-xs font-bold flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <p className="text-slate-200 leading-relaxed">{p}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Priorities({ agency }: { agency: AgencySeo }) {
  if (agency.priorities.length === 0) return null;
  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-4">
        FY26 funding priorities
      </h2>
      <p className="text-slate-300 mb-4 leading-relaxed">
        Where the money is moving inside {agency.abbreviation || agency.name}{' '}
        in the current and upcoming fiscal years.
      </p>
      <ul className="space-y-3">
        {agency.priorities.map((p, i) => (
          <li
            key={i}
            className="border-l-2 border-purple-500/60 pl-4 py-1 text-slate-200 leading-relaxed"
          >
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SmallBusinessNote({ agency }: { agency: AgencySeo }) {
  // Per-agency small-business commentary, only when the data justifies it.
  // We pull from the procurement "tips" field if it mentions set-asides,
  // and from a curated list of agencies known to have strong programs.
  const STRONG_SB: Record<string, string> = {
    'department-of-veterans-affairs':
      'VA is the most SDVOSB-friendly buyer in the federal government — the Vets First contracting program requires SDVOSB consideration before any other socioeconomic category. Get CVE verified and you have a structural advantage.',
    'small-business-administration':
      'SBA sets small business policy and self-imposes high set-aside goals — 8(a), HUBZone, and WOSB awards are heavily concentrated here.',
    'department-of-agriculture':
      'USDA Forest Service and Rural Development consistently exceed small business goals. Strong HUBZone presence in rural set-asides.',
    'department-of-the-interior':
      'DOI runs heavy 8(a) competitions for environmental and tribal-land services. Strong fit for Native-owned firms.',
    'general-services-administration':
      'GSA Multiple Award Schedule (MAS) is the gateway — once you&apos;re on Schedule, every federal agency can buy from you without re-competing.',
    'national-aeronautics-and-space-administration':
      'NASA SBIR/STTR program is one of the most accessible R&D entry points in the federal market. Phase I awards are around $150K.',
  };

  const note = STRONG_SB[agency.slug];
  if (!note) return null;

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-4">
        Small business set-asides at {agency.abbreviation || agency.name}
      </h2>
      <div
        className="bg-emerald-900/15 border border-emerald-500/30 rounded-lg p-5 text-slate-200 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: note }}
      />
      <p className="text-sm text-slate-500 mt-3">
        Set-aside percentages shift quarterly. Mindy flags every set-aside
        opportunity in your daily briefing.
      </p>
    </div>
  );
}



function FederalAwardActivity({
  agency,
  profile,
  topRecipients,
  topNaics,
}: {
  agency: AgencySeo;
  profile: AgencyProfile | null;
  topRecipients: TopRecipientForAgency[];
  topNaics: TopNaicsForAgency[];
}) {
  // No BQ data at all → omit the whole section. We never render an
  // empty table; it would look broken and dilute the page's SEO weight.
  if (!profile && topRecipients.length === 0 && topNaics.length === 0) {
    return null;
  }

  const agencyTotal = profile ? Number(profile.total_obligated) : 0;
  const label = agency.abbreviation || agency.name;

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-3">
        Federal Award Activity
      </h2>
      <p className="text-slate-300 mb-6 leading-relaxed">
        Federal contracting activity for {agency.name} across FY2016–FY2026,
        drawn from USAspending.gov.
      </p>

      {profile && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Total Obligated
            </div>
            <div className="text-xl font-bold text-purple-300">
              {fmtMoneyCompact(Number(profile.total_obligated))}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Unique Recipients
            </div>
            <div className="text-xl font-bold text-purple-300">
              {Number(profile.recipient_count).toLocaleString()}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              NAICS Codes
            </div>
            <div className="text-xl font-bold text-purple-300">
              {Number(profile.naics_count).toLocaleString()}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Transactions
            </div>
            <div className="text-xl font-bold text-purple-300">
              {Number(profile.transaction_count).toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {topRecipients.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-purple-400 mb-3">
            Top {topRecipients.length} contractors selling to {label}
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/50 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3">Contractor</th>
                  <th className="text-right px-4 py-3">Awards</th>
                  <th className="text-right px-4 py-3">% of Agency</th>
                  <th className="text-right px-4 py-3">Total Obligated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {topRecipients.map((r) => {
                  const display = fmtCompanyName(r.recipient_name);
                  const slug = recipientSlug(r.recipient_name);
                  const total = Number(r.total_amount);
                  const pct =
                    agencyTotal > 0 ? (total / agencyTotal) * 100 : null;
                  return (
                    <tr key={r.recipient_uei} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3 text-slate-200">
                        <Link
                          href={`/contractors/${slug}`}
                          className="hover:text-purple-300 transition"
                        >
                          {display}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300 whitespace-nowrap">
                        {Number(r.award_count).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300 whitespace-nowrap">
                        {pct !== null
                          ? `${pct < 0.1 ? '<0.1' : pct.toFixed(1)}%`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-purple-400 whitespace-nowrap">
                        {fmtMoneyCompact(total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {topNaics.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-purple-400 mb-3">
            Top {topNaics.length} NAICS codes at {label}
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/50 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3">NAICS</th>
                  <th className="text-left px-4 py-3">Industry</th>
                  <th className="text-right px-4 py-3">Total Obligated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {topNaics.map((n) => {
                  const codeContent = LINKABLE_NAICS.has(n.naics_code) ? (
                    <Link
                      href={`/naics/${n.naics_code}`}
                      className="hover:text-purple-300 transition"
                    >
                      {n.naics_code}
                    </Link>
                  ) : (
                    n.naics_code
                  );
                  return (
                    <tr key={n.naics_code} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-mono text-slate-200">
                        {codeContent}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {n.naics_description || '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-purple-400 whitespace-nowrap">
                        {fmtMoneyCompact(Number(n.total_amount))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function HowMindyTracks({ agency }: { agency: AgencySeo }) {
  const sources = [
    'SAM.gov',
    ...agency.procurement.secondarySources.map((s) => s.name),
    'agency forecast portals',
    'recompete signals from expiring contracts',
  ];
  // De-dupe + cap at 5 for readability
  const unique = Array.from(new Set(sources)).slice(0, 5);

  return (
    <div className="bg-gradient-to-br from-purple-900/30 to-slate-900 border border-purple-500/30 rounded-xl p-6">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-lg shadow-purple-500/30">
          <span className="text-white font-bold text-lg">M</span>
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-purple-300 mb-3">
            How Mindy tracks {agency.abbreviation || agency.name}
          </h2>
          <p className="text-slate-200 leading-relaxed mb-3">
            Mindy pulls {agency.abbreviation || agency.name} opportunities
            from{' '}
            <span className="text-purple-300 font-semibold">
              {unique.length} sources
            </span>{' '}
            every day — {unique.join(', ')} — then filters by your NAICS,
            set-aside eligibility, and location. New opportunities and
            recompete signals land in a single morning email.
          </p>
          <p className="text-slate-400 text-sm">
            No more checking 12 portals. No more reading 80-page
            solicitations to figure out if you&apos;re even eligible.
          </p>
        </div>
      </div>
    </div>
  );
}

function InlineCta({ agency }: { agency: AgencySeo }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <p className="text-slate-300 mb-4 leading-relaxed">
        Want {agency.abbreviation || agency.name} opportunities matched to
        your business, delivered every morning?
      </p>
      <Link
        href="/signup"
        className="inline-block px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold transition"
      >
        Get the daily briefing — free
      </Link>
    </div>
  );
}

function RelatedAgencies({
  related,
  group,
}: {
  related: AgencySeo[];
  group: AgencySeo['group'];
}) {
  if (related.length === 0) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-purple-400 mb-4">
        Related agencies
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        Other {labelForGroup(group)} buyers worth tracking.
      </p>
      <ul className="space-y-3">
        {related.map((r) => (
          <li key={r.slug}>
            <Link href={`/agencies/${r.slug}`} className="block group">
              <div className="text-white font-semibold group-hover:text-purple-300 transition">
                {r.name}
              </div>
              {r.fy26BudgetB ? (
                <div className="text-slate-500 text-xs mt-1">
                  ${r.fy26BudgetB.toLocaleString()}B FY26 ·{' '}
                  {r.abbreviation || 'Federal Agency'}
                </div>
              ) : (
                <div className="text-slate-500 text-xs mt-1">
                  {r.abbreviation || 'Federal Agency'}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BackToIndex() {
  return (
    <Link
      href="/agencies"
      className="block bg-slate-900 border border-slate-800 hover:border-purple-500/40 rounded-xl p-6 transition group"
    >
      <div className="text-purple-400 text-sm font-semibold mb-1">
        ← Back to agency directory
      </div>
      <div className="text-slate-300 text-sm">
        Browse all {AGENCIES_SEO.length} federal agencies.
      </div>
    </Link>
  );
}

/* --------------------------------- helpers -------------------------------- */

function formatPatternLabel(key: string): string {
  const map: Record<string, string> = {
    samPosted: 'SAM.gov posted',
    gsaSchedule: 'GSA Schedule',
    idiqVehicles: 'IDIQ vehicles',
    directAwards: 'Direct awards',
    seaport: 'SeaPort',
    sewp: 'NASA SEWP',
    research: 'Research awards',
    nihVehicles: 'NIH vehicles',
    eagleVehicles: 'EAGLE II',
    vaVehicles: 'VA vehicles',
    labContracts: 'Lab contracts',
    grants: 'Grants',
    gsaAdvantage: 'GSA Advantage',
    ebuy: 'GSA eBuy',
  };
  return map[key] ?? key.replace(/([A-Z])/g, ' $1').trim();
}

function formatSourceLabel(src: string): string {
  const map: Record<string, string> = {
    'sam.gov': 'SAM.gov',
    gsa_schedule: 'GSA Schedule',
    idiq_vehicles: 'IDIQ vehicles',
    nih_vehicles: 'NIH CIO-SP vehicles',
    eagle_ii: 'EAGLE II',
    va_vehicles: 'VA T4NG / FSS',
    nspires: 'NSPIRES (NASA)',
    sewp: 'NASA SEWP',
    seaport: 'SeaPort-NxG',
    lab_portals: 'National Lab portals',
    gsa_advantage: 'GSA Advantage',
    ebuy: 'GSA eBuy',
    grants: 'Grants.gov',
  };
  return map[src] ?? src.replace(/_/g, ' ');
}

function labelForGroup(group: AgencySeo['group']): string {
  switch (group) {
    case 'defense':
      return 'defense & homeland';
    case 'health':
      return 'health-sector';
    case 'civilian':
      return 'cabinet civilian';
    case 'independent':
      return 'independent';
    default:
      return 'small-agency';
  }
}

/* --------------------------------- JSON-LD -------------------------------- */

function buildJsonLd(agency: AgencySeo) {
  const url = `https://getmindy.ai/agencies/${agency.slug}`;

  // GovernmentOrganization is the closest schema.org type for a
  // federal agency. We add an `identifier` for the CGAC code so
  // Google can disambiguate (some agencies share names with state-
  // level orgs). Mindy is referenced as the publisher via its
  // canonical Organization @id from the root layout.
  const govOrg: Record<string, unknown> = {
    '@type': 'GovernmentOrganization',
    '@id': `${url}#agency`,
    name: agency.name,
    alternateName: agency.abbreviation || undefined,
    url,
    identifier: agency.cgac
      ? {
          '@type': 'PropertyValue',
          propertyID: 'CGAC',
          value: agency.cgac,
        }
      : undefined,
  };

  // If the agency is part of a Cabinet department, signal that
  // hierarchy so Google understands the parent-child relationship.
  const PARENT_DEPT: Record<string, { name: string; slug: string }> = {
    'corps-of-engineers-civil-works': {
      name: 'Department of Defense',
      slug: 'department-of-defense',
    },
  };
  const parent = PARENT_DEPT[agency.slug];
  if (parent) {
    govOrg.parentOrganization = {
      '@type': 'GovernmentOrganization',
      name: parent.name,
      url: `https://getmindy.ai/agencies/${parent.slug}`,
    };
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [
      govOrg,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: 'https://getmindy.ai',
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Agencies',
            item: 'https://getmindy.ai/agencies',
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: agency.name,
            item: url,
          },
        ],
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: `${agency.name} Contract Opportunities`,
        about: { '@id': `${url}#agency` },
        isPartOf: {
          '@type': 'WebSite',
          '@id': 'https://getmindy.ai/#website',
        },
        publisher: {
          '@type': 'Organization',
          '@id': 'https://getmindy.ai/#organization',
        },
      },
    ],
  };
}

/**
 * /naics/[code] — per-NAICS federal contracts landing page.
 *
 * One SEO-optimized page per code in NAICS_TOP_100 (the 100 NAICS
 * codes with the highest aggregate federal contract value across
 * contractors.json). Mirrors the /glossary/[slug] pattern: static
 * prerender at build, DefinedTerm JSON-LD (NAICS codes are formal
 * definitions), breadcrumb schema, Mindy soft pitch.
 *
 * Keyword targets per page:
 *   - "naics <code> federal contracts"
 *   - "<title> government contracts"
 *   - "who buys <title>"
 *
 * Data discipline: every section is gated on having real data. If
 * a NAICS has no top contractors or no top agencies (rare in the
 * top 100 since they're selected by spend), the section is omitted
 * rather than padded with generic copy. No fabricated stats.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import MemberAwareCta from '@/components/MemberAwareCta';
import { notFound } from 'next/navigation';
import {
  NAICS_TOP_100,
  getNaicsTopEntry,
  getRelatedNaics,
} from '@/data/naics-top100';
import {
  getNaicsProfile,
  getTopRecipientsForNaics,
  getTopAgenciesForNaics,
  type TopRecipientForNaics,
  type TopAgencyForNaics,
} from '@/lib/bigquery/naics';
import { recipientSlug } from '@/lib/bigquery/recipients';
import { AGENCIES_SEO } from '@/data/agencies-seo';

// Prerender every top-100 NAICS at build. 100 entries is cheap and
// keeps the pages on the edge cache — no serverless invocation per
// crawler hit, which matters since we're explicitly inviting Google
// to ingest the whole set via the sitemap.
// ISR-only — no build-time prerender. Each NAICS page now makes 3 BQ
// queries (profile + top 25 recipients + top 10 agencies). Big NAICS
// like 334515 scan ~6 GB each, so prerendering all 100 top codes at
// build = ~600 GB scanned per deploy = ~$3.75 per Vercel deploy.
// ISR amortizes that across real Googlebot crawls (each unique page
// queries BQ exactly once then caches at edge for 7 days).
export async function generateStaticParams() {
  return [];
}

export const dynamicParams = true;
export const revalidate = 604800; // 7d

// Agencies that have a corresponding /agencies/[slug] landing page.
// Built once at module load — small constant set (~49 entries).
const LINKABLE_AGENCIES = new Set(AGENCIES_SEO.map((a) => a.slug));

function agencySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

// USD formatter for contract values. Compact notation ($146.4B, $90.7M)
// keeps headlines tight and avoids scientific notation on big primes.
function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

// Title-case helper for the SHOUTY agency names in contractors.json
// (e.g. "DEPT OF THE AIR FORCE" -> "Dept Of The Air Force"). Keeps
// common acronyms uppercase so we don't end up with "Dept Of The
// Navy" right next to "Cia" looking like a typo.
const KEEP_UPPER = new Set([
  'DOD', 'DHS', 'DOJ', 'DOE', 'DOT', 'HHS', 'HUD', 'VA', 'EPA', 'GSA',
  'NASA', 'NSF', 'NIH', 'CIA', 'FBI', 'NSA', 'DEA', 'ATF', 'TSA', 'FEMA',
  'CBP', 'ICE', 'USDA', 'USPS', 'USAID', 'USACE', 'USCG', 'USMC', 'USAF',
  'DLA', 'DCMA', 'DARPA', 'DHA', 'DTRA', 'DISA', 'DCSA', 'ANG', 'IRS',
  'SBA', 'BLM', 'IHS', 'NIST', 'NOAA', 'NPS', 'OSHA', 'FAA', 'FCC',
]);
function titleCaseAgency(name: string): string {
  return name
    .toLowerCase()
    .split(/(\s+|[(),])/)
    .map((part) => {
      const stripped = part.replace(/[(),\s]/g, '').toUpperCase();
      if (KEEP_UPPER.has(stripped)) return part.toUpperCase();
      if (!/[a-z]/i.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

// Same idea for SHOUTY company names. "PANTEXAS DETERRENCE  LLC" ->
// "Pantexas Deterrence LLC" — but preserve LLC/INC/CORP suffixes.
const KEEP_UPPER_COMPANY = new Set([
  'LLC', 'LLP', 'LP', 'INC', 'CORP', 'CO', 'PLC', 'LTD', 'PC',
  'USA', 'US', 'UK', 'IT', 'IBM', 'GE', 'HP', 'AT&T', 'BAE', 'CSRA',
  'L3', 'L3HARRIS', 'SAIC', 'KBR', 'CACI', 'CGI', 'GTSI', 'MITRE',
  'DXC', 'TYTO', 'IDS', 'CSC',
]);
function titleCaseCompany(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => {
      const cleaned = word.replace(/[.,]/g, '');
      if (KEEP_UPPER_COMPANY.has(cleaned.toUpperCase())) return word.toUpperCase();
      // Already mixed-case (e.g. "MicroStrategy") -> leave as-is.
      if (/[a-z]/.test(word) && /[A-Z]/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const entry = getNaicsTopEntry(code);

  // Resolve title from either source so codes outside top-100 still
  // get proper SEO metadata.
  let resolvedCode = code;
  let resolvedTitle: string | null = entry?.title ?? null;
  if (!entry) {
    const profile = await getNaicsProfile(code);
    if (!profile) {
      return {
        title: 'NAICS code not found | Mindy',
        description: 'The NAICS code you requested has no federal contract activity on record.',
      };
    }
    resolvedCode = profile.naics_code;
    resolvedTitle = profile.naics_description || `NAICS ${profile.naics_code}`;
  }

  const titleStr = resolvedTitle ?? `NAICS ${resolvedCode}`;
  // Description capped at ~155 chars per Google's snippet truncation.
  const description = `Federal market intelligence for NAICS ${resolvedCode} (${titleStr}). Daily opportunity alerts, incumbent tracking, recompete monitoring.`;
  const trimmed =
    description.length > 158
      ? `${description.slice(0, 155).trimEnd()}...`
      : description;

  return {
    title: `NAICS ${resolvedCode}: ${titleStr} — Federal Contracts | Mindy`,
    description: trimmed,
    alternates: {
      canonical: `https://getmindy.ai/naics/${resolvedCode}`,
    },
    openGraph: {
      title: `NAICS ${resolvedCode}: ${titleStr} — Federal Contracts | Mindy`,
      description: trimmed,
      type: 'article',
      url: `https://getmindy.ai/naics/${resolvedCode}`,
    },
    keywords: [
      `naics ${resolvedCode}`,
      `naics ${resolvedCode} federal contracts`,
      `${titleStr.toLowerCase()} government contracts`,
      `who buys ${titleStr.toLowerCase()}`,
      `${titleStr.toLowerCase()} federal buyers`,
      `naics code ${resolvedCode}`,
      'federal contract opportunities',
      'mindy naics',
    ],
  };
}

export default async function NaicsCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const topEntry = getNaicsTopEntry(code);
  const isTop100 = !!topEntry;

  // Pull BQ data in parallel — profile, top recipients, top agencies.
  // If the code is in top-100 these enrich the page; if not, the
  // profile becomes the source of truth and the static sections are
  // skipped.
  const [bqProfile, bqRecipients, bqAgencies] = await Promise.all([
    getNaicsProfile(code),
    getTopRecipientsForNaics(code, 25),
    getTopAgenciesForNaics(code, 10),
  ]);

  if (!topEntry && !bqProfile) notFound();

  // Synthesize an entry-shaped object when not in top-100, so the
  // existing JSX (which renders code/title/parent everywhere) stays
  // untouched. The flags below gate the static-derived sections.
  const entry = topEntry ?? {
    code: bqProfile!.naics_code,
    title: bqProfile!.naics_description || `NAICS ${bqProfile!.naics_code}`,
    parent: bqProfile!.naics_code.length >= 4 ? bqProfile!.naics_code.slice(0, 4) : null,
    contractorCount: bqProfile!.recipient_count,
    topContractors: [] as Array<{ company: string; value: number }>,
    topAgencies: [] as Array<{ name: string }>,
  };

  const related = isTop100 ? getRelatedNaics(entry.code, 5) : [];
  const hasContractors = isTop100 && entry.topContractors.length > 0;
  const hasAgencies = isTop100 && entry.topAgencies.length > 0;
  const hasBqData = !!bqProfile && (bqRecipients.length > 0 || bqAgencies.length > 0);

  // DefinedTerm JSON-LD — NAICS codes are formal, standardized
  // definitions (NAICS is literally the North American Industry
  // Classification *System*), so DefinedTerm is the most honest
  // schema choice. inDefinedTermSet points at a NAICSCodeSet anchor
  // so all 100 pages share the same set identity.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://getmindy.ai/#organization',
        name: 'Mindy',
        alternateName: 'Mindy AI',
        url: 'https://getmindy.ai',
        logo: 'https://getmindy.ai/icon.png',
      },
      {
        '@type': 'DefinedTerm',
        '@id': `https://getmindy.ai/naics/${entry.code}#term`,
        name: `NAICS ${entry.code}: ${entry.title}`,
        termCode: entry.code,
        description: `${entry.title}. A North American Industry Classification System (NAICS) code used by federal agencies to categorize the industry of contractors and procurements.`,
        url: `https://getmindy.ai/naics/${entry.code}`,
        inDefinedTermSet: {
          '@type': 'DefinedTermSet',
          '@id': 'https://getmindy.ai/naics#termset',
          name: 'NAICS Codes for Federal Contracting',
          url: 'https://getmindy.ai/naics',
        },
      },
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
            name: 'NAICS Codes',
            item: 'https://getmindy.ai/naics',
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: `${entry.code}: ${entry.title}`,
            item: `https://getmindy.ai/naics/${entry.code}`,
          },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen bg-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumbs */}
      <div className="bg-slate-950 border-b border-slate-900">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <nav
            aria-label="Breadcrumb"
            className="text-sm text-slate-400 flex flex-wrap items-center gap-2"
          >
            <Link href="/" className="hover:text-purple-300 transition">
              Home
            </Link>
            <span aria-hidden className="text-slate-600">/</span>
            <Link href="/naics" className="hover:text-purple-300 transition">
              NAICS Codes
            </Link>
            <span aria-hidden className="text-slate-600">/</span>
            <span className="text-slate-300">{entry.code}</span>
          </nav>
        </div>
      </div>

      {/* Hero — code + title + plain-English description */}
      <section className="bg-gradient-to-br from-purple-900/40 via-slate-900 to-slate-950 py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/30 rounded-full mb-4">
            <span className="text-purple-300 text-xs font-semibold uppercase tracking-wide">
              NAICS Code
            </span>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 leading-tight">
            NAICS {entry.code}:{' '}
            <span className="text-purple-300">{entry.title}</span> — Federal Contracts
          </h1>
          <p className="text-lg text-slate-300 max-w-3xl leading-relaxed">
            NAICS {entry.code} covers <strong>{entry.title.toLowerCase()}</strong>{' '}
            — one of the industries the federal government actively buys from.
            Below: who&apos;s buying, who&apos;s already winning, and how
            to surface opportunities in this code before the recompete.
          </p>
        </div>
      </section>

      {/* Body — two column on desktop */}
      <section className="px-4 py-12">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-8">
          {/* Main column */}
          <article className="md:col-span-2 space-y-10">
            {/* What this code covers */}
            <div>
              <h2 className="text-2xl font-bold text-white mb-3">
                What NAICS {entry.code} covers
              </h2>
              <p className="text-slate-200 leading-relaxed">
                The North American Industry Classification System (NAICS) is the
                standard the federal government uses to classify the industry
                of every contractor and every procurement. NAICS{' '}
                <strong>{entry.code}</strong> identifies businesses primarily
                engaged in <strong>{entry.title.toLowerCase()}</strong>. When
                a contracting officer publishes a solicitation on SAM.gov, they
                tag it with the NAICS code that best matches the work — which
                is why getting your NAICS portfolio right inside SAM is the
                single most important step for showing up in agency searches.
              </p>
            </div>

            {/* Who buys this — agency rollup */}
            {hasAgencies && (
              <div>
                <h2 className="text-2xl font-bold text-white mb-3">
                  Who buys NAICS {entry.code}?
                </h2>
                <p className="text-slate-300 mb-4 leading-relaxed">
                  The federal agencies awarding the most contract value to
                  vendors in this NAICS, based on{' '}
                  <strong>{entry.contractorCount}</strong> contractors tracked
                  in the Mindy contractor database:
                </p>
                <ol className="space-y-2">
                  {entry.topAgencies.map((ag, i) => (
                    <li
                      key={ag.name}
                      className="flex items-start gap-3 bg-slate-900/50 border border-slate-800 rounded-lg px-4 py-3"
                    >
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 text-sm font-bold">
                        {i + 1}
                      </span>
                      <span className="text-slate-100 font-medium leading-tight pt-1">
                        {titleCaseAgency(ag.name)}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="text-slate-500 text-xs mt-3">
                  Source: aggregated from the Mindy contractor database (prime
                  contractor disclosures via SBA + agency directories).
                </p>
              </div>
            )}

            {/* Top contractors */}
            {hasContractors && (
              <div>
                <h2 className="text-2xl font-bold text-white mb-3">
                  Top contractors in NAICS {entry.code}
                </h2>
                <p className="text-slate-300 mb-4 leading-relaxed">
                  The largest prime contractors associated with NAICS{' '}
                  {entry.code}, ranked by total reported federal contract
                  value. These are your most likely incumbents — and your most
                  likely teaming partners on recompetes:
                </p>
                <ol className="space-y-2">
                  {entry.topContractors.map((c, i) => (
                    <li
                      key={c.company}
                      className="flex items-start gap-3 bg-slate-900/50 border border-slate-800 rounded-lg px-4 py-3"
                    >
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 text-sm font-bold">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-100 font-medium leading-tight">
                          {titleCaseCompany(c.company)}
                        </div>
                        <div className="text-slate-400 text-sm mt-0.5">
                          {formatCurrency(c.value)} total reported value
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="text-slate-500 text-xs mt-3">
                  Values reflect each contractor&apos;s aggregate reported
                  federal contract value (across all of their NAICS codes,
                  not just {entry.code}). Use as a ranking signal, not as a
                  per-NAICS award total.
                </p>
              </div>
            )}

            {/* Federal Award Activity — real BQ-backed USASpending data */}
            {hasBqData && (
              <div>
                <h2 className="text-2xl font-bold text-white mb-3">
                  Federal Award Activity
                </h2>
                <p className="text-slate-300 mb-6 leading-relaxed">
                  Real-time federal contracting activity for NAICS {entry.code}{' '}
                  drawn from USAspending.gov, FY2016–FY2026.
                </p>

                {/* Headline stats — 3 stats from naics_summary */}
                {bqProfile && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                      <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                        Total Obligated
                      </div>
                      <div className="text-2xl font-bold text-purple-300">
                        {formatCurrency(bqProfile.total_obligated)}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        FY2016–FY2026
                      </div>
                    </div>
                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                      <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                        Unique Recipients
                      </div>
                      <div className="text-2xl font-bold text-purple-300">
                        {bqProfile.recipient_count.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Distinct contractors
                      </div>
                    </div>
                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                      <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                        Buying Agencies
                      </div>
                      <div className="text-2xl font-bold text-purple-300">
                        {bqProfile.agency_count.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Federal agencies
                      </div>
                    </div>
                  </div>
                )}

                {/* Top 25 contractors */}
                {bqRecipients.length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold text-white mb-3">
                      Top {bqRecipients.length} Contractors
                    </h3>
                    <div className="overflow-x-auto rounded-lg border border-slate-800">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-950/50">
                          <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                            <th className="px-4 py-3 font-semibold">#</th>
                            <th className="px-4 py-3 font-semibold">Contractor</th>
                            <th className="px-4 py-3 font-semibold text-right">Awards</th>
                            <th className="px-4 py-3 font-semibold text-right">Total $</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {bqRecipients.map((r: TopRecipientForNaics, i: number) => {
                            const slug = recipientSlug(r.recipient_name);
                            return (
                              <tr key={r.recipient_uei} className="hover:bg-slate-800/40 transition">
                                <td className="px-4 py-3 text-slate-500 font-mono">
                                  {i + 1}
                                </td>
                                <td className="px-4 py-3">
                                  <Link
                                    href={`/contractors/${slug}`}
                                    className="text-slate-100 hover:text-purple-300 font-medium transition"
                                  >
                                    {titleCaseCompany(r.recipient_name)}
                                  </Link>
                                </td>
                                <td className="px-4 py-3 text-right text-slate-300 font-mono">
                                  {r.award_count.toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-right text-purple-300 font-semibold font-mono">
                                  {formatCurrency(r.total_amount)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Top 10 buying agencies */}
                {bqAgencies.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3">
                      Top {bqAgencies.length} Buying Agencies
                    </h3>
                    <div className="overflow-x-auto rounded-lg border border-slate-800">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-950/50">
                          <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                            <th className="px-4 py-3 font-semibold">#</th>
                            <th className="px-4 py-3 font-semibold">Agency</th>
                            <th className="px-4 py-3 font-semibold text-right">Recipients</th>
                            <th className="px-4 py-3 font-semibold text-right">Total $</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {bqAgencies.map((a: TopAgencyForNaics, i: number) => {
                            const slug = agencySlug(a.awarding_agency);
                            const linkable = LINKABLE_AGENCIES.has(slug);
                            return (
                              <tr key={a.awarding_agency} className="hover:bg-slate-800/40 transition">
                                <td className="px-4 py-3 text-slate-500 font-mono">
                                  {i + 1}
                                </td>
                                <td className="px-4 py-3">
                                  {linkable ? (
                                    <Link
                                      href={`/agencies/${slug}`}
                                      className="text-slate-100 hover:text-purple-300 font-medium transition"
                                    >
                                      {titleCaseAgency(a.awarding_agency)}
                                    </Link>
                                  ) : (
                                    <span className="text-slate-100 font-medium">
                                      {titleCaseAgency(a.awarding_agency)}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-300 font-mono">
                                  {a.recipient_count.toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-right text-purple-300 font-semibold font-mono">
                                  {formatCurrency(a.total_amount)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <p className="text-slate-500 text-xs mt-4">
                  Source: USAspending.gov contract awards, FY2016–FY2026.
                  Updated regularly via BigQuery sync.
                </p>
              </div>
            )}

            {/* How Mindy tracks this NAICS */}
            <aside className="bg-gradient-to-br from-purple-900/30 to-slate-900 border border-purple-500/30 rounded-xl p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-lg shadow-purple-500/30">
                  <span className="text-white font-bold text-lg">M</span>
                </div>
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-purple-300 mb-2">
                    How Mindy tracks NAICS {entry.code}
                  </h2>
                  <p className="text-slate-200 leading-relaxed mb-3">
                    Mindy scans SAM.gov, Grants.gov, USASpending, and agency
                    procurement forecasts every day for NAICS {entry.code}.
                    New solicitations, sources-sought notices, and forecast
                    updates land in your morning briefing the same day they
                    post — translated into plain English, with the incumbent
                    and the recompete window already flagged.
                  </p>
                  <p className="text-slate-200 leading-relaxed">
                    For active contracts, Mindy tracks expiration dates 6-18
                    months out so you see the recompete before the
                    solicitation drops. That&apos;s the window where capture
                    actually moves the needle — not the 30 days after
                    SAM.gov publishes the RFP.
                  </p>
                  <Link
                    href="/signup"
                    className="inline-flex items-center gap-1 mt-4 text-purple-300 hover:text-purple-200 font-semibold transition text-sm"
                  >
                    Set NAICS {entry.code} as your focus area{' '}
                    <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            </aside>

            {/* CTA block */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h2 className="text-xl font-bold text-white mb-2">
                Get NAICS {entry.code} opportunities in your inbox
              </h2>
              <p className="text-slate-300 mb-4">
                Every new solicitation, sources sought, and forecast update
                for NAICS {entry.code} — delivered every morning. Free.
              </p>
              <Link
                href="/signup"
                className="inline-block px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold transition"
              >
                Get the free daily briefing
              </Link>
              <p className="text-slate-500 text-sm mt-3">
                No credit card. Cancel anytime. First briefing lands tomorrow morning.
              </p>
            </div>
          </article>

          {/* Sidebar */}
          <aside className="md:col-span-1 space-y-6">
            {/* Quick facts */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-purple-400 mb-4">
                Quick facts
              </h2>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-slate-400">NAICS code</dt>
                  <dd className="text-white font-mono font-semibold">
                    {entry.code}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Industry</dt>
                  <dd className="text-white font-medium">{entry.title}</dd>
                </div>
                {entry.parent && (
                  <div>
                    <dt className="text-slate-400">Parent (4-digit)</dt>
                    <dd className="text-white font-mono">{entry.parent}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-slate-400">Tracked contractors</dt>
                  <dd className="text-white font-semibold">
                    {entry.contractorCount.toLocaleString()}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Related NAICS */}
            {related.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-purple-400 mb-4">
                  Related NAICS
                </h2>
                <ul className="space-y-3">
                  {related.map((r) => (
                    <li key={r.code}>
                      <Link
                        href={`/naics/${r.code}`}
                        className="block group"
                      >
                        <div className="text-white font-semibold group-hover:text-purple-300 transition">
                          <span className="font-mono text-purple-400">
                            {r.code}
                          </span>{' '}
                          — {r.title}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Link
              href="/naics"
              className="block bg-slate-900 border border-slate-800 hover:border-purple-500/40 rounded-xl p-6 transition group"
            >
              <div className="text-purple-400 text-sm font-semibold mb-1">
                ← Back to NAICS index
              </div>
              <div className="text-slate-300 text-sm">
                Browse the top 100 NAICS codes by federal spend.
              </div>
            </Link>
          </aside>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="px-4 pb-20">
        <div className="max-w-3xl mx-auto bg-gradient-to-br from-purple-900/40 via-slate-900 to-slate-950 border border-purple-500/30 rounded-2xl p-8 md:p-12 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Stop refreshing SAM.gov for NAICS {entry.code}.
          </h2>
          <p className="text-lg text-slate-300 mb-8 max-w-xl mx-auto">
            Mindy watches NAICS {entry.code} across every federal source —
            SAM, Grants.gov, USASpending, agency forecasts — and emails you
            the matches every morning. So you read opportunities, not search
            results.
          </p>
          <MemberAwareCta memberHref="/app" memberLabel="Open Mindy →">
            <>
              <Link
                href="/signup"
                className="inline-block px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-500/30 transition-all hover:scale-105"
              >
                Meet Mindy — Free Daily Briefing
              </Link>
              <p className="text-slate-500 text-sm mt-4">
                No credit card. First briefing lands tomorrow morning.
              </p>
            </>
          </MemberAwareCta>
        </div>
      </section>
    </main>
  );
}

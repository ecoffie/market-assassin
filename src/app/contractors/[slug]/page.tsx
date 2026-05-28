/**
 * /contractors/[slug] — federal contractor profile page.
 *
 * Backed by BigQuery `usaspending.recipients` (~317K contractors) with
 * a fallback to the legacy `contractors.json` (~2,768 hand-curated
 * entries) for any slug that doesn't resolve in BQ.
 *
 * SEO model:
 *   - Canonical: https://getmindy.ai/contractors/<slug>
 *   - Schema: Organization (the contractor) + BreadcrumbList
 *   - All sections render server-side, no client JS needed
 *   - Free, no paywall directives. The full award table is the entire
 *     point of ranking for "<contractor> federal contracts".
 *
 * Rendering strategy:
 *   - Top 1,000 contractors by total_obligated → prerendered at build
 *     (covers ~80% of crawl traffic)
 *   - Rest → ISR on first request, revalidate every 7 days
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getRecipientBySlug,
  getYearlyTotalsForRecipient,
  getYearlyByAgencyForRecipient,
  getTopAgenciesForRecipient,
  getTopNaicsForRecipient,
  getRecentAwardsForRecipient,
  getExecutivesForRecipient,
  getSimilarRecipients,
  recipientSlug,
} from '@/lib/bigquery/recipients';
import { ContractorAnalytics } from '@/components/contractors/ContractorAnalytics';

const SITE_URL = 'https://getmindy.ai';

// ISR-only model. We don't prerender any contractor at build time
// because:
//   1. BQ has 317K recipients — prerendering even the top 1K = 6K BQ
//      jobs at build, slow + costly
//   2. ISR caches at the edge after the first request, so Googlebot
//      and real users get the same cached HTML
//   3. KV cache on the data layer (7-day TTL) absorbs cold-start cost
//
// generateStaticParams returns empty array → all routes render on demand
// the first time Googlebot or a user requests them.
export const revalidate = 604800; // 7 days
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

function fmtDate(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtCompanyName(raw: string): string {
  // SAM data is SHOUTY ALL-CAPS. Title-case for display, preserve common
  // acronyms (INC, LLC, CORP, USA, US, NA, etc.).
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

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const recipient = await getRecipientBySlug(slug);
  if (!recipient) {
    return { title: 'Contractor Not Found | Mindy' };
  }
  const displayName = fmtCompanyName(recipient.recipient_name);
  const title = `${displayName} — Federal Contract Awards & Sales History | Mindy`;
  const description = `${displayName} federal contracting profile: ${fmtMoney(recipient.total_obligated)} across ${recipient.award_count.toLocaleString()} awards from ${recipient.distinct_agency_count} agencies. UEI, NAICS, recent contracts, year-over-year trends.`;

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/contractors/${slug}` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/contractors/${slug}`,
      type: 'profile',
      siteName: 'Mindy',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function ContractorPage({ params }: PageProps) {
  const { slug } = await params;
  const recipient = await getRecipientBySlug(slug);
  if (!recipient) notFound();

  const displayName = fmtCompanyName(recipient.recipient_name);
  const uei = recipient.recipient_uei;

  // Fetch sub-sections in parallel — independent queries
  const [yearly, yearlyByAgency, topAgencies, treemapNaics, topNaics, recentAwards, executives] = await Promise.all([
    getYearlyTotalsForRecipient(uei),
    getYearlyByAgencyForRecipient(uei),
    getTopAgenciesForRecipient(uei, 10),
    getTopNaicsForRecipient(uei, 25), // wider NAICS set for treemap (more visual diversity than agencies)
    getTopNaicsForRecipient(uei, 10),
    getRecentAwardsForRecipient(uei, 25),
    getExecutivesForRecipient(uei),
  ]);

  // Related contractors (same top NAICS, exclude self). Fall back to
  // empty array if recipient has no NAICS history.
  const topNaicsCode = topNaics[0]?.naics_code;
  const related = topNaicsCode
    ? await getSimilarRecipients(uei, topNaicsCode, 8)
    : [];

  // JSON-LD: Organization + BreadcrumbList. NO `isAccessibleForFree:
  // false` directive — that signal told Google "skip ranking this".
  // The content here IS free. Public sales history is, by definition,
  // public.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/contractors/${slug}#org`,
        name: displayName,
        identifier: [
          { '@type': 'PropertyValue', propertyID: 'UEI', value: uei },
          ...(recipient.cage_code
            ? [{ '@type': 'PropertyValue', propertyID: 'CAGE', value: recipient.cage_code }]
            : []),
        ],
        ...(recipient.address || recipient.city
          ? {
              address: {
                '@type': 'PostalAddress',
                streetAddress: recipient.address || undefined,
                addressLocality: recipient.city || undefined,
                addressRegion: recipient.state || undefined,
                postalCode: recipient.zip || undefined,
                addressCountry: recipient.country || undefined,
              },
            }
          : {}),
        ...(recipient.parent_name
          ? { parentOrganization: { '@type': 'Organization', name: fmtCompanyName(recipient.parent_name) } }
          : {}),
        url: `${SITE_URL}/contractors/${slug}`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Contractors', item: `${SITE_URL}/contractors` },
          { '@type': 'ListItem', position: 3, name: displayName, item: `${SITE_URL}/contractors/${slug}` },
        ],
      },
    ],
  };

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
        <Link href="/contractors" className="hover:text-purple-400">Contractors</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-300">{displayName}</span>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-6 pb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400">
          Federal Contractor Profile
        </p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight">
          {displayName}
        </h1>
        <p className="mt-4 max-w-3xl text-lg text-slate-300">
          Federal contracting record: {fmtMoney(recipient.total_obligated)} obligated across{' '}
          {recipient.award_count.toLocaleString()} awards from {recipient.distinct_agency_count} agencies, FY{' '}
          {(yearly[0]?.fiscal_year ?? 2016)}–{(yearly[yearly.length - 1]?.fiscal_year ?? new Date().getFullYear())}.
        </p>

        {/* Identity stats */}
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <Stat label="Total Obligated" value={fmtMoney(recipient.total_obligated)} highlight />
          <Stat label="Award Records" value={recipient.award_count.toLocaleString()} />
          <Stat label="Agencies Served" value={recipient.distinct_agency_count.toString()} />
          <Stat label="NAICS Codes" value={recipient.distinct_naics_count.toString()} />
        </div>
      </section>

      {/* Company Profile */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <h2 className="text-2xl font-bold mb-4">Company Profile</h2>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 grid gap-4 md:grid-cols-2">
          <Field label="UEI (Unique Entity Identifier)" value={uei} mono />
          {recipient.cage_code && <Field label="CAGE Code" value={recipient.cage_code} mono />}
          {recipient.parent_name && <Field label="Parent Organization" value={fmtCompanyName(recipient.parent_name)} />}
          {(recipient.address || recipient.city) && (
            <Field
              label="Address"
              value={[recipient.address, recipient.city, recipient.state, recipient.zip].filter(Boolean).join(', ')}
            />
          )}
          <Field label="First Federal Award" value={fmtDate(recipient.first_action_date)} />
          <Field label="Most Recent Award" value={fmtDate(recipient.last_action_date)} />
        </div>
      </section>

      {/* Year over Year + Drilldown + Treemap */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <h2 className="text-2xl font-bold mb-1">Federal Sales Analytics</h2>
        <p className="text-sm text-slate-400 mb-4">
          Toggle between trend, agency drilldown, and treemap. Use the period selector to focus the time window.
        </p>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <ContractorAnalytics
            yearly={yearly.map((y) => ({
              fiscal_year: Number(y.fiscal_year),
              total_obligated: Number(y.total_obligated),
              award_count: Number(y.award_count),
            }))}
            yearlyByAgency={yearlyByAgency.map((r) => ({
              fiscal_year: Number(r.fiscal_year),
              awarding_agency: r.awarding_agency,
              total_amount: Number(r.total_amount),
              award_count: Number(r.award_count),
            }))}
            treemapNaics={treemapNaics.map((n) => ({
              naics_code: n.naics_code,
              naics_description: n.naics_description,
              total_amount: Number(n.total_amount),
              award_count: Number(n.award_count),
            }))}
          />
        </div>
      </section>

      {/* Top Agencies + Top NAICS */}
      <section className="mx-auto max-w-6xl px-6 pb-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-bold mb-4">Top Federal Agencies</h2>
          {topAgencies.length === 0 ? (
            <p className="text-slate-400 text-sm">No agency data.</p>
          ) : (
            <ul className="space-y-3">
              {topAgencies.map((a) => (
                <li key={a.awarding_agency} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-slate-100 font-medium">{a.awarding_agency}</p>
                    <p className="text-xs text-slate-500">{a.award_count} awards · {(Number(a.pct_of_total) * 100).toFixed(1)}% of total</p>
                  </div>
                  <span className="shrink-0 font-mono text-purple-400 font-semibold">{fmtMoney(Number(a.total_amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-bold mb-4">Top NAICS Activity</h2>
          {topNaics.length === 0 ? (
            <p className="text-slate-400 text-sm">No NAICS data.</p>
          ) : (
            <ul className="space-y-3">
              {topNaics.map((n) => (
                <li key={n.naics_code} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-mono text-slate-100">{n.naics_code}</p>
                    <p className="truncate text-xs text-slate-400">{n.naics_description}</p>
                    <p className="text-xs text-slate-500 mt-1">{n.award_count} awards</p>
                  </div>
                  <span className="shrink-0 font-mono text-purple-400 font-semibold">{fmtMoney(Number(n.total_amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Recent Awards Table */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <h2 className="text-2xl font-bold mb-4">Recent Federal Awards</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          {recentAwards.length === 0 ? (
            <p className="p-6 text-slate-400">No recent award data available.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-950/50 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Agency</th>
                  <th className="text-left px-4 py-3">NAICS</th>
                  <th className="text-left px-4 py-3">Description</th>
                  <th className="text-right px-4 py-3">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {recentAwards.map((a) => (
                  <tr key={a.award_id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{fmtDate(a.action_date)}</td>
                    <td className="px-4 py-3 text-slate-300 max-w-[14rem]">
                      <span className="truncate block">{a.awarding_agency || '—'}</span>
                      {a.awarding_office && <span className="text-xs text-slate-500 truncate block">{a.awarding_office}</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{a.naics_code || '—'}</td>
                    <td className="px-4 py-3 text-slate-300 max-w-[20rem]">
                      <span className="line-clamp-2">{a.description || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-purple-400 whitespace-nowrap">
                      {fmtMoney(Number(a.obligation_amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Executives (FFATA disclosures) */}
      {executives.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 pb-10">
          <h2 className="text-2xl font-bold mb-1">Top Compensated Officers</h2>
          <p className="text-sm text-slate-400 mb-4">
            From FFATA executive compensation disclosures. Reported when federal contract activity exceeds the
            statutory threshold.
          </p>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <ul className="space-y-3">
              {executives.map((e) => (
                <li key={e.exec_rank} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-slate-100 font-medium">{e.exec_name}</p>
                    <p className="text-xs text-slate-500">Rank {e.exec_rank} · Reported {fmtDate(e.reported_at)}</p>
                  </div>
                  <span className="font-mono text-purple-400 font-semibold">{fmtMoney(Number(e.exec_amount))}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Related Contractors */}
      {related.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 pb-10">
          <h2 className="text-2xl font-bold mb-1">Related Contractors</h2>
          <p className="text-sm text-slate-400 mb-4">
            Other companies active in NAICS {topNaicsCode} — {topNaics[0]?.naics_description}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {related.map((r) => (
              <Link
                key={r.recipient_uei}
                href={`/contractors/${recipientSlug(r.recipient_name)}`}
                className="rounded-lg border border-slate-800 bg-slate-900 p-4 hover:border-purple-500/50 hover:bg-slate-800 transition-colors"
              >
                <p className="text-sm font-medium text-slate-100 line-clamp-2">{fmtCompanyName(r.recipient_name)}</p>
                <p className="mt-2 font-mono text-xs text-purple-400">{fmtMoney(Number(r.total_obligated))}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/40 to-slate-900 p-8 text-center">
          <h2 className="text-2xl font-bold">Track {displayName} Recompetes Before They Post</h2>
          <p className="mt-3 max-w-2xl mx-auto text-slate-300">
            Mindy monitors {displayName}&apos;s active contracts and alerts you 12 months before they expire — so you can
            position to compete on recompete.
          </p>
          <Link
            href="/signup"
            className="mt-6 inline-flex rounded-xl bg-purple-600 px-6 py-3 font-semibold text-white hover:bg-purple-500 shadow-lg shadow-purple-500/20"
          >
            Get Free Recompete Alerts
          </Link>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${highlight ? 'border-purple-500/40 bg-purple-900/20' : 'border-slate-800 bg-slate-900'}`}>
      <div className={`text-3xl font-bold ${highlight ? 'text-purple-300' : 'text-white'}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-slate-200 ${mono ? 'font-mono text-sm' : ''}`}>{value}</p>
    </div>
  );
}

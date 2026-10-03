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
import MeetMindyStrip from '@/components/MeetMindyStrip';
import MemberAwareCta from '@/components/MemberAwareCta';
import BackToAppHeader from '@/components/BackToAppHeader';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import {
  getRollupBySlug,
  getRollupOrSingleBySlug,
  resolveCanonicalSlug,
  getYearlyTotalsForRecipient,
  getYearlyByAgencyForRecipient,
  getTopAgenciesForRecipient,
  getTopNaicsForRecipient,
  getRecentAwardsForRecipient,
  getExecutivesForRecipient,
  getSimilarRecipients,
  recipientSlug,
} from '@/lib/bigquery/recipients';
import { serveableCanonical } from '@/lib/seo/canonical-redirect';
import { ContractorAnalytics } from '@/components/contractors/ContractorAnalytics';
import { AGENCIES_SEO } from '@/data/agencies-seo';
import { recordWarmMiss } from '@/lib/seo/served-slugs';
import {
  getSubawardsPaidOutSummary,
  getSubawardsReceivedSummary,
  getTopSubawardeesForPrime,
  getTopPrimesForSubawardee,
} from '@/lib/bigquery/subawards';
import { seoLiveBqEnabled } from '@/lib/seo/live-bq';
import { formatCompanyName as fmtCompanyName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';

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


function fmtDate(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}


interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Agencies that have a real `/agencies/[slug]` landing page (~49 of them).
 * Built once at module load; mirrors the same gate in `/naics/[code]`.
 */
const LINKABLE_AGENCIES = new Set(AGENCIES_SEO.map((a) => a.slug));

function agencySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  // Cache-first; on miss, try live BQ + recipients fallback so small/orphan
  // contractors still get proper meta tags (must mirror the page resolver).
  // The live fallback is gated by seoLiveBqEnabled() (default OFF) — crawler
  // cold-scans of the contractor long tail drained the BQ daily quota, so an
  // unwarmed contractor now 404s instead of scanning. Re-enable: ENABLE_SEO_LIVE_BQ=1.
  const recipient =
    (await getRollupBySlug(slug)) ??
    (seoLiveBqEnabled() ? await getRollupOrSingleBySlug(slug, true) : null);
  if (!recipient) {
    return { title: 'Contractor Not Found | Mindy' };
  }
  const displayName = fmtCompanyName(recipient.rollup_name);
  // Front-load the total-obligated figure: it's the distinctive hook that sets
  // a Mindy data page apart from the company's own site / Wikipedia in the SERP
  // and lifts CTR on page-1 impressions. Fall back to generic copy at $0.
  const totalObligated = Number(recipient.total_obligated || 0);
  const title =
    totalObligated > 0
      ? `${displayName} — ${fmtMoney(totalObligated)} in Federal Contracts | Mindy`
      : `${displayName} — Federal Contract Awards & History | Mindy`;
  const description = `${displayName} federal contracting profile: ${fmtMoney(recipient.total_obligated)} across ${Number(recipient.award_count || 0).toLocaleString()} awards from ${Number(recipient.distinct_agency_count || 0)} agencies. UEI, NAICS, recent contracts, year-over-year trends.`;

  // Thin-content gate. ~38% of the ~293K contractor rollups have < $25K
  // obligated or a single award — pages Google crawls but parks as "Crawled -
  // currently not indexed", diluting crawl budget across the whole surface.
  // Measured against 90d GSC data: EVERY contractor overview page that earns
  // search impressions is $290K+ (nearly all $1M+), so noindexing the thin tier
  // costs no real traffic while concentrating crawl + link equity on the
  // contractors that actually rank. noindex,follow keeps Google crawling
  // THROUGH these pages (similar-contractor links) to the substantial ones.
  // Threshold mirrors the SUBPAGE_MIN_ROWS pattern already used on the
  // naics/agencies sub-pages; sitemap.ts applies the same predicate so it never
  // advertises a URL this page then noindexes.
  const isThinContractor =
    totalObligated < 25000 || Number(recipient.award_count || 0) < 2;

  // Canonical always points at the rollup's own slug, even when this page
  // was reached via a sibling-UEI slug (which 308s before render anyway).
  return {
    title,
    description,
    robots: isThinContractor ? { index: false, follow: true } : undefined,
    alternates: { canonical: `${SITE_URL}/contractors/${recipient.canonical_slug}` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/contractors/${recipient.canonical_slug}`,
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
  // Fast path: cache-only rollup lookup. Hits for the warmed top-N
  // contractors and pays zero BQ cost.
  let recipient = await getRollupBySlug(slug);
  // Falling back means we paid for a live BQ rollup lookup — also pass
  // liveBq=true to the downstream sub-section queries below, otherwise the
  // page renders an empty header for any contractor not in the warmed cache
  // (the bug Eric hit on /contractors/excell-construction-corp).
  let needsLiveBq = false;
  if (!recipient) {
    // Slug doesn't match any rollup NAME. Before 404ing, check whether it's a
    // subsidiary slug (a child UEI's own name) that should consolidate onto its
    // parent — if so, 308 there.
    const canonical = await serveableCanonical(await resolveCanonicalSlug(slug));
    if (canonical) permanentRedirect(`/contractors/${canonical}`);

    // Last-ditch fallback: live BQ rollup + base-recipients table (catches
    // small contractors and orphan UEIs that the warmed cache + rollup table
    // both missed). ISR caches the resulting page for 7 days, so each unique
    // cold slug pays at most a handful of live BQ queries once per window.
    // GATED (default OFF): crawler cold-scans of the long tail drained the BQ
    // daily quota. When off, this fallback is cache-only → an unwarmed slug
    // 404s (no scan), and needsLiveBq stays false so the ~10 sub-section
    // queries below also stay cache-only. Re-enable: ENABLE_SEO_LIVE_BQ=1.
    const liveBq = seoLiveBqEnabled();
    recipient = await getRollupOrSingleBySlug(slug, liveBq);
    if (!recipient) {
      // CACHE MISS on a public request path. We do NOT know whether this
      // contractor exists — only that nothing is materialized for it — and we
      // are not allowed to find out synchronously: a crawler-triggered cold
      // scan is the exact shape that drained the BigQuery daily quota and took
      // the authenticated Contractors panel down with it.
      //
      // So record the slug for the next bounded warm job and return. If the
      // contractor is real, the warm materializes it and the URL starts serving;
      // if it is not, the warm reports it as genuinely gone and it stays a 404.
      // Either way the decision is made OFFLINE, under limits, never here.
      await recordWarmMiss(slug);
      notFound();
    }
    needsLiveBq = liveBq;
  }

  // Same-name orphan that resolved to a higher-spend rollup with a different
  // canonical slug → consolidate onto the canonical parent URL.
  if (recipient.canonical_slug !== slug) {
    permanentRedirect(`/contractors/${recipient.canonical_slug}`);
  }

  const displayName = fmtCompanyName(recipient.rollup_name);
  // Parent rollup: every awards query filters by the org's whole UEI set;
  // cache keys use the stable rollup_uei. Subaward queries stay keyed on the
  // canonical rollup UEI (subaward prime/sub linkage is per-UEI and doesn't
  // map cleanly to the parent set — a separate rollup if/when needed).
  const ueis = recipient.child_ueis;
  const rollupUei = recipient.rollup_uei;

  // Fetch sub-sections in parallel — independent queries
  const [
    yearly,
    yearlyByAgency,
    topAgencies,
    treemapNaics,
    topNaics,
    recentAwards,
    executives,
    subPaidOutSummary,
    subReceivedSummary,
  ] = await Promise.all([
    getYearlyTotalsForRecipient(ueis, rollupUei, needsLiveBq),
    getYearlyByAgencyForRecipient(ueis, rollupUei, needsLiveBq),
    getTopAgenciesForRecipient(ueis, rollupUei, 10, needsLiveBq),
    getTopNaicsForRecipient(ueis, rollupUei, 25, needsLiveBq), // wider NAICS set for treemap (more visual diversity than agencies)
    getTopNaicsForRecipient(ueis, rollupUei, 10, needsLiveBq),
    getRecentAwardsForRecipient(ueis, rollupUei, 25, needsLiveBq),
    getExecutivesForRecipient(ueis, rollupUei),
    getSubawardsPaidOutSummary(rollupUei),
    getSubawardsReceivedSummary(rollupUei),
  ]);

  // If the contractor has any subaward activity (in either direction),
  // fetch the top partners. We do this conditionally because most
  // contractors have neither — no point burning BQ on empty queries.
  const [topSubawardees, topPrimes] = await Promise.all([
    subPaidOutSummary ? getTopSubawardeesForPrime(rollupUei, 15) : Promise.resolve([]),
    subReceivedSummary ? getTopPrimesForSubawardee(rollupUei, 15) : Promise.resolve([]),
  ]);

  // Related contractors (same top NAICS, exclude this org's whole UEI set).
  // Fall back to empty array if recipient has no NAICS history.
  const topNaicsCode = topNaics[0]?.naics_code;
  const related = topNaicsCode
    ? await getSimilarRecipients(ueis, rollupUei, topNaicsCode, 8)
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
        '@id': `${SITE_URL}/contractors/${recipient.canonical_slug}#org`,
        name: displayName,
        identifier: [
          { '@type': 'PropertyValue', propertyID: 'UEI', value: rollupUei },
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
        url: `${SITE_URL}/contractors/${recipient.canonical_slug}`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Contractors', item: `${SITE_URL}/contractors` },
          { '@type': 'ListItem', position: 3, name: displayName, item: `${SITE_URL}/contractors/${recipient.canonical_slug}` },
        ],
      },
    ],
  };

  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <BackToAppHeader slug={recipient.canonical_slug} company={displayName} />
      <MeetMindyStrip variant="banner" appearance="public" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumb */}
      <div className="mx-auto max-w-6xl px-6 pt-6 text-sm text-(--mp-muted)">
        <Link href="/" className="hover:text-(--mp-navy-hover)">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/contractors" className="hover:text-(--mp-navy-hover)">Contractors</Link>
        <span className="mx-2">/</span>
        <span className="text-(--mp-body)">{displayName}</span>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-6 pb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--mp-navy)">
          Federal Contractor Profile
        </p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight font-(family-name:--mp-font-serif)">
          {displayName}
        </h1>
        <p className="mt-4 max-w-3xl text-lg text-(--mp-body)">
          Federal contracting record: {fmtMoney(recipient.total_obligated)} obligated across{' '}
          {Number(recipient.award_count || 0).toLocaleString()} awards from {Number(recipient.distinct_agency_count || 0)} agencies, FY{' '}
          {(yearly[0]?.fiscal_year ?? 2016)}–{(yearly[yearly.length - 1]?.fiscal_year ?? new Date().getFullYear())}.
        </p>

        {/* Identity stats */}
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <Stat label="Total Obligated" value={fmtMoney(recipient.total_obligated)} highlight />
          <Stat label="Award Records" value={Number(recipient.award_count || 0).toLocaleString()} />
          <Stat label="Agencies Served" value={Number(recipient.distinct_agency_count || 0).toString()} />
          <Stat label="NAICS Codes" value={Number(recipient.distinct_naics_count || 0).toString()} />
        </div>
      </section>

      {/* Tab nav — links to sub-pages */}
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex gap-1 border-b border-(--mp-line) overflow-x-auto">
          <span className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 border-(--mp-navy) text-(--mp-ink)">
            Overview
          </span>
          <Link
            href={`/contractors/${slug}/contracts`}
            className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 border-transparent text-(--mp-muted) hover:text-(--mp-ink) hover:border-(--mp-line) transition-colors"
          >
            Contracts
          </Link>
          <Link
            href={`/contractors/${slug}/agencies`}
            className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 border-transparent text-(--mp-muted) hover:text-(--mp-ink) hover:border-(--mp-line) transition-colors"
          >
            Agencies
          </Link>
          <Link
            href={`/contractors/${slug}/naics`}
            className="px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 border-transparent text-(--mp-muted) hover:text-(--mp-ink) hover:border-(--mp-line) transition-colors"
          >
            NAICS
          </Link>
        </div>
      </div>

      {/* Company Profile */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <h2 className="text-2xl font-bold mb-4 font-(family-name:--mp-font-serif)">Company Profile</h2>
        <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-6 grid gap-4 md:grid-cols-2">
          <Field label="Parent UEI (Unique Entity Identifier)" value={rollupUei} mono />
          {recipient.cage_code && <Field label="CAGE Code" value={recipient.cage_code} mono />}
          {recipient.child_count > 1 && (
            <Field
              label="Registered Entities (UEIs)"
              value={`${recipient.child_count.toLocaleString()} under this organization`}
            />
          )}
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
        <h2 className="text-2xl font-bold mb-1 font-(family-name:--mp-font-serif)">Federal Sales Analytics</h2>
        <p className="text-sm text-(--mp-muted) mb-4">
          Toggle between trend, agency drilldown, and treemap. Use the period selector to focus the time window.
        </p>
        <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-6">
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
        <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-6">
          <h2 className="text-xl font-bold mb-4 font-(family-name:--mp-font-serif)">Top Federal Agencies</h2>
          {topAgencies.length === 0 ? (
            <p className="text-(--mp-muted) text-sm">No agency data.</p>
          ) : (
            <ul className="space-y-3">
              {topAgencies.map((a) => (
                <li key={a.awarding_agency} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    {/* Link out to the agency's own landing page when one exists.
                        Until 2026-09-21 this rendered as plain text, so a contractor
                        page linked to nothing but its own tabs and the hub — 5 internal
                        links total. With no path between clusters there was nothing for
                        crawl equity to travel along, and Google parked the whole surface
                        under "Crawled - currently not indexed". */}
                    {LINKABLE_AGENCIES.has(agencySlug(a.awarding_agency)) ? (
                      <Link
                        href={`/agencies/${agencySlug(a.awarding_agency)}`}
                        className="truncate block text-(--mp-ink) font-medium hover:text-(--mp-navy-hover) hover:underline"
                      >
                        {a.awarding_agency}
                      </Link>
                    ) : (
                      <p className="truncate text-(--mp-ink) font-medium">{a.awarding_agency}</p>
                    )}
                    <p className="text-xs text-(--mp-muted)">{(Number(a.pct_of_total) * 100).toFixed(1)}% of total obligations</p>
                  </div>
                  <span className="shrink-0 font-(family-name:--mp-font-mono) text-(--mp-navy) font-semibold">{fmtMoney(Number(a.total_amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-6">
          <h2 className="text-xl font-bold mb-4 font-(family-name:--mp-font-serif)">Top NAICS Activity</h2>
          {topNaics.length === 0 ? (
            <p className="text-(--mp-muted) text-sm">No NAICS data.</p>
          ) : (
            <ul className="space-y-3">
              {topNaics.map((n) => (
                <li key={n.naics_code} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      href={`/naics/${n.naics_code}`}
                      className="font-(family-name:--mp-font-mono) text-(--mp-ink) hover:text-(--mp-navy-hover) hover:underline"
                    >
                      {n.naics_code}
                    </Link>
                    <p className="truncate text-xs text-(--mp-muted)">{n.naics_description}</p>
                    <p className="text-xs text-(--mp-muted) mt-1">{n.award_count} awards</p>
                  </div>
                  <span className="shrink-0 font-(family-name:--mp-font-mono) text-(--mp-navy) font-semibold">{fmtMoney(Number(n.total_amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Recent Awards Table */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <h2 className="text-2xl font-bold mb-4 font-(family-name:--mp-font-serif)">Recent Federal Awards</h2>
        <div className="overflow-x-auto rounded-lg border border-(--mp-line) bg-(--mp-surface)">
          {recentAwards.length === 0 ? (
            <p className="p-6 text-(--mp-muted)">No recent award data available.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-(--mp-wash) text-xs uppercase tracking-wider text-(--mp-muted)">
                <tr>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Agency</th>
                  <th className="text-left px-4 py-3">NAICS</th>
                  <th className="text-left px-4 py-3">Description</th>
                  <th className="text-right px-4 py-3">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--mp-line)">
                {recentAwards.map((a) => (
                  <tr key={a.award_id} className="hover:bg-(--mp-wash)">
                    <td className="px-4 py-3 text-(--mp-body) whitespace-nowrap">{fmtDate(a.action_date)}</td>
                    <td className="px-4 py-3 text-(--mp-body) max-w-[14rem]">
                      <span className="truncate block">{a.awarding_agency || '—'}</span>
                      {a.awarding_office && <span className="text-xs text-(--mp-muted) truncate block">{a.awarding_office}</span>}
                    </td>
                    <td className="px-4 py-3 font-(family-name:--mp-font-mono) text-xs text-(--mp-muted)">{a.naics_code || '—'}</td>
                    <td className="px-4 py-3 text-(--mp-body) max-w-[20rem]">
                      <span className="line-clamp-2">{a.description || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-(family-name:--mp-font-mono) font-semibold text-(--mp-navy) whitespace-nowrap">
                      {/* link the row to its award detail page (was a dead-end before) */}
                      {a.award_id ? (
                        <Link href={`/awards/${encodeURIComponent(a.award_id)}`} className="hover:text-(--mp-navy-hover) hover:underline">
                          {fmtMoney(Number(a.obligation_amount))} →
                        </Link>
                      ) : (
                        fmtMoney(Number(a.obligation_amount))
                      )}
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
          <h2 className="text-2xl font-bold mb-1 font-(family-name:--mp-font-serif)">Top Compensated Officers</h2>
          <p className="text-sm text-(--mp-muted) mb-4">
            From FFATA executive compensation disclosures. Reported when federal contract activity exceeds the
            statutory threshold.
          </p>
          <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-6">
            <ul className="space-y-3">
              {executives.map((e) => (
                <li key={e.exec_rank} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-(--mp-ink) font-medium">{e.exec_name}</p>
                    <p className="text-xs text-(--mp-muted)">Rank {e.exec_rank} · Reported {fmtDate(e.reported_at)}</p>
                  </div>
                  <span className="font-(family-name:--mp-font-mono) text-(--mp-navy) font-semibold">{fmtMoney(Number(e.exec_amount))}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Subawards Paid Out (this contractor as prime) */}
      {subPaidOutSummary && topSubawardees.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 pb-10">
          <h2 className="text-2xl font-bold mb-1 font-(family-name:--mp-font-serif)">Subawards Paid Out</h2>
          <p className="text-sm text-(--mp-muted) mb-4">
            {displayName} acts as a prime contractor and pays subcontractors on federal awards. Aggregated from
            USAspending sub-award reporting (FY2016-FY2026).
          </p>
          <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-6">
            <div className="grid gap-4 md:grid-cols-3 mb-6">
              <Stat label="Total Paid to Subs" value={fmtMoney(subPaidOutSummary.total_amount)} highlight />
              <Stat label="Sub Awards" value={subPaidOutSummary.count.toLocaleString()} />
              <Stat label="Distinct Subawardees" value={subPaidOutSummary.partner_count.toLocaleString()} />
            </div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-(--mp-muted) mb-3">
              Top {topSubawardees.length} Subawardees
            </h3>
            <ul className="divide-y divide-(--mp-line)">
              {topSubawardees.map((s) => (
                <li key={s.partner_uei} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/contractors/${recipientSlug(s.partner_name)}`}
                      className="text-(--mp-ink) hover:text-(--mp-navy-hover) font-medium"
                    >
                      {fmtCompanyName(s.partner_name)}
                    </Link>
                    <p className="text-xs text-(--mp-muted)">{Number(s.count).toLocaleString()} subawards</p>
                  </div>
                  <span className="font-(family-name:--mp-font-mono) text-(--mp-navy) font-semibold shrink-0">{fmtMoney(Number(s.total_amount))}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Subawards Received (this contractor as sub) */}
      {subReceivedSummary && topPrimes.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 pb-10">
          <h2 className="text-2xl font-bold mb-1 font-(family-name:--mp-font-serif)">Subawards Received</h2>
          <p className="text-sm text-(--mp-muted) mb-4">
            {displayName} also receives subaward dollars from other prime contractors. Aggregated from USAspending
            sub-award reporting (FY2016-FY2026).
          </p>
          <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-6">
            <div className="grid gap-4 md:grid-cols-3 mb-6">
              <Stat label="Total Received" value={fmtMoney(subReceivedSummary.total_amount)} highlight />
              <Stat label="Sub Awards" value={subReceivedSummary.count.toLocaleString()} />
              <Stat label="Distinct Primes" value={subReceivedSummary.partner_count.toLocaleString()} />
            </div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-(--mp-muted) mb-3">
              Top {topPrimes.length} Primes Paying {displayName}
            </h3>
            <ul className="divide-y divide-(--mp-line)">
              {topPrimes.map((p) => (
                <li key={p.partner_uei} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/contractors/${recipientSlug(p.partner_name)}`}
                      className="text-(--mp-ink) hover:text-(--mp-navy-hover) font-medium"
                    >
                      {fmtCompanyName(p.partner_name)}
                    </Link>
                    <p className="text-xs text-(--mp-muted)">{Number(p.count).toLocaleString()} subawards</p>
                  </div>
                  <span className="font-(family-name:--mp-font-mono) text-(--mp-navy) font-semibold shrink-0">{fmtMoney(Number(p.total_amount))}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Related Contractors */}
      {related.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 pb-10">
          <h2 className="text-2xl font-bold mb-1 font-(family-name:--mp-font-serif)">Related Contractors</h2>
          <p className="text-sm text-(--mp-muted) mb-4">
            Other companies active in NAICS {topNaicsCode} — {topNaics[0]?.naics_description}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {related.map((r) => (
              <Link
                key={r.recipient_uei}
                href={`/contractors/${recipientSlug(r.recipient_name)}`}
                className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-4 hover:border-(--mp-navy) hover:bg-(--mp-wash) transition-colors"
              >
                <p className="text-sm font-medium text-(--mp-ink) line-clamp-2">{fmtCompanyName(r.recipient_name)}</p>
                <p className="mt-2 font-(family-name:--mp-font-mono) text-xs text-(--mp-navy)">{fmtMoney(Number(r.total_obligated))}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="rounded-lg border border-(--mp-line) p-8 text-center bg-(--mp-wash)">
          <h2 className="text-2xl font-bold font-(family-name:--mp-font-serif)">Want to win work like {displayName}?</h2>
          <p className="mt-3 mb-6 max-w-2xl mx-auto text-(--mp-body)">
            Their contracts will eventually end — and when they do, the government has to award that
            work again. Mindy tells you up to a year early, so you can be ready to compete for it.
          </p>
          <MemberAwareCta appearance="public" memberHref="/app" memberLabel="Track this company in Mindy →">
            <Link
              href="/signup"
              className="inline-flex rounded-lg bg-(--mp-navy) px-6 py-3 font-semibold text-white hover:bg-(--mp-navy-hover)"
            >
              Track this company free →
            </Link>
          </MemberAwareCta>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-5 ${highlight ? 'border-(--mp-line) bg-(--mp-navy-wash)' : 'border-(--mp-line) bg-(--mp-surface)'}`}>
      <div className={`text-3xl font-bold ${highlight ? 'text-(--mp-navy)' : 'text-(--mp-ink)'}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-(--mp-muted)">{label}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-(--mp-muted)">{label}</p>
      <p className={`mt-1 text-(--mp-ink) ${mono ? 'font-(family-name:--mp-font-mono) text-sm' : ''}`}>{value}</p>
    </div>
  );
}

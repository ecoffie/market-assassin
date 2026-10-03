/**
 * /forecasts — the public agency-forecast hub.
 *
 * This URL returned 404 until 2026-09-21 while `agency_forecasts` held 35,912
 * rows in Supabase with no public surface at all. It was advertised in
 * sitemap.xml and linked from roughly 1,300 public pages, every one of them
 * pointing at a dead end.
 *
 * DESIGN CONSTRAINTS THIS PAGE HONOURS
 * ------------------------------------
 *  - ONE consolidated page. No URL per forecast: 35,912 rows do not become
 *    35,912 URLs. This is the authoritative subject page; the per-agency and
 *    per-NAICS detail already have their own canonical homes and are linked.
 *  - Server-rendered facts. A crawler with JavaScript disabled gets the real
 *    counts, the real agency names and the real NAICS codes in the HTML.
 *  - No BigQuery, and no table read either: ONE small KV read of a summary
 *    materialized offline. ISR-cached for a day on top of that.
 *  - Nothing estimated. `total` is an authoritative COUNT taken at build time,
 *    not a tally of rows that happened to transfer; a summary that is stale,
 *    truncated or the wrong shape renders the unavailable state and noindexes.
 *  - Visible provenance and freshness, because a forecast is a claim about the
 *    future and the reader deserves to know where it came from and how old it is.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getForecastSummary, agencySlug } from '@/lib/seo/forecasts-summary';
import { AGENCIES_SEO } from '@/data/agencies-seo';

export const revalidate = 86400; // daily; the upstream forecast files move slowly

/*
 * Data comes from a MATERIALIZED summary in KV, built offline by
 * `npm run seo:build-forecast-summary`. This page performs ONE small KV read,
 * shared between generateMetadata and the body via React cache() — it does not
 * read the agency_forecasts table, and it never touches BigQuery.
 *
 * If the summary is missing, stale, truncated or the wrong shape, the page
 * renders the unavailable state below and noindexes. That is deliberate: a
 * truncated summary undercounts, and publishing a total we cannot stand behind
 * is worse than publishing nothing.
 */

const SITE_URL = 'https://getmindy.ai';
const LINKABLE_AGENCIES = new Set(AGENCIES_SEO.map((a) => a.slug));

export async function generateMetadata(): Promise<Metadata> {
  const s = await getForecastSummary();
  const title = s.available
    ? `Federal Contract Forecasts — ${s.total.toLocaleString()} Upcoming Requirements | Mindy`
    : 'Federal Contract Forecasts | Mindy';
  const description = s.available
    ? `${s.total.toLocaleString()} forecasted federal requirements across ${s.agencies.length}+ agencies — what the government plans to buy next, with NAICS, set-aside and agency detail. Sourced from published agency forecasts.`
    : 'Forecasted federal requirements — what the government plans to buy next, from published agency forecast data.';
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/forecasts` },
    // An unavailable read must not be indexed as if it were an empty market.
    robots: s.available ? undefined : { index: false, follow: true },
    openGraph: { title, description, type: 'website', url: `${SITE_URL}/forecasts` },
  };
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export default async function ForecastsPage() {
  const s = await getForecastSummary();

  if (!s.available) {
    return (
      <main className="bg-(--mp-paper) text-(--mp-ink)">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <h1 className="text-3xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">Federal Contract Forecasts</h1>
          <p className="mt-4 text-(--mp-muted)">
            Forecast data is temporarily unavailable. Rather than show you a zero we cannot prove,
            we are showing you nothing. Try{' '}
            <Link href="/agencies" className="text-(--mp-navy) hover:underline">
              the agency directory
            </Link>{' '}
            or{' '}
            <Link href="/opportunity-hunter" className="text-(--mp-navy) hover:underline">
              open opportunities
            </Link>{' '}
            in the meantime.
          </p>
        </div>
      </main>
    );
  }

  const synced = fmtDate(s.lastSynced);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Dataset',
        '@id': `${SITE_URL}/forecasts#dataset`,
        name: 'Federal contract forecasts',
        description: `${s.total.toLocaleString()} forecasted federal requirements published by federal agencies, normalized by Mindy.`,
        url: `${SITE_URL}/forecasts`,
        ...(s.lastSynced ? { dateModified: s.lastSynced } : {}),
        isAccessibleForFree: true,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Forecasts', item: `${SITE_URL}/forecasts` },
        ],
      },
    ],
  };

  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-5xl px-6 py-14">
        <nav className="text-sm text-(--mp-muted)">
          <Link href="/" className="hover:text-(--mp-navy-hover)">Home</Link>
          <span className="mx-2">/</span>
          <span className="text-(--mp-body)">Forecasts</span>
        </nav>

        <h1 className="mt-6 text-3xl md:text-4xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">
          Federal Contract Forecasts — What Agencies Plan to Buy Next
        </h1>
        <p className="mt-5 text-lg text-(--mp-body) max-w-3xl">
          Federal agencies publish what they intend to buy before they buy it. Mindy has{' '}
          <strong className="text-(--mp-ink)">{s.total.toLocaleString()}</strong> of those forecasted
          requirements normalized into one place — the earliest legal signal you can act on, often
          months before a solicitation appears on SAM.gov.
        </p>
        <p className="mt-4 text-(--mp-muted) max-w-3xl">
          A forecast is a plan, not a promise: dates move, scopes change, and some entries never
          become contracts. That is exactly why they are useful. The window between a published
          forecast and a posted solicitation is the only period in which a small business can
          introduce itself to the buying office before the requirement is written.
        </p>

        {/* Provenance — a forecast is a claim about the future; say where it came from. */}
        <div className="mt-8 rounded-lg border border-(--mp-line) bg-(--mp-surface) p-5 text-sm">
          <p className="text-(--mp-body)">
            <strong className="text-(--mp-ink)">Sources:</strong>{' '}
            {s.sources.map((x) => x.label).join(', ')}.
          </p>
          {synced && (
            <p className="mt-2 text-(--mp-muted)">
              <strong className="text-(--mp-ink)">Last updated:</strong> {synced}.
            </p>
          )}
          <p className="mt-2 text-(--mp-muted)">
            Counts are taken from the {s.total.toLocaleString()} records actually held. Nothing on
            this page is estimated.
          </p>
        </div>

        {/* Agencies */}
        <h2 className="mt-12 text-2xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">Agencies with published forecasts</h2>
        <p className="mt-2 text-(--mp-muted)">Forecasted requirements by buying organization.</p>
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {s.agencies.map((a) => {
            const slug = agencySlug(a.label);
            return (
              <li key={a.key} className="flex items-baseline justify-between gap-3 border-b border-(--mp-hair) py-2">
                {LINKABLE_AGENCIES.has(slug) ? (
                  <Link href={`/agencies/${slug}`} className="text-(--mp-navy) hover:underline">
                    {a.label}
                  </Link>
                ) : (
                  <span className="text-(--mp-ink)">{a.label}</span>
                )}
                <span className="shrink-0 font-(family-name:--mp-font-mono) text-(--mp-muted)">{a.count.toLocaleString()}</span>
              </li>
            );
          })}
        </ul>

        {/* NAICS */}
        <h2 className="mt-12 text-2xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">Most forecasted industries (NAICS)</h2>
        <p className="mt-2 text-(--mp-muted)">
          If your NAICS code is here, agencies have already said they intend to buy your work.
        </p>
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {s.naics.map((n) => (
            <li key={n.key} className="flex items-baseline justify-between gap-3 border-b border-(--mp-hair) py-2">
              <Link href={`/naics/${n.key}`} className="text-(--mp-navy) hover:underline">
                <span className="font-(family-name:--mp-font-mono)">{n.key}</span>
                {n.label !== n.key && <span className="text-(--mp-muted)"> — {n.label}</span>}
              </Link>
              <span className="shrink-0 font-(family-name:--mp-font-mono) text-(--mp-muted)">{n.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>

        {/* Set-asides + fiscal years */}
        <div className="mt-12 grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">Set-aside intentions</h2>
            <p className="mt-2 text-(--mp-muted)">
              Where the agency has already signalled a small-business preference.
            </p>
            <ul className="mt-4 space-y-2">
              {s.setAsides.map((x) => (
                <li key={x.key} className="flex items-baseline justify-between gap-3 border-b border-(--mp-hair) py-2">
                  <span className="text-(--mp-ink)">{x.label}</span>
                  <span className="shrink-0 font-(family-name:--mp-font-mono) text-(--mp-muted)">{x.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-(--mp-muted)">
              Certified?{' '}
              <Link href="/set-asides" className="text-(--mp-navy) hover:underline">
                See the 8(a), HUBZone, SDVOSB and WOSB programs
              </Link>
              .
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">By fiscal year</h2>
            <p className="mt-2 text-(--mp-muted)">When the requirement is expected to land.</p>
            <ul className="mt-4 space-y-2">
              {s.fiscalYears.map((x) => (
                <li key={x.key} className="flex items-baseline justify-between gap-3 border-b border-(--mp-hair) py-2">
                  <span className="text-(--mp-ink)">{x.label}</span>
                  <span className="shrink-0 font-(family-name:--mp-font-mono) text-(--mp-muted)">{x.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <h2 className="mt-12 text-2xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">Where to go next</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 text-(--mp-muted)">
          <li>
            <Link href="/agencies" className="text-(--mp-navy) hover:underline">Agency directory</Link>
            {' '}— what each buyer purchases and where they post it.
          </li>
          <li>
            <Link href="/recompete" className="text-(--mp-navy) hover:underline">Contract recompetes</Link>
            {' '}— work already under contract that comes up again.
          </li>
          <li>
            <Link href="/opportunity-hunter" className="text-(--mp-navy) hover:underline">Open opportunities</Link>
            {' '}— what is solicitable right now.
          </li>
          <li>
            <Link href="/contractors" className="text-(--mp-navy) hover:underline">Contractor database</Link>
            {' '}— who holds the work today.
          </li>
        </ul>
      </div>
    </main>
  );
}

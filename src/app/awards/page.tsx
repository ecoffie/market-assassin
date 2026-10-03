/**
 * /awards — Federal contract awards database landing.
 *
 * Targets GSC queries with proven demand:
 *   "federal contracts awarded" (11)
 *   "awarded federal contracts" (7)
 *   "federal contract awards database" (4)
 *   "federal grant awards database" (5)
 *   "government contract awards" (5)
 *
 * Shows latest 50 + largest 50 dollar-bearing awards from
 * USAspending. Each row links to /awards/[id] for the full detail.
 *
 * ISR-only, 7-day revalidate. ~2 BQ queries cold (~3 GB scan total),
 * then KV-cached.
 */
import type { Metadata } from 'next';
import MeetMindyStrip from '@/components/MeetMindyStrip';
import Link from 'next/link';
import { getLatestAwards, getLargestAwards } from '@/lib/bigquery/awards';
import { formatCompanyName as fmtCompanyName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';
import { recipientSlug } from '@/lib/bigquery/recipients';

const SITE_URL = 'https://getmindy.ai';

// IMPORTANT: do NOT prerender at build. The two queries this page makes
// scan ~17 GB of the awards table; prerendering at build crashes the
// build when the per-query maximumBytesBilled cap rejects the scan.
//
// force-dynamic skips build-time prerender. Page renders on demand.
// Cost is bounded because our queryCached() wrapper hits Vercel KV
// in front of BQ — typical request scans 0 GB (cache hit) and runs
// the BQ query only after the 7-day KV TTL expires.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Federal Contract Awards Database — Latest & Largest | Mindy',
  description:
    'Search 63 million federal contract awards from USAspending.gov. Browse the latest awards, largest awards, and full detail for every recipient, agency, NAICS code, and award value.',
  alternates: { canonical: `${SITE_URL}/awards` },
  openGraph: {
    title: 'Federal Contract Awards Database | Mindy',
    description:
      'Search 63 million federal contract awards from USAspending.gov. Latest, largest, and full detail.',
    url: `${SITE_URL}/awards`,
    type: 'website',
    siteName: 'Mindy',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Federal Contract Awards Database | Mindy',
    description: 'Search 63M federal contract awards. Live from USAspending.gov.',
  },
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function AwardsLanding() {
  const [latest, largest] = await Promise.all([
    getLatestAwards(50),
    getLargestAwards(50),
  ]);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${SITE_URL}/awards#page`,
        name: 'Federal Contract Awards Database',
        description:
          '63 million federal contract awards from USAspending.gov. Browse latest, largest, and detail for every recipient + agency + NAICS.',
        url: `${SITE_URL}/awards`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Awards', item: `${SITE_URL}/awards` },
        ],
      },
    ],
  };

  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <MeetMindyStrip variant="banner" appearance="public" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto max-w-6xl px-6 pt-6 text-sm text-(--mp-muted)">
        <Link href="/" className="hover:text-(--mp-navy-hover)">Home</Link>
        <span className="mx-2">/</span>
        <span className="text-(--mp-body)">Awards</span>
      </div>

      <section className="mx-auto max-w-6xl px-6 pt-6 pb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--mp-navy)">
          Federal Contract Awards Database
        </p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight font-(family-name:--mp-font-serif)">
          63 Million Federal Contract Awards
        </h1>
        <p className="mt-4 max-w-3xl text-lg text-(--mp-body)">
          Every federal contract award from USAspending.gov, FY2016–FY2026. Browse the latest activity, the
          largest single awards, and drill into the full detail for any individual contract.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3 max-w-3xl">
          <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-4">
            <div className="text-2xl font-bold text-(--mp-navy)">63M+</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-(--mp-muted)">Awards Indexed</div>
          </div>
          <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-4">
            <div className="text-2xl font-bold text-(--mp-ink)">FY16–FY26</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-(--mp-muted)">10-Year Coverage</div>
          </div>
          <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-4">
            <div className="text-2xl font-bold text-(--mp-ink)">$10T+</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-(--mp-muted)">Total Obligated</div>
          </div>
        </div>
      </section>

      {/* Largest Awards (most ranking value) */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <h2 className="text-2xl font-bold mb-1 font-(family-name:--mp-font-serif)">Largest Federal Contract Awards</h2>
        <p className="text-sm text-(--mp-muted) mb-4">
          Top 50 federal contract awards of all time by single-action obligation amount.
        </p>
        <AwardsTable rows={largest} />
      </section>

      {/* Latest Awards */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <h2 className="text-2xl font-bold mb-1 font-(family-name:--mp-font-serif)">Latest Federal Contract Awards</h2>
        <p className="text-sm text-(--mp-muted) mb-4">
          The 50 most recent dollar-bearing federal contract actions from USAspending.gov.
        </p>
        <AwardsTable rows={latest} />
      </section>

      {/* Cross-link to other ways to slice the data */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <h2 className="text-2xl font-bold mb-4 font-(family-name:--mp-font-serif)">Other Ways to Browse</h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Link href="/contractors" className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-4 hover:border-(--mp-navy) hover:bg-(--mp-wash) transition-colors">
            <p className="text-sm font-medium text-(--mp-ink)">By Contractor</p>
            <p className="mt-1 text-xs text-(--mp-muted)">290K+ contractor profiles</p>
          </Link>
          <Link href="/agencies" className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-4 hover:border-(--mp-navy) hover:bg-(--mp-wash) transition-colors">
            <p className="text-sm font-medium text-(--mp-ink)">By Agency</p>
            <p className="mt-1 text-xs text-(--mp-muted)">49 federal agencies</p>
          </Link>
          <Link href="/naics" className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-4 hover:border-(--mp-navy) hover:bg-(--mp-wash) transition-colors">
            <p className="text-sm font-medium text-(--mp-ink)">By Industry (NAICS)</p>
            <p className="mt-1 text-xs text-(--mp-muted)">Top 100 NAICS codes</p>
          </Link>
          <Link href="/top" className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-4 hover:border-(--mp-navy) hover:bg-(--mp-wash) transition-colors">
            <p className="text-sm font-medium text-(--mp-ink)">Top Contractor Lists</p>
            <p className="mt-1 text-xs text-(--mp-muted)">Ranked lists by cohort</p>
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="rounded-lg border border-(--mp-line) p-8 text-center bg-(--mp-wash)">
          <h2 className="text-2xl font-bold font-(family-name:--mp-font-serif)">Get Alerts on New Awards Matching Your Profile</h2>
          <p className="mt-3 max-w-2xl mx-auto text-(--mp-body)">
            Mindy scans every new federal contract award daily and surfaces the ones matching your NAICS codes,
            agencies, and capabilities. Zero scrolling SAM.gov.
          </p>
          <Link
            href="/signup"
            className="mt-6 inline-flex rounded-lg bg-(--mp-navy) px-6 py-3 font-semibold text-white hover:bg-(--mp-navy-hover)"
          >
            Start Free
          </Link>
        </div>
      </section>
    </main>
  );

  // Shared table renderer (inline so it can access the page-local helpers)
  function AwardsTable({ rows }: { rows: typeof latest }) {
    return (
      <div className="overflow-x-auto rounded-lg border border-(--mp-line) bg-(--mp-surface)">
        <table className="w-full text-sm">
          <thead className="bg-(--mp-wash) text-xs uppercase tracking-wider text-(--mp-muted)">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Recipient</th>
              <th className="text-left px-4 py-3">Agency</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">NAICS</th>
              <th className="text-right px-4 py-3">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--mp-line)">
            {rows.map((a) => (
              <tr key={a.award_id} className="hover:bg-(--mp-wash)">
                <td className="px-4 py-3 text-(--mp-body) whitespace-nowrap">{fmtDate(a.action_date)}</td>
                <td className="px-4 py-3 max-w-[16rem]">
                  <Link
                    href={`/contractors/${recipientSlug(a.recipient_name)}`}
                    className="text-(--mp-ink) hover:text-(--mp-navy-hover) truncate block"
                  >
                    {fmtCompanyName(a.recipient_name)}
                  </Link>
                  <Link
                    href={
                      a.piid
                        ? `/contracts/${encodeURIComponent(a.piid)}`
                        : `/awards/${encodeURIComponent(a.award_id)}`
                    }
                    className="text-xs text-(--mp-muted) hover:text-(--mp-navy-hover)"
                  >
                    {a.piid || a.award_id.slice(0, 40)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-(--mp-body) max-w-[12rem]">
                  <span className="truncate block">{a.awarding_agency || '—'}</span>
                </td>
                <td className="px-4 py-3 font-(family-name:--mp-font-mono) text-xs text-(--mp-muted) hidden md:table-cell">{a.naics_code || '—'}</td>
                <td className="px-4 py-3 text-right font-(family-name:--mp-font-mono) font-semibold text-(--mp-navy) whitespace-nowrap">
                  {fmtMoney(Number(a.obligation_amount))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}

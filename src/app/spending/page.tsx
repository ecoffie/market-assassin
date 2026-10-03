/**
 * /spending — "This Week in Government Spending". The biggest recent federal contracts,
 * real + citable (each links to /awards/[id]). Public, shareable, SEO. Reads cheap from
 * Supabase (built weekly by /api/cron/build-recent-spending). Grounded, never faked.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import ShareButton from '@/components/ShareButton';
import { getRecentBigAwards } from '@/lib/discover/recent-spending';
import { contractScope } from '@/lib/discover/scope';
import { formatCompanyName as fmtName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';

const SITE_URL = 'https://getmindy.ai';
export const revalidate = 86400; // 1d; the weekly build cron also revalidatePath()s this

export const metadata: Metadata = {
  title: 'The Latest Big Federal Contracts — Government Spending | Mindy',
  description:
    'The biggest federal contracts the U.S. government has awarded recently — real, verifiable, and refreshed weekly. See who got paid, how much, and for what, straight from USASpending.',
  alternates: { canonical: `${SITE_URL}/spending` },
  openGraph: {
    title: 'The Latest Big Federal Contracts',
    description: 'The biggest federal contracts the government has awarded recently. Real and verifiable.',
    url: `${SITE_URL}/spending`,
    type: 'website',
    siteName: 'Mindy',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Latest Big Federal Contracts',
    description: 'The biggest federal contracts the government has awarded recently. Real and verifiable.',
  },
};

function fmtDate(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return d;
  }
}

export default async function SpendingPage() {
  const awards = await getRecentBigAwards(40).catch(() => []);
  const total = awards.reduce((s, a) => s + Number(a.obligation_amount || 0), 0);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'This Week in Government Spending',
    description: 'The biggest recent federal contract awards.',
    numberOfItems: awards.length,
    itemListElement: awards.slice(0, 25).map((a, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: { '@type': 'GovernmentService', name: `${fmtMoney(a.obligation_amount)} — ${fmtName(a.recipient_name || '')}`, url: `https://getmindy.ai/awards/${encodeURIComponent(a.award_id)}` },
    })),
  };

  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-5xl px-6 pt-6 text-sm text-(--mp-muted)">
        <Link href="/" className="hover:text-(--mp-navy-hover)">Home</Link>
        <span className="mx-2">/</span>
        <span className="text-(--mp-body)">Government Spending</span>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-6 pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--mp-navy)">Discover · Refreshed weekly</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight font-(family-name:--mp-font-serif)">The latest big federal contracts</h1>
        <p className="mt-4 max-w-2xl text-lg text-(--mp-body)">
          The biggest federal contracts the government has awarded recently — who got paid, how much, and for what.
          Every figure is real and verifiable. Click any to see the official record.
        </p>
        {awards.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-6">
            <div>
              <div className="text-3xl font-bold text-(--mp-navy) tabular-nums">{fmtMoney(total)}</div>
              <div className="text-xs uppercase tracking-wider text-(--mp-muted)">Across the top {awards.length} awards shown</div>
            </div>
            <ShareButton appearance="public" url={`${SITE_URL}/spending`} title="The latest big federal contracts the government awarded" />
          </div>
        )}
      </section>

      {awards.length === 0 ? (
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-8 text-(--mp-muted)">The feed is being built — check back shortly.</div>
        </section>
      ) : (
        <section className="mx-auto max-w-5xl px-6 pb-10">
          <div className="overflow-hidden rounded-lg border border-(--mp-line) bg-(--mp-surface) divide-y divide-(--mp-line)">
            {awards.map((a) => (
              <a
                key={a.award_id}
                href={`/awards/${encodeURIComponent(a.award_id)}`}
                className="group flex items-center gap-4 px-5 py-4 hover:bg-(--mp-wash) transition-colors"
              >
                <div className="w-28 shrink-0 text-2xl font-bold tabular-nums text-(--mp-navy)">{fmtMoney(a.obligation_amount)}</div>
                <div className="min-w-0 flex-1">
                  {/* Lead with WHAT it's for (real scope), not who got paid. */}
                  <div className="truncate font-semibold text-(--mp-ink)">{contractScope(a)}</div>
                  <div className="truncate text-sm text-(--mp-muted)">
                    {a.awarding_agency}{a.recipient_name ? ` · to ${fmtName(a.recipient_name)}` : ''}
                  </div>
                </div>
                <div className="hidden sm:block shrink-0 text-right text-xs text-(--mp-muted)">
                  <div>{fmtDate(a.action_date)}</div>
                  {a.recipient_state && <div className="mt-0.5">{a.recipient_state}</div>}
                  <span className="mt-1 inline-block font-semibold text-(--mp-navy) group-hover:text-(--mp-navy-hover)">Official record →</span>
                </div>
              </a>
            ))}
          </div>
          <p className="mt-4 text-xs text-(--mp-muted)">
            Source: USAspending.gov. The most recent large federal obligations, refreshed weekly (award data lags
            reporting by a few weeks). Click any row for the official contract record and recipient.
          </p>
        </section>
      )}

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="rounded-lg border border-(--mp-line) p-8 text-center bg-(--mp-wash)">
          <h2 className="text-2xl font-bold font-(family-name:--mp-font-serif)">The government spends $750B a year. Mindy finds the piece you can win.</h2>
          <p className="mt-3 mb-6 max-w-2xl mx-auto text-(--mp-body)">
            Track every contract, know the incumbent, and get the ones that fit your business. Start free.
          </p>
          <Link href="/signup" className="inline-flex rounded-lg bg-(--mp-navy) px-6 py-3 font-semibold text-white hover:bg-(--mp-navy-hover)">
            Start free →
          </Link>
        </div>
      </section>
    </main>
  );
}

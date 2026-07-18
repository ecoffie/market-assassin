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
      item: { '@type': 'GovernmentService', name: `${fmtMoney(a.obligation_amount)} — ${fmtName(a.recipient_name || '')}`, url: `https://www.usaspending.gov/award/${a.award_id}` },
    })),
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-5xl px-6 pt-6 text-sm text-slate-400">
        <Link href="/" className="hover:text-purple-400">Home</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-300">Government Spending</span>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-6 pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400">Discover · Refreshed weekly</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight">The latest big federal contracts</h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300">
          The biggest federal contracts the government has awarded recently — who got paid, how much, and for what.
          Every figure is real and verifiable. Click any to see the official record.
        </p>
        {awards.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-6">
            <div>
              <div className="text-3xl font-extrabold text-purple-300 tabular-nums">{fmtMoney(total)}</div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Across the top {awards.length} awards shown</div>
            </div>
            <ShareButton url={`${SITE_URL}/spending`} title="The latest big federal contracts the government awarded" />
          </div>
        )}
      </section>

      {awards.length === 0 ? (
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-slate-400">The feed is being built — check back shortly.</div>
        </section>
      ) : (
        <section className="mx-auto max-w-5xl px-6 pb-10">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 divide-y divide-slate-800">
            {awards.map((a) => (
              <a
                key={a.award_id}
                href={`https://www.usaspending.gov/award/${a.award_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 px-5 py-4 hover:bg-slate-800/50 transition-colors"
              >
                <div className="w-28 shrink-0 text-2xl font-extrabold tabular-nums text-purple-300">{fmtMoney(a.obligation_amount)}</div>
                <div className="min-w-0 flex-1">
                  {/* Lead with WHAT it's for (real scope), not who got paid. */}
                  <div className="truncate font-semibold text-white">{contractScope(a)}</div>
                  <div className="truncate text-sm text-slate-400">
                    {a.awarding_agency}{a.recipient_name ? ` · to ${fmtName(a.recipient_name)}` : ''}
                  </div>
                </div>
                <div className="hidden sm:block shrink-0 text-right text-xs text-slate-500">
                  <div>{fmtDate(a.action_date)}</div>
                  {a.recipient_state && <div className="mt-0.5">{a.recipient_state}</div>}
                  <span className="mt-1 inline-block font-semibold text-purple-400 group-hover:text-purple-300">Official record →</span>
                </div>
              </a>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Source: USAspending.gov. The most recent large federal obligations, refreshed weekly (award data lags
            reporting by a few weeks). Click any row for the official contract record and recipient.
          </p>
        </section>
      )}

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/40 to-slate-900 p-8 text-center">
          <h2 className="text-2xl font-bold">The government spends $750B a year. Mindy finds the piece you can win.</h2>
          <p className="mt-3 mb-6 max-w-2xl mx-auto text-slate-300">
            Track every contract, know the incumbent, and get the ones that fit your business. Start free.
          </p>
          <Link href="/signup" className="inline-flex rounded-xl bg-purple-600 px-6 py-3 font-semibold text-white hover:bg-purple-500 shadow-lg shadow-purple-500/20">
            Start free →
          </Link>
        </div>
      </section>
    </main>
  );
}

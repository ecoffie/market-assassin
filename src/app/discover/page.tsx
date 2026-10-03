/**
 * /discover — the Discover hub. The front door to Mindy's free, public, shareable federal
 * data: This Week in Government Spending, Weird Awards, and the Top Contractor leaderboards.
 * Data-as-content (operating thesis). Pulls cheap live previews from Supabase; SEO + shareable.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import ShareButton from '@/components/ShareButton';
import { getRecentBigAwards } from '@/lib/discover/recent-spending';
import { getWeirdAwards, WEIRD_TERMS } from '@/lib/discover/weird-awards';
import { queryExpiringContracts, type ExpiringContract } from '@/lib/recompete/query';
import { contractScope } from '@/lib/discover/scope';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';

const SITE_URL = 'https://getmindy.ai';
export const revalidate = 86400;

const EMOJI = new Map(WEIRD_TERMS.map((t) => [t.hook, t.emoji]));

const TOP_LISTS: Array<{ slug: string; label: string }> = [
  { slug: 'sdvosb-contractors', label: 'SDVOSB (veteran)' },
  { slug: '8a-contractors', label: '8(a)' },
  { slug: 'hubzone-contractors', label: 'HUBZone' },
  { slug: 'defense-contractors', label: 'Defense' },
  { slug: 'va-contractors', label: 'VA' },
  { slug: 'dhs-contractors', label: 'DHS' },
  { slug: 'government-contractors', label: 'All government' },
];

export const metadata: Metadata = {
  title: 'Discover — The Federal Market, Decoded | Mindy',
  description:
    'Free, public, shareable data on where the U.S. government spends its money: the biggest contracts this week, the weirdest awards, and the top federal contractors ranked. Straight from USASpending.',
  alternates: { canonical: `${SITE_URL}/discover` },
  openGraph: {
    title: 'Discover — The Federal Market, Decoded',
    description: 'Where the government spends its money — the biggest contracts, the weirdest awards, the top contractors. Free and verifiable.',
    url: `${SITE_URL}/discover`,
    type: 'website',
    siteName: 'Mindy',
  },
  twitter: { card: 'summary_large_image', title: 'Discover — The Federal Market, Decoded', description: 'Where the government spends its money. Free, verifiable, shareable.' },
};

export default async function DiscoverHub() {
  const [spending, weird, expiring] = await Promise.all([
    getRecentBigAwards(4).catch(() => []),
    getWeirdAwards(4).catch(() => []),
    queryExpiringContracts({ monthsWindow: 12, minValue: 10_000_000, limit: 60 })
      .then((r) => r.contracts)
      .catch(() => [] as ExpiringContract[]),
  ]);
  const upForGrabs = [...expiring]
    .sort((a, b) => Number(b.potential_total_value ?? b.total_obligation ?? 0) - Number(a.potential_total_value ?? a.total_obligation ?? 0))
    .slice(0, 4);

  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <div className="mx-auto max-w-6xl px-6 pt-6 text-sm text-(--mp-muted)">
        <Link href="/" className="hover:text-(--mp-navy-hover)">Home</Link>
        <span className="mx-2">/</span>
        <span className="text-(--mp-body)">Discover</span>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-6 pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--mp-navy)">Discover · Free &amp; public</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight font-(family-name:--mp-font-serif)">The federal market, decoded</h1>
        <p className="mt-4 max-w-2xl text-lg text-(--mp-body)">
          Where the U.S. government actually spends its money — the biggest contracts, the weirdest awards, and
          the top contractors ranked. Real, verifiable, and built to be shared.
        </p>
        <div className="mt-5"><ShareButton appearance="public" url={`${SITE_URL}/discover`} title="The federal market, decoded — where the government spends its money" /></div>
      </section>

      {/* Up For Grabs — the freshest, forward-looking feed (the proven teaser format) */}
      <section className="mx-auto max-w-6xl px-6 pb-5">
        <Link href="/up-for-grabs" className="group block rounded-lg border border-(--mp-line) p-6 hover:border-(--mp-navy) transition-colors bg-(--mp-wash)">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold font-(family-name:--mp-font-serif)">⏳ Up For Grabs — contracts expiring soon</h2>
            <span className="text-xs font-semibold text-(--mp-navy) group-hover:text-(--mp-navy-hover)">Open →</span>
          </div>
          <p className="mt-2 text-sm text-(--mp-muted)">The government has to re-buy this work — here&apos;s the biggest coming up for grabs, with the incumbent and when.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {upForGrabs.length === 0 ? (
              <div className="text-sm text-(--mp-muted)">Updating…</div>
            ) : upForGrabs.map((c) => (
              <div key={c.contract_id} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 font-bold tabular-nums text-(--mp-navy)">{fmtMoney(Number(c.potential_total_value ?? c.total_obligation ?? 0))}</span>
                <span className="min-w-0 flex-1 truncate text-(--mp-body)">{contractScope(c)}</span>
              </div>
            ))}
          </div>
        </Link>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 pb-10 grid gap-5 lg:grid-cols-2">
        {/* This Week in Government Spending */}
        <Link href="/spending" className="group flex flex-col rounded-lg border border-(--mp-line) bg-(--mp-surface) p-6 hover:border-(--mp-navy) transition-colors">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold font-(family-name:--mp-font-serif)">💸 The Latest Big Contracts</h2>
            <span className="text-xs font-semibold text-(--mp-navy) group-hover:text-(--mp-navy-hover)">Open →</span>
          </div>
          <p className="mt-2 text-sm text-(--mp-muted)">The biggest federal contracts the government awarded recently.</p>
          <div className="mt-4 space-y-2">
            {spending.length === 0 ? (
              <div className="text-sm text-(--mp-muted)">Updating…</div>
            ) : spending.map((a) => (
              <div key={a.award_id} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 font-bold tabular-nums text-(--mp-navy)">{fmtMoney(a.obligation_amount)}</span>
                <span className="min-w-0 flex-1 truncate text-(--mp-body)">{contractScope(a)}</span>
              </div>
            ))}
          </div>
        </Link>

        {/* Weird Awards */}
        <Link href="/weird" className="group flex flex-col rounded-lg border border-(--mp-line) bg-(--mp-surface) p-6 hover:border-(--mp-navy) transition-colors">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold font-(family-name:--mp-font-serif)">🧐 Weird Awards</h2>
            <span className="text-xs font-semibold text-(--mp-navy) group-hover:text-(--mp-navy-hover)">Open →</span>
          </div>
          <p className="mt-2 text-sm text-(--mp-muted)">Real federal contracts for the strangest things — your tax dollars at work.</p>
          <div className="mt-4 space-y-2">
            {weird.length === 0 ? (
              <div className="text-sm text-(--mp-muted)">Updating…</div>
            ) : weird.map((a) => (
              <div key={a.award_id} className="flex items-center gap-3 text-sm">
                <span className="text-lg">{EMOJI.get(a.category ?? '') ?? '🎪'}</span>
                <span className="w-20 shrink-0 font-bold tabular-nums text-(--mp-navy)">{fmtMoney(a.obligation_amount)}</span>
                <span className="min-w-0 flex-1 truncate text-(--mp-body)">on {a.category}</span>
              </div>
            ))}
          </div>
        </Link>
      </section>

      {/* Top Contractor Leaderboards */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold font-(family-name:--mp-font-serif)">🏆 Top Contractor Leaderboards</h2>
            <Link href="/top" className="text-xs font-semibold text-(--mp-navy) hover:text-(--mp-navy-hover)">All lists →</Link>
          </div>
          <p className="mt-2 text-sm text-(--mp-muted)">The biggest federal contractors, ranked by obligated dollars — by set-aside, agency, and state.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {TOP_LISTS.map((l) => (
              <Link
                key={l.slug}
                href={`/top/${l.slug}`}
                className="rounded-lg border border-(--mp-line) bg-(--mp-paper) px-4 py-2 text-sm font-medium text-(--mp-ink) hover:border-(--mp-navy) hover:text-(--mp-ink) transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="rounded-lg border border-(--mp-line) p-8 text-center bg-(--mp-wash)">
          <h2 className="text-2xl font-bold font-(family-name:--mp-font-serif)">This is the free stuff. The real edge is knowing what <em>you</em> can win.</h2>
          <p className="mt-3 mb-6 max-w-2xl mx-auto text-(--mp-body)">
            Mindy scores every opportunity to your business, tells you the incumbent, and finds the contracts
            worth bidding. Start free.
          </p>
          <Link href="/signup" className="inline-flex rounded-lg bg-(--mp-navy) px-6 py-3 font-semibold text-white hover:bg-(--mp-navy-hover)">
            Start free →
          </Link>
        </div>
      </section>
    </main>
  );
}

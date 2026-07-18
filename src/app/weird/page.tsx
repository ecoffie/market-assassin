/**
 * /weird — the Weird Awards Discover feed. Real, curious federal purchases; every card
 * links to the official /awards/[id] record (the proof). Public, shareable, SEO. Reads
 * cheap from Supabase (built monthly by /api/cron/build-weird-awards). Grounded, never faked.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import ShareButton from '@/components/ShareButton';
import { getWeirdAwards, WEIRD_TERMS } from '@/lib/discover/weird-awards';
import { formatCompanyName as fmtName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';

const SITE_URL = 'https://getmindy.ai';
export const revalidate = 86400; // 1d; the monthly build cron also revalidatePath()s this

const EMOJI = new Map(WEIRD_TERMS.map((t) => [t.hook, t.emoji]));

export const metadata: Metadata = {
  title: 'Weird Federal Awards — What the Government Actually Bought | Mindy',
  description:
    'Real, verifiable federal contracts for the strangest things — petting zoos, dunk tanks, bagpipes, mechanical bulls. Your tax dollars at work, straight from USASpending.',
  alternates: { canonical: `${SITE_URL}/weird` },
  openGraph: {
    title: 'Weird Federal Awards — What the Government Actually Bought',
    description: 'Real federal contracts for the strangest things. Every one verifiable. Your tax dollars at work.',
    url: `${SITE_URL}/weird`,
    type: 'website',
    siteName: 'Mindy',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Weird Federal Awards — What the Government Actually Bought',
    description: 'Real federal contracts for the strangest things. Every one verifiable.',
  },
};

export default async function WeirdAwardsPage() {
  const awards = await getWeirdAwards(40).catch(() => []);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Weird Federal Awards',
    description: 'Real, verifiable federal contracts for surprising things.',
    numberOfItems: awards.length,
    itemListElement: awards.slice(0, 25).map((a, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: { '@type': 'GovernmentService', name: `${fmtMoney(a.obligation_amount)} — ${a.category}`, url: `${SITE_URL}/awards/${a.award_id}` },
    })),
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-6xl px-6 pt-6 text-sm text-slate-400">
        <Link href="/" className="hover:text-purple-400">Home</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-300">Weird Awards</span>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-6 pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400">Discover · Weird Awards</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight">🧐 Your tax dollars at work</h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300">
          Real federal contracts for the strangest things the government actually paid for — every one
          verifiable, straight from USASpending. Click any card to see the official record.
        </p>
        <div className="mt-5"><ShareButton url={`${SITE_URL}/weird`} title="Weird Federal Awards — what the government actually bought" /></div>
      </section>

      {awards.length === 0 ? (
        <section className="mx-auto max-w-6xl px-6 pb-16">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-slate-400">
            The feed is being built — check back shortly.
          </div>
        </section>
      ) : (
        <section className="mx-auto max-w-6xl px-6 pb-10">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {awards.map((a) => (
              <Link
                key={a.award_id}
                href={`/awards/${a.award_id}`}
                className="group flex flex-col rounded-2xl border border-slate-800 bg-slate-900 p-5 hover:border-purple-500/50 hover:bg-slate-800/60 transition-colors"
              >
                <div className="text-3xl">{EMOJI.get(a.category ?? '') ?? '🎪'}</div>
                <div className="mt-3 text-3xl font-extrabold tracking-tight text-purple-300 tabular-nums">
                  {fmtMoney(a.obligation_amount)}
                </div>
                <div className="mt-1 text-lg font-semibold text-white">on {a.category}</div>
                {a.description && (
                  <p className="mt-3 text-xs text-slate-400 line-clamp-3">{a.description}</p>
                )}
                <div className="mt-auto pt-4 text-xs text-slate-500">
                  <div className="truncate">{a.awarding_agency}</div>
                  <div className="mt-0.5 truncate">
                    {fmtName(a.recipient_name || '')}{a.recipient_state ? ` · ${a.recipient_state}` : ''}
                  </div>
                  <span className="mt-2 inline-block font-semibold text-purple-400 group-hover:text-purple-300">
                    See the receipt →
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <p className="mt-6 text-xs text-slate-500">
            Source: USAspending.gov. Every award shown is a real federal obligation — click any card for the
            official contract record, including the contract number and recipient.
          </p>
        </section>
      )}

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/40 to-slate-900 p-8 text-center">
          <h2 className="text-2xl font-bold">The government buys everything — from bagpipes to $1.8B IT contracts.</h2>
          <p className="mt-3 mb-6 max-w-2xl mx-auto text-slate-300">
            Mindy tracks all of it, and finds the contracts you can actually win. Start free.
          </p>
          <Link href="/signup" className="inline-flex rounded-xl bg-purple-600 px-6 py-3 font-semibold text-white hover:bg-purple-500 shadow-lg shadow-purple-500/20">
            Start free →
          </Link>
        </div>
      </section>
    </main>
  );
}

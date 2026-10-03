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
      item: { '@type': 'GovernmentService', name: `${fmtMoney(a.obligation_amount)} — ${a.category}`, url: `https://www.usaspending.gov/award/${a.award_id}` },
    })),
  };

  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-6xl px-6 pt-6 text-sm text-(--mp-muted)">
        <Link href="/" className="hover:text-(--mp-navy-hover)">Home</Link>
        <span className="mx-2">/</span>
        <span className="text-(--mp-body)">Weird Awards</span>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-6 pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--mp-accent)">Discover · Weird Awards</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight font-(family-name:--mp-font-serif)">🧐 Your tax dollars at work</h1>
        <p className="mt-4 max-w-2xl text-lg text-(--mp-body)">
          Real federal contracts for the strangest things the government actually paid for — every one
          verifiable, straight from USASpending. Click any card to see the official record.
        </p>
        <div className="mt-5"><ShareButton appearance="public" url={`${SITE_URL}/weird`} title="Weird Federal Awards — what the government actually bought" /></div>
      </section>

      {awards.length === 0 ? (
        <section className="mx-auto max-w-6xl px-6 pb-16">
          <div className="rounded-none border border-(--mp-line) bg-(--mp-surface) p-8 text-(--mp-muted)">
            The feed is being built — check back shortly.
          </div>
        </section>
      ) : (
        <section className="mx-auto max-w-6xl px-6 pb-10">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {awards.map((a) => (
              <a
                key={a.award_id}
                href={`https://www.usaspending.gov/award/${a.award_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col rounded-none border border-(--mp-line) bg-(--mp-surface) p-5 hover:border-(--mp-navy) hover:bg-(--mp-wash) transition-colors"
              >
                <div className="text-3xl">{EMOJI.get(a.category ?? '') ?? '🎪'}</div>
                <div className="mt-3 text-3xl font-semibold font-(family-name:--mp-font-mono) tracking-tight text-(--mp-ink) tabular-nums">
                  {fmtMoney(a.obligation_amount)}
                </div>
                <div className="mt-1 text-lg font-semibold text-(--mp-ink)">on {a.category}</div>
                {a.description && (
                  <p className="mt-3 text-xs text-(--mp-muted) line-clamp-3">{a.description}</p>
                )}
                <div className="mt-auto pt-4 text-xs text-(--mp-muted)">
                  <div className="truncate">{a.awarding_agency}</div>
                  <div className="mt-0.5 truncate">
                    {fmtName(a.recipient_name || '')}{a.recipient_state ? ` · ${a.recipient_state}` : ''}
                  </div>
                  <span className="mt-2 inline-block font-semibold text-(--mp-navy) group-hover:text-(--mp-navy-hover)">
                    See the receipt →
                  </span>
                </div>
              </a>
            ))}
          </div>

          <p className="mt-6 text-xs text-(--mp-muted)">
            Source: USAspending.gov. Every award shown is a real federal obligation — click any card for the
            official contract record, including the contract number and recipient.
          </p>
        </section>
      )}

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="rounded-none border border-(--mp-line) p-8 text-center bg-(--mp-wash)">
          <h2 className="text-2xl font-bold font-(family-name:--mp-font-serif)">The government buys everything — from bagpipes to $1.8B IT contracts.</h2>
          <p className="mt-3 mb-6 max-w-2xl mx-auto text-(--mp-body)">
            Mindy tracks all of it, and finds the contracts you can actually win. Start free.
          </p>
          <Link href="/signup" className="inline-flex rounded-none bg-(--mp-navy) px-6 py-3 font-semibold text-white hover:bg-(--mp-navy-hover)">
            Start free →
          </Link>
        </div>
      </section>
    </main>
  );
}

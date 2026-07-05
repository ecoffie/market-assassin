/**
 * /lifetime — Mindy Founders Lifetime ($4,997) sales page.
 *
 * Single price: $4,997 (100 seats) — same WTP as legacy course lifetime.
 * The $2,997 bootcamp-alumni discount was discontinued 2026-07-05.
 * Ultimate Giant Bundle ($1,497) is retired.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import FoundersSeats from '@/components/lifetime/FoundersSeats';
import {
  FOUNDERS_LIFETIME_CAP,
  FOUNDERS_LIFETIME_PRICE,
  PRO_ANNUAL,
  PRO_MONTHLY,
  foundersBreakEvenMonths,
} from '@/lib/mindy/lifetime-pricing';

// Re-evaluate the date gate on every request so the special auto-expires.
export const dynamic = 'force-dynamic';

const FOUNDERS_CHECKOUT = '/checkout/founders-lifetime';
const BOOTCAMP_CHECKOUT = '/checkout/bootcamp-lifetime';
const MONTHLY_CHECKOUT = 'https://buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C';
const ANNUAL_CHECKOUT = 'https://buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D';

const breakEvenMonths = foundersBreakEvenMonths();

export const metadata: Metadata = {
  title: 'Mindy Founders Lifetime — $4,997 once, federal intelligence forever',
  description:
    'Join the first 100 founding members. $4,997 one-time for lifetime Mindy Pro — daily briefings, recompete alerts, and every future feature. Same price as our legacy course lifetime.',
  alternates: { canonical: 'https://getmindy.ai/lifetime' },
  openGraph: {
    title: 'Mindy Founders Lifetime — Buy once, use forever',
    description: `$4,997 one-time. Limited to ${FOUNDERS_LIFETIME_CAP} founding members. Full Pro access forever.`,
    type: 'website',
    url: 'https://getmindy.ai/lifetime',
  },
};

const proFeatures = [
  'AI-matched daily opportunity briefings',
  'Unlimited NAICS codes',
  'Competitor & incumbent tracking',
  'Recompete alerts 12 months out',
  '7,600+ agency forecasts (full access)',
  'Weekly market deep dives',
  'Pursuit briefs on demand',
  'Pipeline + teaming workspace',
  'Proposal Assist + Pricing Intel',
  'Federal Contractor Database',
  'Priority email support (24hr)',
  'Every future Mindy feature, included',
];

const founderPerks = [
  'Founding Member badge in Mindy',
  'Locked lifetime rate — never pay again',
  'Priority onboarding during launch window',
  'One of only 100 founding seats',
];

const faqs: Array<{ q: string; a: string }> = [
  {
    q: 'Why $4,997?',
    a: `That's what lifetime course access cost before Mindy existed — and Mindy delivers far more (daily AI briefings, live federal data, full Pro platform). At $${PRO_MONTHLY}/mo you'd break even in about ${breakEvenMonths} months; most serious contractors stay longer.`,
  },
  {
    q: 'Is this really lifetime?',
    a: 'Yes. One payment, no renewals, no expiration. Your access stays active as long as Mindy exists.',
  },
  {
    q: 'What happens after 100 founders?',
    a: 'Founders Lifetime closes. New buyers choose Pro at $149/mo or $1,490/yr — unless we reopen lifetime at a higher price later.',
  },
  {
    q: 'What about refunds?',
    a: '30-day money-back guarantee. Email hello@getmindy.ai within 30 days if Mindy is not earning her keep.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Product',
      name: 'Mindy Founders Lifetime',
      description: 'Lifetime access to Mindy Pro for founding members. Capped at 100 seats.',
      brand: { '@type': 'Brand', name: 'Mindy' },
      offers: {
        '@type': 'Offer',
        price: String(FOUNDERS_LIFETIME_PRICE),
        priceCurrency: 'USD',
        availability: 'https://schema.org/LimitedAvailability',
        url: 'https://getmindy.ai/lifetime',
      },
    },
    {
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
};

function CheckIcon({ highlighted = false }: { highlighted?: boolean }) {
  return (
    <svg
      className={`w-5 h-5 shrink-0 mt-0.5 ${highlighted ? 'text-emerald-400' : 'text-purple-400'}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export default function LifetimePage() {
  const fiveYearMonthly = PRO_MONTHLY * 12 * 5;
  const fiveYearAnnual = PRO_ANNUAL * 5;

  // The $2,997 bootcamp "special" is DISCONTINUED (Eric, 2026-07-05) — the price
  // is now a single $4,997 Founders Lifetime. Force special off so the whole page
  // renders the Founders path; the dual-price branches below all fall through.
  const special = false;
  const checkoutHref = FOUNDERS_CHECKOUT;
  const livePrice = FOUNDERS_LIFETIME_PRICE;

  return (
    <main className="min-h-screen bg-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/40 rounded-full mb-6">
            <span className="text-amber-200 text-sm font-semibold uppercase tracking-wide">
              {`Founders Lifetime · ${FOUNDERS_LIFETIME_CAP} seats`}
            </span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight">
            Join the first {FOUNDERS_LIFETIME_CAP}.<br />
            <span className="text-emerald-400">Own Mindy forever.</span>
          </h1>

          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-4">
            One payment of{' '}
            {special && (
              <span className="text-slate-500 line-through mr-1">${fmt(FOUNDERS_LIFETIME_PRICE)}</span>
            )}
            <span className="text-white font-semibold">${fmt(livePrice)}</span>.{' '}
            {special
              ? 'Full Pro access for life — Mindy Day pricing, today only.'
              : 'Full Pro access for life — the same lifetime price our course buyers already trusted.'}
          </p>
          <p className="text-slate-400 text-sm mb-10">
            Serious federal intelligence. Not a discount tool — a founding seat in the platform.
          </p>

          <FoundersSeats />

          <Link
            href={checkoutHref}
            className="inline-block bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-bold text-lg px-10 py-4 rounded-xl shadow-xl shadow-emerald-500/25 transition-colors"
          >
            {special
              ? `Claim your lifetime seat — $${fmt(livePrice)} →`
              : `Become a Founding Member — $${fmt(FOUNDERS_LIFETIME_PRICE)} →`}
          </Link>
          <p className="text-slate-400 text-sm mt-4">30-day money back · One-time payment</p>
        </div>
      </section>

      <section className="px-4 py-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-12">
            The math at ${fmt(livePrice)}
          </h2>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-slate-400 uppercase mb-3">Monthly Pro</h3>
              <p className="text-4xl font-black text-white">${PRO_MONTHLY}<span className="text-lg text-slate-400">/mo</span></p>
              <ul className="mt-4 space-y-2 text-sm text-slate-300 border-t border-slate-800 pt-4">
                <li>5 years: <span className="text-white">${fmt(fiveYearMonthly)}</span></li>
                <li>10 years: <span className="text-white">${fmt(PRO_MONTHLY * 120)}</span></li>
              </ul>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-slate-400 uppercase mb-3">Annual Pro</h3>
              <p className="text-4xl font-black text-white">${fmt(PRO_ANNUAL)}<span className="text-lg text-slate-400">/yr</span></p>
              <ul className="mt-4 space-y-2 text-sm text-slate-300 border-t border-slate-800 pt-4">
                <li>5 years: <span className="text-white">${fmt(fiveYearAnnual)}</span></li>
                <li>10 years: <span className="text-white">${fmt(PRO_ANNUAL * 10)}</span></li>
              </ul>
            </div>

            <div className="bg-gradient-to-br from-emerald-900/40 to-slate-900 border-2 border-emerald-500 rounded-2xl p-6 relative shadow-xl shadow-emerald-500/10">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-emerald-500 text-slate-950 text-xs font-bold px-4 py-1 rounded-full">
                  {special ? 'MINDY DAY' : 'FOUNDERS'}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-emerald-300 uppercase mb-3">Lifetime</h3>
              <p className="text-4xl font-black text-white">
                {special && (
                  <span className="text-2xl text-slate-500 line-through mr-2">${fmt(FOUNDERS_LIFETIME_PRICE)}</span>
                )}
                ${fmt(livePrice)}<span className="text-lg text-slate-400"> once</span>
              </p>
              <ul className="mt-4 space-y-2 text-sm text-slate-200 border-t border-emerald-500/30 pt-4">
                <li>Break-even: <span className="text-emerald-300 font-semibold">~{Math.ceil(livePrice / PRO_MONTHLY)} months</span> vs monthly</li>
                <li>5-year savings: <span className="text-emerald-300 font-semibold">${fmt(fiveYearMonthly - livePrice)}+</span></li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-900/40 px-4 py-20">
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold text-white mb-6">Everything in Pro. Forever.</h2>
            <div className="space-y-3">
              {proFeatures.map((f) => (
                <div key={f} className="flex items-start gap-3 text-slate-200 text-sm">
                  <CheckIcon highlighted />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white mb-6">Founding member perks</h2>
            <div className="space-y-3">
              {founderPerks.map((f) => (
                <div key={f} className="flex items-start gap-3 text-slate-200 text-sm">
                  <CheckIcon />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-16">
        <div className="max-w-3xl mx-auto space-y-6 text-slate-300 text-lg leading-relaxed">
          <h2 className="text-3xl font-bold text-white text-center mb-8">Why $4,997</h2>
          <p>
            People paid $4,997 for lifetime access to our courses — videos and community, no daily AI,
            no live federal data. Mindy is the product now. One platform, one price, one decision.
          </p>
          <p>
            Founders Lifetime is capped at {FOUNDERS_LIFETIME_CAP} because I want a small group of
            believers who help shape what Mindy becomes — not an unlimited discount that kills the
            recurring business we are building.
          </p>
          <p className="text-white font-semibold">— Eric Coffie, founder</p>
        </div>
      </section>

      <section className="bg-slate-900/40 px-4 py-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-10">Questions</h2>
          <div className="space-y-3">
            {faqs.map((f) => (
              <details
                key={f.q}
                className="group bg-slate-900 border border-slate-800 rounded-xl px-6 py-4"
              >
                <summary className="cursor-pointer list-none flex justify-between gap-4 text-white font-semibold">
                  <span>{f.q}</span>
                  <span className="text-emerald-400 group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-4 text-slate-300">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-20">
        <div className="max-w-3xl mx-auto text-center rounded-3xl border border-purple-500/30 bg-gradient-to-br from-purple-900/40 to-slate-900 p-10">
          <h2 className="text-3xl font-bold text-white mb-4">
            {`$${fmt(FOUNDERS_LIFETIME_PRICE)} once. ${FOUNDERS_LIFETIME_CAP} seats.`}
          </h2>
          <Link
            href={checkoutHref}
            className="inline-block mt-6 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-lg px-10 py-4 rounded-xl"
          >
            {special ? `Claim your lifetime seat — $${fmt(livePrice)} →` : 'Claim Founders Lifetime →'}
          </Link>
          <p className="mt-6 text-sm text-slate-400">
            Not ready?{' '}
            <Link href={MONTHLY_CHECKOUT} className="text-purple-300 hover:underline">
              Pro at ${PRO_MONTHLY}/mo
            </Link>{' '}
            or{' '}
            <Link href={ANNUAL_CHECKOUT} className="text-purple-300 hover:underline">
              ${fmt(PRO_ANNUAL)}/yr
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

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
  '33,000+ agency forecasts (full access)',
  'Weekly market deep dives',
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
      className={`w-5 h-5 shrink-0 mt-0.5 text-(--mp-navy)`}
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
    <main className="bg-(--mp-paper)">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="py-20 px-4 bg-(--mp-wash)">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-(--mp-surface) border border-(--mp-line) rounded-[6px] mb-6">
            <span className="text-(--mp-accent) text-sm font-semibold uppercase tracking-wide">
              {`Founders Lifetime · ${FOUNDERS_LIFETIME_CAP} seats`}
            </span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-(--mp-ink) mb-6 leading-tight font-(family-name:--mp-font-serif)">
            Join the first {FOUNDERS_LIFETIME_CAP}.<br />
            <span className="text-(--mp-accent)">Own Mindy forever.</span>
          </h1>

          <p className="text-xl text-(--mp-body) max-w-2xl mx-auto mb-4">
            One payment of{' '}
            {special && (
              <span className="text-(--mp-muted) line-through mr-1">${fmt(FOUNDERS_LIFETIME_PRICE)}</span>
            )}
            <span className="text-(--mp-ink) font-semibold">${fmt(livePrice)}</span>.{' '}
            {special
              ? 'Full Pro access for life — Mindy Day pricing, today only.'
              : 'Full Pro access for life — the same lifetime price our course buyers already trusted.'}
          </p>
          <p className="text-(--mp-muted) text-sm mb-10">
            Serious federal intelligence. Not a discount tool — a founding seat in the platform.
          </p>

          <FoundersSeats />

          <Link
            href={checkoutHref}
            className="inline-block hover:bg-(--mp-navy-hover) text-white font-bold text-lg px-10 py-4 rounded-none transition-colors bg-(--mp-navy)"
          >
            {special
              ? `Claim your lifetime seat — $${fmt(livePrice)} →`
              : `Become a Founding Member — $${fmt(FOUNDERS_LIFETIME_PRICE)} →`}
          </Link>
          <p className="text-(--mp-muted) text-sm mt-4">30-day money back · One-time payment</p>
        </div>
      </section>

      <section className="px-4 py-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-(--mp-ink) text-center mb-12 font-(family-name:--mp-font-serif)">
            The math at ${fmt(livePrice)}
          </h2>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-(--mp-surface) border border-(--mp-line) rounded-none p-6">
              <h3 className="text-sm font-semibold text-(--mp-muted) uppercase mb-3">Monthly Pro</h3>
              <p className="font-(family-name:--mp-font-mono) text-4xl font-semibold text-(--mp-ink)">${PRO_MONTHLY}<span className="text-lg text-(--mp-muted)">/mo</span></p>
              <ul className="mt-4 space-y-2 text-sm text-(--mp-body) border-t border-(--mp-line) pt-4">
                <li>5 years: <span className="text-(--mp-ink)">${fmt(fiveYearMonthly)}</span></li>
                <li>10 years: <span className="text-(--mp-ink)">${fmt(PRO_MONTHLY * 120)}</span></li>
              </ul>
            </div>

            <div className="bg-(--mp-surface) border border-(--mp-line) rounded-none p-6">
              <h3 className="text-sm font-semibold text-(--mp-muted) uppercase mb-3">Annual Pro</h3>
              <p className="font-(family-name:--mp-font-mono) text-4xl font-semibold text-(--mp-ink)">${fmt(PRO_ANNUAL)}<span className="text-lg text-(--mp-muted)">/yr</span></p>
              <ul className="mt-4 space-y-2 text-sm text-(--mp-body) border-t border-(--mp-line) pt-4">
                <li>5 years: <span className="text-(--mp-ink)">${fmt(fiveYearAnnual)}</span></li>
                <li>10 years: <span className="text-(--mp-ink)">${fmt(PRO_ANNUAL * 10)}</span></li>
              </ul>
            </div>

            <div className="border-2 border-(--mp-navy) rounded-none p-6 relative bg-(--mp-surface)">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-(--mp-navy) text-white text-xs font-bold px-4 py-1 rounded-[6px]">
                  {special ? 'MINDY DAY' : 'FOUNDERS'}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-(--mp-navy) uppercase mb-3">Lifetime</h3>
              <p className="font-(family-name:--mp-font-mono) text-4xl font-semibold text-(--mp-ink)">
                {special && (
                  <span className="text-2xl text-(--mp-muted) line-through mr-2">${fmt(FOUNDERS_LIFETIME_PRICE)}</span>
                )}
                ${fmt(livePrice)}<span className="text-lg text-(--mp-muted)"> once</span>
              </p>
              <ul className="mt-4 space-y-2 text-sm text-(--mp-ink) border-t border-(--mp-line) pt-4">
                <li>Break-even: <span className="text-(--mp-ink) font-semibold font-(family-name:--mp-font-mono)">~{Math.ceil(livePrice / PRO_MONTHLY)} months</span> vs monthly</li>
                <li>5-year savings: <span className="text-(--mp-ink) font-semibold font-(family-name:--mp-font-mono)">${fmt(fiveYearMonthly - livePrice)}+</span></li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-(--mp-wash) px-4 py-20">
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold text-(--mp-ink) mb-6 font-(family-name:--mp-font-serif)">Everything in Pro. Forever.</h2>
            <div className="space-y-3">
              {proFeatures.map((f) => (
                <div key={f} className="flex items-start gap-3 text-(--mp-ink) text-sm">
                  <CheckIcon highlighted />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-(--mp-ink) mb-6 font-(family-name:--mp-font-serif)">Founding member perks</h2>
            <div className="space-y-3">
              {founderPerks.map((f) => (
                <div key={f} className="flex items-start gap-3 text-(--mp-ink) text-sm">
                  <CheckIcon />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-16">
        <div className="max-w-3xl mx-auto space-y-6 text-(--mp-body) text-lg leading-relaxed">
          <h2 className="text-3xl font-bold text-(--mp-ink) text-center mb-8 font-(family-name:--mp-font-serif)">Why $4,997</h2>
          <p>
            People paid $4,997 for lifetime access to our courses — videos and community, no daily AI,
            no live federal data. Mindy is the product now. One platform, one price, one decision.
          </p>
          <p>
            Founders Lifetime is capped at {FOUNDERS_LIFETIME_CAP} because I want a small group of
            believers who help shape what Mindy becomes — not an unlimited discount that kills the
            recurring business we are building.
          </p>
          <p className="text-(--mp-ink) font-semibold">— Eric Coffie, founder</p>
        </div>
      </section>

      <section className="bg-(--mp-wash) px-4 py-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-(--mp-ink) text-center mb-10 font-(family-name:--mp-font-serif)">Questions</h2>
          <div className="space-y-3">
            {faqs.map((f) => (
              <details
                key={f.q}
                className="group bg-(--mp-surface) border border-(--mp-line) rounded-none px-6 py-4"
              >
                <summary className="cursor-pointer list-none flex justify-between gap-4 text-(--mp-ink) font-semibold">
                  <span>{f.q}</span>
                  <span className="text-(--mp-navy) group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-4 text-(--mp-body)">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-20">
        <div className="max-w-3xl mx-auto text-center rounded-none border border-(--mp-line) p-10 bg-(--mp-wash)">
          <h2 className="text-3xl font-bold text-(--mp-ink) mb-4 font-(family-name:--mp-font-serif)">
            {`$${fmt(FOUNDERS_LIFETIME_PRICE)} once. ${FOUNDERS_LIFETIME_CAP} seats.`}
          </h2>
          <Link
            href={checkoutHref}
            className="inline-block mt-6 text-white font-bold text-lg px-10 py-4 rounded-none bg-(--mp-navy)"
          >
            {special ? `Claim your lifetime seat — $${fmt(livePrice)} →` : 'Claim Founders Lifetime →'}
          </Link>
          <p className="mt-6 text-sm text-(--mp-muted)">
            Not ready?{' '}
            <Link href={MONTHLY_CHECKOUT} className="text-(--mp-navy) hover:underline">
              Pro at ${PRO_MONTHLY}/mo
            </Link>{' '}
            or{' '}
            <Link href={ANNUAL_CHECKOUT} className="text-(--mp-navy) hover:underline">
              ${fmt(PRO_ANNUAL)}/yr
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

/**
 * /lifetime — Mindy Lifetime ($2,997) sales page.
 *
 * The post-bootcamp standard price for lifetime Mindy access. The
 * $1,497 Ultimate Giant Bundle (shop.govcongiants.com/bundles/ultimate)
 * is the time-boxed bootcamp special — that bundles the full tool
 * suite and closes June 27. After that closes, this page becomes the
 * standing offer for lifetime Mindy alone.
 *
 * Mirrors the /pricing page's structure (server-rendered, no client
 * JS, brand-consistent purple/slate gradient) and routes the CTA
 * through /checkout/mindy-lifetime so purchase attribution + partner
 * referrals + affiliate commissions stay wired the same way the
 * monthly/annual SKUs work.
 *
 * SKU evolution note: the SKU is intentionally simple ($2,997 lifetime)
 * for the post-bootcamp launch; if/when we evolve to founder-cap or
 * 3-year prepay (see SaaS-investor discussion), only the copy +
 * checkout target change. The page structure stays the same.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

const CHECKOUT_URL = '/checkout/mindy-lifetime';
const MONTHLY_CHECKOUT = 'https://buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C';
const ANNUAL_CHECKOUT = 'https://buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D';

export const metadata: Metadata = {
  title: 'Mindy Lifetime — $2,997 once, federal market intelligence forever',
  description:
    'Buy Mindy once for $2,997. Lifetime access to AI-matched briefings, competitor tracking, recompete alerts, and weekly market deep dives. No renewals. No monthly bill.',
  alternates: { canonical: 'https://getmindy.ai/lifetime' },
  openGraph: {
    title: 'Mindy Lifetime — Buy once, use forever',
    description:
      '$2,997 one-time. Lifetime access to every Pro feature, every future update, no renewals. The post-bootcamp standard price.',
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

const faqs: Array<{ q: string; a: string }> = [
  {
    q: 'Is this really lifetime?',
    a: "Yes. One payment of $2,997, no renewals, no expiration. Your access stays active as long as Mindy exists.",
  },
  {
    q: 'What about future features?',
    a: "Included. Every new feature we ship to Mindy Pro lands in your account automatically. Federal contracting changes — Mindy keeps up, and so do you.",
  },
  {
    q: 'What if you raise the price later?',
    a: "Your lifetime price is locked at $2,997. If we ever raise the price for new buyers, you keep yours.",
  },
  {
    q: 'How does this compare to monthly?',
    a: "Mindy Pro is $149/mo or $1,490/yr. At monthly, you'd hit $2,997 in about 20 months. After that, lifetime is free for as long as you keep using it.",
  },
  {
    q: 'What about refunds?',
    a: "30-day money-back guarantee. If Mindy isn't earning her keep in your contracting work in the first month, email hello@getmindy.ai and we'll refund you.",
  },
  {
    q: "Why does this exist instead of just monthly?",
    a: "Some contractors hate recurring bills more than they hate writing one big check. If you know you're going to use Mindy long-term, paying once and being done is the cheaper, simpler move.",
  },
  {
    q: 'Can I transfer it if I sell my company?',
    a: "Yes. Lifetime accounts can transfer to a new owner once. Email hello@getmindy.ai with the transfer details.",
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Product',
      '@id': 'https://getmindy.ai/lifetime#product',
      name: 'Mindy Lifetime',
      description: 'Lifetime access to Mindy — federal market intelligence platform for small business contractors. One-time payment, no renewals, all future features included.',
      brand: { '@type': 'Brand', name: 'Mindy' },
      offers: {
        '@type': 'Offer',
        price: '2997.00',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        url: 'https://getmindy.ai/lifetime',
      },
    },
    {
      '@type': 'FAQPage',
      '@id': 'https://getmindy.ai/lifetime#faq',
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

export default function LifetimePage() {
  return (
    <main className="min-h-screen bg-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-full mb-6">
            <span className="text-emerald-300 text-sm font-semibold uppercase tracking-wide">
              Mindy Lifetime
            </span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight">
            Buy Mindy once.<br />
            <span className="text-emerald-400">Use her forever.</span>
          </h1>

          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-10">
            One payment of <span className="text-white font-semibold">$2,997</span>. No renewals,
            no monthly bill, every future Mindy feature included for as long as Mindy exists.
          </p>

          <div className="inline-flex flex-col items-center">
            <Link
              href={CHECKOUT_URL}
              className="inline-block bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-bold text-lg px-10 py-4 rounded-xl shadow-xl shadow-emerald-500/25 transition-colors"
            >
              Get Lifetime — $2,997 →
            </Link>
            <p className="text-slate-400 text-sm mt-4">
              30-day money back. One-time payment. Lifetime access.
            </p>
          </div>
        </div>
      </section>

      {/* The math */}
      <section className="px-4 py-20 -mt-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            The math is simple
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            If you&apos;re going to use Mindy more than 20 months, lifetime is the cheaper move.
            After that, every month of value is free.
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Monthly */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Monthly</h3>
              <div className="mb-2">
                <span className="text-4xl font-black text-white">$149</span>
                <span className="text-slate-400 ml-1">/mo</span>
              </div>
              <p className="text-slate-400 text-sm mb-4">
                $1,788 first year, every year.
              </p>
              <ul className="space-y-2 text-sm text-slate-300 border-t border-slate-800 pt-4">
                <li>1 year: <span className="text-white">$1,788</span></li>
                <li>3 years: <span className="text-white">$5,364</span></li>
                <li>5 years: <span className="text-white">$8,940</span></li>
                <li>10 years: <span className="text-white">$17,880</span></li>
              </ul>
            </div>

            {/* Annual */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Annual</h3>
              <div className="mb-2">
                <span className="text-4xl font-black text-white">$1,490</span>
                <span className="text-slate-400 ml-1">/yr</span>
              </div>
              <p className="text-slate-400 text-sm mb-4">
                Pay yearly, save $298 vs monthly.
              </p>
              <ul className="space-y-2 text-sm text-slate-300 border-t border-slate-800 pt-4">
                <li>1 year: <span className="text-white">$1,490</span></li>
                <li>3 years: <span className="text-white">$4,470</span></li>
                <li>5 years: <span className="text-white">$7,450</span></li>
                <li>10 years: <span className="text-white">$14,900</span></li>
              </ul>
            </div>

            {/* Lifetime - highlighted */}
            <div className="bg-gradient-to-br from-emerald-900/40 to-slate-900 border-2 border-emerald-500 rounded-2xl p-6 relative shadow-xl shadow-emerald-500/10">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-emerald-500 text-slate-950 text-xs font-bold px-4 py-1 rounded-full">
                  BEST LONG-TERM VALUE
                </span>
              </div>
              <h3 className="text-sm font-semibold text-emerald-300 uppercase tracking-wide mb-3">Lifetime</h3>
              <div className="mb-2">
                <span className="text-4xl font-black text-white">$2,997</span>
                <span className="text-slate-400 ml-1"> once</span>
              </div>
              <p className="text-emerald-200 text-sm mb-4">
                One payment. Forever access.
              </p>
              <ul className="space-y-2 text-sm text-slate-200 border-t border-emerald-500/30 pt-4">
                <li>1 year: <span className="text-white">$2,997</span></li>
                <li>3 years: <span className="text-emerald-300 font-semibold">$2,997</span> <span className="text-slate-500">(save $1,473)</span></li>
                <li>5 years: <span className="text-emerald-300 font-semibold">$2,997</span> <span className="text-slate-500">(save $4,453)</span></li>
                <li>10 years: <span className="text-emerald-300 font-semibold">$2,997</span> <span className="text-slate-500">(save $11,903)</span></li>
              </ul>
            </div>
          </div>

          <p className="text-slate-400 text-center text-sm mt-8 max-w-2xl mx-auto">
            Comparison vs annual pricing. Break-even point: <span className="text-emerald-400 font-semibold">25 months</span>.
            Every month after that is free Mindy.
          </p>
        </div>
      </section>

      {/* What's included */}
      <section className="bg-slate-900/40 px-4 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            Everything in Mindy Pro. Forever.
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            Lifetime is full Pro access — every feature, every update, every future module — on
            a single one-time payment.
          </p>

          <div className="grid md:grid-cols-2 gap-x-8 gap-y-3 max-w-2xl mx-auto">
            {proFeatures.map((f) => (
              <div key={f} className="flex items-start gap-3 text-slate-200">
                <CheckIcon highlighted />
                <span>{f}</span>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              href={CHECKOUT_URL}
              className="inline-block bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-bold text-lg px-10 py-4 rounded-xl shadow-xl shadow-emerald-500/25 transition-colors"
            >
              Lock in lifetime — $2,997 →
            </Link>
            <p className="text-slate-500 text-sm mt-3">One-time payment. 30-day money back.</p>
          </div>
        </div>
      </section>

      {/* Why this exists - Eric voice */}
      <section className="px-4 py-20">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-12">
            Why I priced Mindy lifetime at $2,997
          </h2>

          <div className="space-y-6 text-slate-300 text-lg leading-relaxed">
            <p>
              Mindy Pro is $149 a month because that&apos;s what small business contractors can
              afford to spend monthly without flinching. It works. Most of our customers stay on it.
            </p>

            <p>
              But some of you are different. You hate recurring bills. You&apos;d rather pay once,
              own the tool, and never see a renewal email. You don&apos;t want a subscription;
              you want an asset on your balance sheet.
            </p>

            <p>
              At $2,997 lifetime, you break even at 25 months versus annual — about two years.
              Most Mindy customers are still active well past that. After year 3, every additional
              month of recompete alerts, daily briefings, and pursuit research is essentially free.
            </p>

            <p>
              That&apos;s the deal. Pay once, use her for as long as you&apos;re in federal contracting,
              and never think about the bill again.
            </p>

            <p className="text-white font-semibold">
              — Eric Coffie, founder
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-900/40 px-4 py-20">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-12">
            Lifetime questions
          </h2>

          <div className="space-y-3">
            {faqs.map((f) => (
              <details
                key={f.q}
                className="group bg-slate-900 border border-slate-800 rounded-xl px-6 py-4 hover:border-slate-700 transition-colors"
              >
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-white font-semibold">
                  <span>{f.q}</span>
                  <span className="text-emerald-400 group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                </summary>
                <p className="mt-4 text-slate-300 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-4 py-20">
        <div className="max-w-3xl mx-auto bg-gradient-to-br from-purple-900/40 to-slate-900 border border-purple-500/30 rounded-3xl p-10 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            One payment. Forever Mindy.
          </h2>
          <p className="text-slate-300 text-lg mb-8 max-w-xl mx-auto">
            $2,997 today. No renewals, no surprise bills, every future feature included.
          </p>

          <Link
            href={CHECKOUT_URL}
            className="inline-block bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-bold text-lg px-10 py-4 rounded-xl shadow-xl shadow-emerald-500/25 transition-colors"
          >
            Get Mindy Lifetime — $2,997 →
          </Link>

          <div className="mt-6 flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm text-slate-400">
            <span className="flex items-center gap-2"><CheckIcon /> 30-day money back</span>
            <span className="flex items-center gap-2"><CheckIcon /> One-time payment</span>
            <span className="flex items-center gap-2"><CheckIcon /> All future features included</span>
          </div>

          <div className="mt-10 pt-8 border-t border-slate-800 text-sm text-slate-400">
            Not ready for lifetime?{' '}
            <Link href={MONTHLY_CHECKOUT} className="text-purple-300 hover:text-purple-200 font-semibold">
              Try Pro at $149/mo
            </Link>{' '}
            or{' '}
            <Link href={ANNUAL_CHECKOUT} className="text-purple-300 hover:text-purple-200 font-semibold">
              save with annual at $1,490/yr
            </Link>.
          </div>
        </div>
      </section>
    </main>
  );
}

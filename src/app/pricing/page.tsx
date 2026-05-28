/**
 * /pricing — Mindy pricing page.
 *
 * Target: replace the getmindy.ai/pricing 404 with a real conversion
 * surface. The wedge is honest pricing transparency — GovWin charges
 * $15K-$50K/yr because they sell to enterprise primes. Mindy is
 * $149/mo because we built for the 1-25 person small business that
 * never could afford enterprise market intel.
 *
 * Server component — no client interactivity needed. The annual vs
 * monthly "toggle" is intentionally STATIC (both prices shown on the
 * Pro card) to keep this server-rendered and SEO-indexable. The FAQ
 * uses native <details> elements for accordion UX without a single
 * line of JS.
 *
 * Schema: Organization @id is shared with the Mindy landing page so
 * Google consolidates brand entity. SoftwareApplication offers
 * exactly mirror the visible price cards. FAQPage mirrors the
 * visible FAQ. NO aggregateRating — adding fake reviews is a Google
 * penalty risk and we don't have real ones yet.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

const CHECKOUT_MONTHLY = 'https://buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C'; // $149/mo
const CHECKOUT_ANNUAL = 'https://buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D';  // $1,490/yr
const FREE_SIGNUP_URL = '/signup';
// Teams is a sales-touch tier per brand kit ("Contact Sales" CTA used
// on the landing page too). $499/mo is high enough that a quick
// qualification email beats a self-serve checkout for retention.
const TEAMS_CONTACT_URL = 'mailto:hello@getmindy.ai?subject=Mindy%20Teams%20Inquiry';

export const metadata: Metadata = {
  title: 'Pricing — Federal Market Intelligence from $0 | Mindy',
  description:
    'Free daily opportunity digest. Pro at $149/mo. Teams at $499/mo. Cancel anytime. 100x cheaper than GovWin, no sales call required.',
  alternates: {
    canonical: 'https://getmindy.ai/pricing',
  },
  keywords: [
    'mindy pricing',
    'federal market intelligence pricing',
    'govcon software pricing',
    'cheap govwin alternative',
    'small business federal contracting tools',
  ],
  openGraph: {
    title: 'Mindy Pricing — From $0 to $499/mo. No Enterprise Contracts.',
    description:
      'Same federal market intelligence as the $15K/yr enterprise tools, at a price small business can actually pay.',
    type: 'website',
    url: 'https://getmindy.ai/pricing',
  },
};

// Feature comparison matrix. Kept honest — Free legitimately lacks
// most of the value props, and that's the point. The wedge is that
// even Free beats the SAM.gov manual workflow.
const featureMatrix: Array<{
  category: string;
  rows: Array<{ feature: string; free: string | boolean; pro: string | boolean; teams: string | boolean }>;
}> = [
  {
    category: 'Daily Intelligence',
    rows: [
      { feature: 'Daily opportunity digest', free: true, pro: true, teams: true },
      { feature: 'AI-matched briefings', free: false, pro: true, teams: true },
      { feature: 'NAICS codes tracked', free: '3', pro: 'Unlimited', teams: 'Unlimited' },
      { feature: 'Target agency filtering', free: false, pro: true, teams: true },
    ],
  },
  {
    category: 'Competitive Intelligence',
    rows: [
      { feature: 'Competitor tracking', free: false, pro: true, teams: true },
      { feature: 'Recompete alerts (12 mo out)', free: false, pro: true, teams: true },
      { feature: 'Incumbent visibility on opportunities', free: false, pro: true, teams: true },
      { feature: 'Agency spending analysis', free: false, pro: true, teams: true },
    ],
  },
  {
    category: 'Forecast & Strategy',
    rows: [
      { feature: '7,600+ agency forecasts', free: 'Browse', pro: 'Full access', teams: 'Full access' },
      { feature: 'Weekly market deep dives', free: false, pro: true, teams: true },
      { feature: 'Pursuit briefs (deep research)', free: false, pro: true, teams: true },
    ],
  },
  {
    category: 'Team & Collaboration',
    rows: [
      { feature: 'Users included', free: '1', pro: '1', teams: '5 (more on request)' },
      { feature: 'Shared pipeline', free: false, pro: false, teams: true },
      { feature: 'Team dashboard', free: false, pro: false, teams: true },
      { feature: 'Role-based access', free: false, pro: false, teams: true },
    ],
  },
  {
    category: 'Support',
    rows: [
      { feature: 'Email support', free: true, pro: true, teams: true },
      { feature: 'Priority response (24hr)', free: false, pro: true, teams: true },
      { feature: 'Onboarding call', free: false, pro: false, teams: true },
    ],
  },
];

// FAQ is mirrored in JSON-LD below — keep in sync.
const faqs = [
  {
    q: 'Can I switch plans later?',
    a: "Yes, anytime. Upgrade from Free to Pro the moment you want competitor tracking and recompete alerts. Downgrade from Pro to Free if you want to pause. Switch to Teams the moment your second BD person joins. Changes take effect immediately and we pro-rate the difference.",
  },
  {
    q: 'Is there a free trial of Pro?',
    a: "Better — there's a permanent free tier so you can see how Mindy actually works before you spend a dollar. The Free plan gives you a daily opportunity digest across 3 NAICS codes. If you want full briefings, unlimited NAICS, competitor tracking, and recompete alerts, upgrade to Pro for $149/mo and cancel anytime.",
  },
  {
    q: 'What happens to my data if I cancel?',
    a: "Your account and your saved opportunities, NAICS profile, and pursuit list stay intact for 90 days in case you reactivate. After 90 days of inactivity we anonymize the account per our privacy policy. You can also request a full data export or deletion at any time by emailing hello@getmindy.ai.",
  },
  {
    q: 'Do you offer an annual discount?',
    a: "Yes. Pay $1,490/year instead of $1,788 ($149 x 12) and save $298 — effectively two free months. The annual plan is the most popular Pro option for contractors who know they're in this for the long haul. Same features, lower per-month cost, one less recurring charge to track.",
  },
  {
    q: 'Is there a money-back guarantee?',
    a: "If Mindy doesn't deliver value in your first 30 days on Pro, email hello@getmindy.ai and we'll refund the month. No forms, no \"talk to retention\" gauntlet. We'd rather give you your money back than have you stuck on a tool you don't use.",
  },
  {
    q: "What's the difference between Pro and Teams?",
    a: "Pro is built for the solo founder or one-person BD function. Teams adds multi-user accounts, a shared pipeline so your whole team sees the same pursuits, a team dashboard, and role-based access. If you have two or more people who need to see the same opportunities and coordinate on captures, Teams is the move.",
  },
  {
    q: 'Can I get a custom enterprise plan?',
    a: "Yes. If you need more than 5 seats, SSO, custom data exports, or API access for your own tooling, email hello@getmindy.ai with a quick description of your team and use case. We'll get back to you within a business day with a custom quote.",
  },
  {
    q: 'How do you compare to GovWin or Bloomberg Government?',
    a: "We pull the same public federal data (SAM.gov, Grants.gov, USASpending, agency forecasts) and surface it in a personalized daily briefing. We skip the enterprise sales motion, the analyst-written market briefs, and the deep Costpoint integrations — which is why we can charge $149/mo instead of $15,000+/yr. See the full comparison at /compare/govwin.",
  },
];

export default function PricingPage() {
  // JSON-LD graph. Organization @id matches the landing + comparison
  // pages so Google consolidates brand entity. SoftwareApplication
  // offers mirror the visible price cards (Free, Pro monthly, Teams).
  // FAQPage mirrors the visible FAQ. No aggregateRating — penalty risk.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://getmindy.ai/#organization',
        name: 'Mindy',
        alternateName: 'Mindy AI',
        url: 'https://getmindy.ai',
        logo: 'https://getmindy.ai/icon.png',
        description: 'AI-powered federal market intelligence for small business contractors.',
        email: 'hello@getmindy.ai',
        sameAs: ['https://govcongiants.org'],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': 'https://getmindy.ai/#software',
        name: 'Mindy',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description:
          'Federal market intelligence platform for small business contractors. Daily opportunity briefings, recompete alerts, competitor tracking, and 7,600+ agency forecasts.',
        offers: [
          { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
          {
            '@type': 'Offer',
            name: 'Pro',
            price: '149',
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '149',
              priceCurrency: 'USD',
              unitCode: 'MON',
            },
          },
          {
            '@type': 'Offer',
            name: 'Teams',
            price: '499',
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '499',
              priceCurrency: 'USD',
              unitCode: 'MON',
            },
          },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': 'https://getmindy.ai/pricing#faq',
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };

  return (
    <main className="min-h-screen bg-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-full mb-6">
            <span className="text-purple-300 text-sm font-semibold uppercase tracking-wide">
              Pricing
            </span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight">
            Pricing that makes sense<br />
            <span className="text-purple-400">for small business.</span>
          </h1>

          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-8">
            GovWin charges <span className="text-white font-semibold">$15,000–$50,000 a year</span> because
            they sell to Lockheed and Booz Allen. Mindy is{' '}
            <span className="text-purple-400 font-semibold">$149 a month</span> because we built her for you.
          </p>

          <p className="text-slate-400 text-sm">
            Start free. No credit card. Cancel anytime.
          </p>
        </div>
      </section>

      {/* Pricing cards */}
      <section className="px-4 -mt-8 pb-20">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-6">
            {/* Free */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col">
              <h3 className="text-xl font-bold text-white mb-2">Free</h3>
              <p className="text-slate-400 text-sm mb-6">For contractors just getting started.</p>

              <div className="mb-6">
                <span className="text-5xl font-black text-white">$0</span>
                <span className="text-slate-400 ml-1">/mo</span>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {[
                  'Daily opportunity digest',
                  'Up to 3 NAICS codes',
                  'Browse agency forecasts',
                  'Email support',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-slate-300 text-sm">
                    <CheckIcon />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={FREE_SIGNUP_URL}
                className="block w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-center transition-colors"
              >
                Start Free
              </Link>
              <p className="text-slate-500 text-xs text-center mt-3">No credit card required.</p>
            </div>

            {/* Pro - Most Popular */}
            <div className="bg-gradient-to-br from-purple-900/40 to-slate-900 border-2 border-purple-500 rounded-2xl p-8 relative flex flex-col shadow-xl shadow-purple-500/10">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-purple-500 text-white text-xs font-bold px-4 py-1 rounded-full">
                  MOST POPULAR
                </span>
              </div>

              <h3 className="text-xl font-bold text-white mb-2">Pro</h3>
              <p className="text-purple-200 text-sm mb-6">The $150K capture manager in your pocket.</p>

              <div className="mb-2">
                <span className="text-5xl font-black text-white">$149</span>
                <span className="text-slate-400 ml-1">/mo</span>
              </div>
              <p className="text-purple-300 text-sm mb-6">
                or <span className="font-semibold text-white">$1,490/yr</span>{' '}
                <span className="text-purple-400">(save $298)</span>
              </p>

              <ul className="space-y-3 mb-8 flex-1">
                {[
                  'Everything in Free',
                  'Full AI-matched daily briefings',
                  'Unlimited NAICS codes',
                  'Competitor & incumbent tracking',
                  'Recompete alerts 12 months out',
                  'Weekly market deep dives',
                  'Pursuit briefs on demand',
                  'Priority email support (24hr)',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-slate-200 text-sm">
                    <CheckIcon highlighted />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={CHECKOUT_MONTHLY}
                className="block w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-center transition-colors shadow-lg shadow-purple-500/25"
              >
                Get Mindy Pro — $149/mo
              </Link>
              <Link
                href={CHECKOUT_ANNUAL}
                className="block text-center text-purple-300 hover:text-purple-200 text-sm font-semibold mt-3"
              >
                Or get annual ($1,490/yr) →
              </Link>
            </div>

            {/* Teams */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col">
              <h3 className="text-xl font-bold text-white mb-2">Teams</h3>
              <p className="text-slate-400 text-sm mb-6">For growing contractors with a BD team.</p>

              <div className="mb-6">
                <span className="text-5xl font-black text-white">$499</span>
                <span className="text-slate-400 ml-1">/mo</span>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {[
                  'Everything in Pro',
                  'Up to 5 users included',
                  'Shared pipeline & pursuits',
                  'Team dashboard',
                  'Role-based access',
                  'Onboarding call included',
                  'Custom seat count on request',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-slate-300 text-sm">
                    <CheckIcon />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={TEAMS_CONTACT_URL}
                className="block w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-center transition-colors"
              >
                Contact Sales
              </Link>
              <p className="text-slate-500 text-xs text-center mt-3">Reply within one business day.</p>
            </div>
          </div>

          {/* Reassurance bar */}
          <div className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm text-slate-400">
            <span className="flex items-center gap-2">
              <CheckIcon /> Cancel anytime
            </span>
            <span className="flex items-center gap-2">
              <CheckIcon /> 30-day money back on Pro
            </span>
            <span className="flex items-center gap-2">
              <CheckIcon /> No sales call required
            </span>
            <span className="flex items-center gap-2">
              <CheckIcon /> Your data, your control
            </span>
          </div>
        </div>
      </section>

      {/* Feature comparison table */}
      <section className="bg-slate-900/50 py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            What&apos;s in every plan
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            Full feature matrix. No fine print, no &quot;contact us for pricing&quot; mystery boxes.
          </p>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900">
                <tr>
                  <th className="text-left py-4 px-5 text-slate-400 font-semibold w-2/5">Feature</th>
                  <th className="text-center py-4 px-5 text-slate-300 font-bold">Free</th>
                  <th className="text-center py-4 px-5 bg-purple-500/5">
                    <span className="text-purple-300 font-bold">Pro</span>
                  </th>
                  <th className="text-center py-4 px-5 text-slate-300 font-bold">Teams</th>
                </tr>
              </thead>
              <tbody>
                {featureMatrix.map((section) => (
                  <>
                    <tr key={`${section.category}-header`} className="bg-slate-900/80 border-t border-slate-800">
                      <td
                        colSpan={4}
                        className="py-3 px-5 text-purple-300 font-bold uppercase tracking-wide text-xs"
                      >
                        {section.category}
                      </td>
                    </tr>
                    {section.rows.map((row, i) => (
                      <tr
                        key={`${section.category}-${row.feature}`}
                        className={`border-t border-slate-800/50 ${i % 2 === 0 ? 'bg-slate-900/30' : ''}`}
                      >
                        <td className="py-3 px-5 text-white">{row.feature}</td>
                        <td className="py-3 px-5 text-center">
                          <CellValue value={row.free} />
                        </td>
                        <td className="py-3 px-5 text-center bg-purple-500/5">
                          <CellValue value={row.pro} highlighted />
                        </td>
                        <td className="py-3 px-5 text-center">
                          <CellValue value={row.teams} />
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* How we got to this price */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-12">
            How we got to this price
          </h2>

          <div className="space-y-6 text-slate-300 text-lg leading-relaxed">
            <p>
              GovWin charges $15,000 to $50,000 a year because they sell to enterprise primes —
              Lockheed, Booz Allen, Leidos. Those customers have dedicated procurement teams,
              capture analysts who live in the tool full-time, and BD budgets where a $25K
              platform fee is a rounding error. Enterprise pricing exists because enterprise
              customers expect (and pay for) white-glove onboarding, custom integrations, and
              a sales team to call them every quarter.
            </p>

            <p>
              Mindy is $149 a month because we built her for the 1-25 person small business
              that never could afford that motion. Same underlying public data — SAM.gov,
              Grants.gov, USASpending, agency forecasts. Same intelligence layer — AI-matched
              briefings, recompete alerts, competitor tracking. Different go-to-market: no
              analyst calls, no annual contract, no enterprise sales team to fund. The savings
              don&apos;t come from worse intelligence. They come from cutting the enterprise
              tax that small business never asked to pay.
            </p>
          </div>

          <div className="mt-10 text-center">
            <Link
              href="/compare/govwin"
              className="inline-block text-purple-400 hover:text-purple-300 font-semibold"
            >
              See the full GovWin comparison →
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-900/50 py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-12">
            Pricing questions, answered
          </h2>
          <div className="space-y-4">
            {faqs.map((f) => (
              <details
                key={f.q}
                className="group bg-slate-900 border border-slate-800 rounded-xl p-6"
              >
                <summary className="text-white font-semibold cursor-pointer list-none flex items-center justify-between gap-4">
                  <span>{f.q}</span>
                  <span className="text-purple-400 text-xl group-open:rotate-45 transition-transform">
                    +
                  </span>
                </summary>
                <p className="text-slate-400 mt-4 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            Start free. See your first briefing tomorrow.
          </h2>
          <p className="text-xl text-slate-300 mb-8">
            Three NAICS codes, a daily opportunity digest, and zero commitment. Upgrade to Pro
            when you&apos;re ready for the full intelligence layer.
          </p>
          <Link
            href={FREE_SIGNUP_URL}
            className="inline-block px-10 py-4 bg-white hover:bg-slate-100 text-purple-700 rounded-xl font-bold text-lg shadow-xl transition-all hover:scale-105"
          >
            Get Started Free
          </Link>
          <p className="text-slate-400 text-sm mt-4">
            No credit card. No sales call. Cancel anytime.
          </p>

          <div className="mt-12 pt-8 border-t border-slate-800/50">
            <p className="text-slate-500 text-sm italic">
              &quot;The big contractors have armies. You have Mindy.&quot;
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

// --- Small presentational helpers ---------------------------------

function CheckIcon({ highlighted = false }: { highlighted?: boolean }) {
  return (
    <svg
      className={`w-4 h-4 mt-0.5 shrink-0 ${highlighted ? 'text-purple-400' : 'text-emerald-400'}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 010 1.42l-8 8a1 1 0 01-1.42 0l-4-4a1 1 0 011.42-1.42L8 12.586l7.29-7.296a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CellValue({ value, highlighted = false }: { value: string | boolean; highlighted?: boolean }) {
  if (value === true) {
    return (
      <span className="inline-flex">
        <CheckIcon highlighted={highlighted} />
      </span>
    );
  }
  if (value === false) {
    return <span className="text-slate-600">—</span>;
  }
  return (
    <span className={highlighted ? 'text-purple-200 font-semibold' : 'text-slate-300'}>
      {value}
    </span>
  );
}

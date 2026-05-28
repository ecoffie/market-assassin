/**
 * /compare/govwin — "GovWin alternative" comparison page.
 *
 * Target keyword: "govwin alternative" (high-volume; every competitor
 * in the GovCon intelligence space ranks for this). GovWin (Deltek) is
 * the dominant enterprise player at $15K-$50K/yr with multi-week
 * onboarding. Mindy's wedge: same intelligence layer, 100x cheaper,
 * 3-minute signup, no sales call.
 *
 * Positioning is *honest comparison*, not bash-the-incumbent. The
 * "When to choose GovWin instead" section is deliberate credibility
 * insurance — Google rewards comparison pages that admit tradeoffs,
 * and prospects trust them more.
 *
 * Schema: Organization (shared @id with Mindy landing page so Google
 * sees a single brand), SoftwareApplication (so pricing shows up in
 * SERP), and FAQPage (mirrors the visible FAQ for rich results).
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'GovWin Alternative [2026] — Federal Market Intelligence for Small Business | Mindy',
  description:
    'Mindy is the small business alternative to Deltek GovWin: $149/mo vs $15K-$50K/yr, 3-minute signup, no sales call. Same opportunities, recompetes, and forecasts.',
  alternates: {
    canonical: 'https://getmindy.ai/compare/govwin',
  },
  keywords: [
    'govwin alternative',
    'deltek govwin alternative',
    'cheaper than govwin',
    'govwin competitor',
    'small business govcon intelligence',
    'federal market intelligence',
  ],
  openGraph: {
    title: 'GovWin Alternative for Small Business — Mindy at $149/mo',
    description:
      'Same federal market intelligence as GovWin (opportunities, recompetes, forecasts) at 1% of the price. No sales call, no annual contract.',
    type: 'website',
    url: 'https://getmindy.ai/compare/govwin',
  },
};

// Quick-glance table. "Winner" column is intentionally honest — Mindy
// loses on advanced analytics and enterprise integrations. Faking
// wins would tank credibility (and rankings).
const comparisonRows = [
  {
    feature: 'Starting Price',
    mindy: '$0 (Free) / $149/mo (Pro)',
    govwin: '$15,000–$50,000+/yr',
    winner: 'mindy' as const,
  },
  {
    feature: 'Setup Time',
    mindy: '3 minutes — sign up, get briefing',
    govwin: 'Weeks of onboarding + analyst calls',
    winner: 'mindy' as const,
  },
  {
    feature: 'Sales Process',
    mindy: 'Self-serve — no demo required',
    govwin: 'Mandatory demo + multi-call sales cycle',
    winner: 'mindy' as const,
  },
  {
    feature: 'Contract Length',
    mindy: 'Month-to-month, cancel anytime',
    govwin: 'Annual minimum (often multi-year)',
    winner: 'mindy' as const,
  },
  {
    feature: 'Opportunity Coverage',
    mindy: 'SAM.gov, Grants.gov, agency forecasts, USASpending',
    govwin: 'SAM.gov, Grants.gov, FBO, IQ data, forecasts',
    winner: 'tie' as const,
  },
  {
    feature: 'Personalized Daily Briefing',
    mindy: 'AI-matched to your NAICS + capability profile',
    govwin: 'Keyword alerts + saved searches',
    winner: 'mindy' as const,
  },
  {
    feature: 'Recompete Intelligence',
    mindy: 'Flags expiring contracts 12 months out',
    govwin: 'Recompete tracking included',
    winner: 'tie' as const,
  },
  {
    feature: 'Competitor / Incumbent Tracking',
    mindy: 'Built in — who won what, when it expires',
    govwin: 'Most granular in the market',
    winner: 'govwin' as const,
  },
  {
    feature: 'Forecast Intelligence',
    mindy: '7,600+ agency forecasts aggregated',
    govwin: 'IQ pipeline + forecast database',
    winner: 'tie' as const,
  },
  {
    feature: 'Advanced Forecasting Analytics',
    mindy: 'Basic trend analysis',
    govwin: 'Deep predictive models, capture analytics',
    winner: 'govwin' as const,
  },
  {
    feature: 'Team Collaboration',
    mindy: 'Teams plan $499/mo (multi-user, shared pipeline)',
    govwin: 'Per-seat enterprise contract negotiation',
    winner: 'mindy' as const,
  },
  {
    feature: 'Deltek Costpoint Integration',
    mindy: 'Not available',
    govwin: 'Native integration',
    winner: 'govwin' as const,
  },
  {
    feature: 'Best For',
    mindy: 'Small businesses, 1–25 person teams',
    govwin: 'Large primes with $1M+ BD budgets',
    winner: 'tie' as const,
  },
];

// FAQ is mirrored in JSON-LD below — keep in sync.
const faqs = [
  {
    q: 'How is Mindy actually cheaper than GovWin?',
    a: "GovWin's enterprise pricing model spreads platform, data, and analyst-call costs across $15K–$50K annual contracts. Mindy is pure SaaS — no analyst calls, no custom onboarding, no enterprise sales team to fund. The same public data sources cost a fraction to surface when you cut out the white-glove layer that small businesses rarely use anyway.",
  },
  {
    q: 'Does Mindy have the same data as GovWin?',
    a: "For the core BD workflow — opportunities, awards, recompetes, forecasts — yes. We pull from the same public sources (SAM.gov, Grants.gov, USASpending, agency forecasts). GovWin layers proprietary analyst write-ups and a deeper incumbent intelligence database on top. If you need an analyst to call you and walk through a capture strategy, GovWin is still the move.",
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Mindy Pro and Teams are month-to-month. Cancel in one click from your dashboard. GovWin contracts are typically annual with auto-renewal clauses — read the fine print before signing.',
  },
  {
    q: 'I run a 3-person federal services company. Will Mindy actually replace GovWin for me?',
    a: "Almost certainly. The vast majority of GovWin's enterprise features (capture management workflow, deep competitive analytics, integration with Deltek Costpoint) are built for 100+ person BD organizations. A 3-person shop needs daily opportunity flow, recompete alerts, and competitor visibility — all of which Mindy delivers at $149/mo.",
  },
  {
    q: 'What if I outgrow Mindy?',
    a: "Honest answer: if you scale into a 50+ person BD org with a dedicated capture team and you're chasing $50M+ contracts where a single bad bid kills your year, GovWin (or a similar enterprise platform) probably belongs in your stack. We'll be the first to tell you. Until then, Mindy gives you 90% of the intelligence at 1% of the cost.",
  },
  {
    q: 'Do I need to talk to sales to sign up?',
    a: "No. Pick a plan, enter a card (or start free), and your first briefing lands in your inbox the next morning. The whole point of Mindy is removing the enterprise sales friction that keeps small businesses locked out of professional market intelligence.",
  },
  {
    q: 'Is there a free trial?',
    a: 'Better — there\'s a permanent free tier. The Mindy Free plan gives you a daily opportunity digest across 3 NAICS codes. No credit card required. Upgrade to Pro when you want full briefings, unlimited NAICS, competitor tracking, and recompete alerts.',
  },
];

export default function GovWinComparePage() {
  // JSON-LD graph. Organization @id matches the Mindy landing page so
  // Google consolidates brand entity rather than treating each page as
  // a separate org. SoftwareApplication carries the pricing offers
  // (helps Google show price in rich snippets). FAQPage mirrors the
  // visible FAQ above.
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
          'Federal market intelligence platform for small business contractors. A small business alternative to Deltek GovWin.',
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
              GovWin Alternative
            </span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight">
            The GovWin Alternative<br />
            <span className="text-purple-400">Built for Small Business.</span>
          </h1>

          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-8">
            GovWin charges <span className="text-white font-semibold">$15,000–$50,000 a year</span>.
            Mindy delivers the same opportunity intelligence for <span className="text-purple-400 font-semibold">$149 a month</span>.
            No sales calls. No annual contracts. Just a daily briefing in your inbox.
          </p>

          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto mb-10">
            <div className="bg-gradient-to-br from-purple-900/40 to-slate-900 border border-purple-500/40 rounded-2xl p-6">
              <div className="text-sm font-semibold text-purple-300 mb-1">Mindy Pro</div>
              <div className="text-4xl font-black text-white">
                $149<span className="text-lg text-slate-400">/mo</span>
              </div>
              <div className="text-sm text-slate-400 mt-1">Month-to-month. Cancel anytime.</div>
            </div>
            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6">
              <div className="text-sm font-semibold text-slate-400 mb-1">Deltek GovWin</div>
              <div className="text-4xl font-black text-white">
                $15K–$50K<span className="text-lg text-slate-400">/yr</span>
              </div>
              <div className="text-sm text-slate-400 mt-1">Annual contract + onboarding fees.</div>
            </div>
          </div>

          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-500/30 transition-all hover:scale-105"
          >
            Start Free — No Credit Card
          </Link>
          <p className="text-slate-500 text-sm mt-4">First briefing lands tomorrow morning.</p>
        </div>
      </section>

      {/* Why small businesses can't use GovWin */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            Why Small Businesses Can&apos;t Actually Use GovWin
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            GovWin is a great product. It&apos;s also priced, packaged, and sold for a customer
            you&apos;re probably not.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="text-3xl mb-3">💸</div>
              <h3 className="text-white font-semibold mb-2 text-lg">The Pricing Wall</h3>
              <p className="text-slate-400 text-sm">
                GovWin starts in the $15K range for a single seat and climbs fast for teams and
                add-ons. For a 1–10 person federal services company, that&apos;s a meaningful
                percentage of your annual BD budget — on a tool, before you&apos;ve won anything.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="text-3xl mb-3">📞</div>
              <h3 className="text-white font-semibold mb-2 text-lg">The Sales Gauntlet</h3>
              <p className="text-slate-400 text-sm">
                You can&apos;t self-serve. Demo request, qualifying call, technical demo, pricing
                conversation, procurement review, contract negotiation. Multi-week cycle just
                to see if the product fits.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="text-3xl mb-3">📚</div>
              <h3 className="text-white font-semibold mb-2 text-lg">Enterprise UI Overwhelm</h3>
              <p className="text-slate-400 text-sm">
                Dashboards built for capture analysts with 40 hours a week to spend in the tool.
                If you&apos;re a founder running BD between proposals and delivery, you don&apos;t
                have time to learn an enterprise platform.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="text-3xl mb-3">📅</div>
              <h3 className="text-white font-semibold mb-2 text-lg">Annual Lock-In</h3>
              <p className="text-slate-400 text-sm">
                Standard contract is 12-month minimum with auto-renewal. Trying it for a quarter
                to see if it moves the needle isn&apos;t an option. You commit before you know.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="bg-slate-900/50 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            Feature-by-Feature: Mindy vs GovWin
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            Honest comparison. GovWin wins on a few things — we&apos;ll tell you which.
          </p>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900">
                <tr className="border-b border-slate-800">
                  <th className="text-left py-4 px-5 text-slate-400 font-semibold">Feature</th>
                  <th className="text-left py-4 px-5 bg-purple-500/5">
                    <span className="text-purple-300 font-bold">Mindy</span>
                  </th>
                  <th className="text-left py-4 px-5">
                    <span className="text-slate-300 font-bold">GovWin</span>
                  </th>
                  <th className="text-center py-4 px-5 text-slate-400 font-semibold">Winner</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={`border-b border-slate-800/50 ${i % 2 === 0 ? 'bg-slate-900/30' : ''}`}
                  >
                    <td className="py-4 px-5 text-white font-medium">{row.feature}</td>
                    <td className="py-4 px-5 text-slate-300 bg-purple-500/5">{row.mindy}</td>
                    <td className="py-4 px-5 text-slate-400">{row.govwin}</td>
                    <td className="py-4 px-5 text-center">
                      {row.winner === 'mindy' && (
                        <span className="inline-block px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs font-semibold">
                          Mindy
                        </span>
                      )}
                      {row.winner === 'govwin' && (
                        <span className="inline-block px-2 py-1 bg-slate-700 text-slate-300 rounded text-xs font-semibold">
                          GovWin
                        </span>
                      )}
                      {row.winner === 'tie' && (
                        <span className="inline-block px-2 py-1 bg-slate-800 text-slate-500 rounded text-xs font-semibold">
                          Tie
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* When to choose GovWin */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            When You Should Actually Pick GovWin
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            We&apos;d rather you buy the right tool than buy the wrong one from us.
          </p>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
            <p className="text-slate-300 mb-6">
              GovWin is the better choice if you check most of these boxes:
            </p>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <span className="text-purple-400 mt-1">→</span>
                <span className="text-slate-300">
                  <strong className="text-white">You have a $1M+ annual BD budget</strong> and a
                  dedicated capture team. The cost is a rounding error and the depth pays for itself.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-purple-400 mt-1">→</span>
                <span className="text-slate-300">
                  <strong className="text-white">You need advanced forecasting analytics</strong> —
                  predictive models, pipeline scoring across hundreds of pursuits, capture
                  probability scoring.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-purple-400 mt-1">→</span>
                <span className="text-slate-300">
                  <strong className="text-white">You use Deltek Costpoint or other Deltek tools</strong> and
                  need a native integration into the same data model.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-purple-400 mt-1">→</span>
                <span className="text-slate-300">
                  <strong className="text-white">You want analyst-written market briefs</strong> on
                  specific agencies and programs delivered by humans, not AI.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-purple-400 mt-1">→</span>
                <span className="text-slate-300">
                  <strong className="text-white">Compliance / procurement requires</strong> an
                  established enterprise vendor with a long track record.
                </span>
              </li>
            </ul>
            <p className="text-slate-400 mt-8 text-sm italic">
              If most of those don&apos;t describe you, Mindy is the right call.
            </p>
          </div>
        </div>
      </section>

      {/* What Mindy delivers */}
      <section className="bg-slate-900/50 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            What Mindy Actually Does for You
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            Everything a $150K capture manager does. For less than your coffee budget.
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                title: 'Daily personalized briefings',
                detail: 'Every morning at 7 AM ET, matched to your NAICS, set-aside, and target agencies.',
              },
              {
                title: 'Recompete alerts',
                detail: 'Know 12 months in advance when an incumbent contract is expiring in your space.',
              },
              {
                title: 'Competitor tracking',
                detail: "See who's winning awards in your NAICS codes and what contracts they hold.",
              },
              {
                title: '7,600+ agency forecasts',
                detail: 'Federal forecasts aggregated so you can position before opportunities post.',
              },
              {
                title: 'Weekly market deep dives',
                detail: 'Spending trends, set-aside patterns, and where the money is moving in your space.',
              },
              {
                title: 'Pursuit briefs',
                detail: 'Deep research on specific opportunities — incumbent, history, decision-makers.',
              },
            ].map((f) => (
              <div
                key={f.title}
                className="bg-slate-900 border border-slate-800 rounded-xl p-5"
              >
                <div className="flex items-start gap-3">
                  <span className="text-purple-400 text-lg">✓</span>
                  <div>
                    <h3 className="text-white font-semibold mb-1">{f.title}</h3>
                    <p className="text-slate-400 text-sm">{f.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link
              href="/market-intelligence"
              className="text-purple-400 hover:text-purple-300 font-semibold"
            >
              See everything Mindy includes →
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-12">
            Frequently Asked Questions
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

      {/* Related comparisons */}
      <section className="px-4 py-12 border-t border-slate-800">
        <div className="max-w-4xl mx-auto text-center">
          <h3 className="text-lg font-semibold text-white mb-4">Other Comparisons</h3>
          <div className="flex flex-wrap gap-6 justify-center">
            <Link
              href="/compare/sam-gov"
              className="text-slate-400 hover:text-purple-300 transition"
            >
              Mindy vs SAM.gov →
            </Link>
            <Link
              href="/expiring-contracts"
              className="text-slate-400 hover:text-purple-300 transition"
            >
              See expiring contracts →
            </Link>
            <Link
              href="/forecasts"
              className="text-slate-400 hover:text-purple-300 transition"
            >
              Browse 7,600+ forecasts →
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            The big contractors have armies.<br />
            <span className="text-purple-400">You have Mindy.</span>
          </h2>
          <p className="text-xl text-slate-300 mb-8">
            Stop overpaying for enterprise intelligence you don&apos;t use. Start free, see your
            first briefing tomorrow morning.
          </p>
          <Link
            href="/signup"
            className="inline-block px-10 py-4 bg-white hover:bg-slate-100 text-purple-700 rounded-xl font-bold text-lg shadow-xl transition-all hover:scale-105"
          >
            Get Started Free
          </Link>
          <p className="text-slate-400 text-sm mt-4">
            No credit card. No sales call. Cancel anytime.
          </p>
        </div>
      </section>
    </main>
  );
}

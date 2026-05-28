/**
 * /compare/sam-gov — "SAM.gov alternative" comparison page.
 *
 * Target keyword: "sam.gov alternative" (massive search volume — every
 * contractor frustrated with SAM.gov UX searches this). Framing is
 * deliberately *complementary*, not adversarial: SAM.gov is the source
 * of truth and required for federal work. Mindy doesn't replace it,
 * she reads it for you and adds the intelligence layer it lacks
 * (incumbent data, recompete timing, fit scoring, personalization).
 *
 * Honest positioning builds trust + Google rewards comparison pages
 * that admit complementary use cases. The "use SAM.gov for X, use
 * Mindy for Y" section is the linchpin — it tells the user exactly
 * how to think about the relationship.
 *
 * Schema: shared Organization @id with the Mindy landing page,
 * SoftwareApplication with pricing offers, FAQPage mirroring the
 * visible FAQ for rich results.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'SAM.gov Alternative [2026] — AI-Powered Federal Opportunity Alerts | Mindy',
  description:
    "You still need SAM.gov — you just don't need to scroll it. Mindy reads SAM.gov for you and delivers personalized daily briefings with incumbent data and recompete alerts SAM.gov can't.",
  alternates: {
    canonical: 'https://getmindy.ai/compare/sam-gov',
  },
  keywords: [
    'sam.gov alternative',
    'better than sam.gov alerts',
    'sam.gov alerts not working',
    'sam.gov search alternative',
    'federal opportunity alerts',
    'sam.gov intelligence layer',
  ],
  openGraph: {
    title: 'SAM.gov Alternative — Mindy Reads SAM.gov For You',
    description:
      'Stop scrolling SAM.gov. Get personalized daily briefings with incumbent data, recompete alerts, and AI fit scoring SAM.gov cannot deliver.',
    type: 'website',
    url: 'https://getmindy.ai/compare/sam-gov',
  },
};

// Two-column compare. SAM.gov column reflects what it actually does
// (it's not a competitor — it's the source of record), not a strawman.
const comparisonRows = [
  {
    feature: 'Price',
    samGov: 'Free (government-operated)',
    mindy: 'Free / $149 Pro / $499 Teams',
  },
  {
    feature: 'Authoritative Source',
    samGov: 'Yes — official federal solicitation system',
    mindy: 'No — reads SAM.gov, does not replace it',
  },
  {
    feature: 'Search UX',
    samGov: 'Clunky filters, slow, frequent timeouts',
    mindy: 'Natural-language + AI matching to your profile',
  },
  {
    feature: 'Email Alerts',
    samGov: 'Keyword-based, often spammy / noisy',
    mindy: 'Personalized daily briefing scored to your business',
  },
  {
    feature: 'Incumbent Data',
    samGov: 'Not surfaced',
    mindy: 'Who has it now, contract value, expiration date',
  },
  {
    feature: 'Recompete Timing',
    samGov: 'Not surfaced',
    mindy: 'Flagged 12 months before incumbent contract expires',
  },
  {
    feature: 'Forecast Coverage',
    samGov: 'Limited (per-agency forecast pages, scattered)',
    mindy: '7,600+ federal forecasts aggregated in one feed',
  },
  {
    feature: 'Grants.gov Coverage',
    samGov: 'No — separate system',
    mindy: 'Yes — unified opportunity feed',
  },
  {
    feature: 'Competitor Tracking',
    samGov: 'Not available',
    mindy: "Who's winning awards in your NAICS codes",
  },
  {
    feature: 'Pipeline / CRM',
    samGov: 'Not available',
    mindy: 'Built-in pipeline tracking',
  },
  {
    feature: 'Mobile Experience',
    samGov: 'Desktop-first, painful on phone',
    mindy: 'Email-first; daily briefing reads on any device',
  },
  {
    feature: 'Time Investment',
    samGov: '10–20 hours/week of manual searching',
    mindy: '~15 minutes/day reviewing your briefing',
  },
  {
    feature: 'Submitting Proposals',
    samGov: 'Yes — this is where you submit',
    mindy: "No — submit via SAM.gov when it's time to bid",
  },
];

// FAQ mirrored in JSON-LD below — keep in sync.
const faqs = [
  {
    q: "Is Mindy actually a replacement for SAM.gov?",
    a: "No, and we wouldn't pretend to be. SAM.gov is the official federal procurement system — you have to be registered there, you have to submit proposals there, and it's the source of truth for solicitation data. Mindy reads SAM.gov for you so you don't have to scroll it manually, and adds the intelligence layer (incumbents, recompetes, fit scoring) that SAM.gov doesn't provide.",
  },
  {
    q: "What's wrong with SAM.gov's built-in email alerts?",
    a: "They're keyword-based and notoriously noisy. Search for \"cybersecurity\" and you'll get every contract that mentions the word — including custodial services at a building with cyber tenants. SAM.gov doesn't know your NAICS codes, your set-aside status, your past performance, or whether a $50M IDIQ is realistic for your 5-person company. Mindy does.",
  },
  {
    q: "Why pay $149/mo when SAM.gov is free?",
    a: "Because your time isn't free. Contractors spend 10–20 hours a week on SAM.gov scrolling, filtering, opening tabs, and trying to figure out who the incumbent is. At even $50/hour for your time, that's $2,000–$4,000 a month. Mindy compresses that into 15 minutes a day reviewing your briefing. The price isn't the data — it's the time and the intelligence.",
  },
  {
    q: "Can Mindy find an opportunity SAM.gov can't?",
    a: "Not on the SAM.gov data itself — we're pulling the same source. But Mindy surfaces opportunities you'd never find on SAM.gov because (a) SAM's search filters miss them, (b) they posted overnight and were buried by morning, or (c) they're in NAICS codes you didn't think to search but match your capabilities. Mindy also pulls Grants.gov, agency forecasts, and USASpending — sources SAM.gov doesn't cover.",
  },
  {
    q: "Do I still need a SAM.gov account if I have Mindy?",
    a: "Yes. You need an active SAM.gov registration to be eligible for federal contracts, and you submit proposals through SAM.gov. Mindy is the intelligence layer that sits on top — think of it as a smart inbox for the federal opportunity firehose, not a replacement for the procurement system itself.",
  },
  {
    q: "What does Mindy do when an incumbent contract is expiring?",
    a: "Flag it 12 months in advance with the incumbent name, contract value, agency, NAICS code, and current expiration date. SAM.gov doesn't surface this at all — by the time the recompete solicitation drops, you have 30 days to respond and the incumbent has had 18 months to position. Mindy gives you the same 18-month head start.",
  },
  {
    q: "Is there a free version of Mindy?",
    a: "Yes. Mindy Free gives you a daily opportunity digest across 3 NAICS codes — no credit card, forever free. Pro ($149/mo) unlocks unlimited NAICS, full briefings with AI analysis, recompete alerts, competitor tracking, and weekly market deep dives.",
  },
];

export default function SamGovComparePage() {
  // JSON-LD graph. Organization @id matches Mindy landing page so
  // Google sees one brand entity. SoftwareApplication carries pricing.
  // FAQPage mirrors the visible FAQ for rich results.
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
          'Intelligence layer on top of SAM.gov, Grants.gov, and federal forecasts. Personalized daily briefings for small business contractors.',
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
              SAM.gov Alternative
            </span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight">
            You still need SAM.gov.<br />
            <span className="text-purple-400">You just don&apos;t need to scroll it.</span>
          </h1>

          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-8">
            SAM.gov is the official federal procurement system — required, free, and not
            going anywhere. But its alerts are noisy, its search is painful, and it
            doesn&apos;t tell you who the incumbent is or when their contract expires.
            <span className="text-white font-semibold"> Mindy does.</span>
          </p>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 max-w-2xl mx-auto mb-8 text-left">
            <p className="text-slate-300">
              <strong className="text-white">Important:</strong> Mindy doesn&apos;t replace
              SAM.gov. We read it for you — and add the intelligence layer it lacks
              (incumbent data, recompete timing, AI fit scoring, personalized briefings).
              You&apos;ll still submit proposals through SAM.gov.
            </p>
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

      {/* Why SAM.gov alerts fail */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            Why SAM.gov Alerts Fail You
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            SAM.gov publishes the data. It doesn&apos;t curate it, score it, or know your
            business. That&apos;s where the wheels come off.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="text-3xl mb-3">📧</div>
              <h3 className="text-white font-semibold mb-2 text-lg">Keyword Spam</h3>
              <p className="text-slate-400 text-sm">
                Search &ldquo;cybersecurity&rdquo; on SAM.gov alerts and you&apos;ll get every
                solicitation that mentions the word — including janitorial services at a
                cyber tenant&apos;s building. Zero context. Zero fit scoring.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="text-3xl mb-3">🕳️</div>
              <h3 className="text-white font-semibold mb-2 text-lg">No Incumbent Data</h3>
              <p className="text-slate-400 text-sm">
                Solicitation drops — but who has the work today? When does it expire? Is this
                a real recompete or a sole-source dressed up as competition? SAM.gov
                won&apos;t tell you. You&apos;re left guessing.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="text-3xl mb-3">⏰</div>
              <h3 className="text-white font-semibold mb-2 text-lg">Missed Opportunities</h3>
              <p className="text-slate-400 text-sm">
                Contracts posted on a Tuesday get buried by Friday. By the time you find them
                you have 5 days to respond. The incumbent saw it the morning it dropped and
                has been positioning for 18 months.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="text-3xl mb-3">🎯</div>
              <h3 className="text-white font-semibold mb-2 text-lg">No Fit Scoring</h3>
              <p className="text-slate-400 text-sm">
                SAM.gov doesn&apos;t know your NAICS codes, your set-aside status, your past
                performance, or whether a $50M IDIQ is realistic for your 5-person company.
                Every alert looks the same. None of them tell you whether you can actually win it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="bg-slate-900/50 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            Side-by-Side: SAM.gov vs Mindy
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            Not a competitor — a complement. Here&apos;s how each one fits in your workflow.
          </p>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900">
                <tr className="border-b border-slate-800">
                  <th className="text-left py-4 px-5 text-slate-400 font-semibold">Feature</th>
                  <th className="text-left py-4 px-5">
                    <span className="text-slate-300 font-bold">SAM.gov</span>
                  </th>
                  <th className="text-left py-4 px-5 bg-purple-500/5">
                    <span className="text-purple-300 font-bold">Mindy</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={`border-b border-slate-800/50 ${i % 2 === 0 ? 'bg-slate-900/30' : ''}`}
                  >
                    <td className="py-4 px-5 text-white font-medium">{row.feature}</td>
                    <td className="py-4 px-5 text-slate-400">{row.samGov}</td>
                    <td className="py-4 px-5 text-slate-300 bg-purple-500/5">{row.mindy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Workflow split */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            Use SAM.gov For This. Use Mindy For That.
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            The two tools do different jobs. Here&apos;s the honest workflow.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center">
                  <span className="text-white font-bold">S</span>
                </div>
                <h3 className="text-xl font-bold text-white">Use SAM.gov for</h3>
              </div>
              <ul className="space-y-3">
                {[
                  'Entity registration (required to win federal contracts)',
                  'Submitting proposals — this is the official channel',
                  'Pulling official solicitation documents (RFP PDFs, attachments)',
                  'Reading and downloading contracting officer documents',
                  'Verifying the authoritative version of any opportunity',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-slate-300 text-sm">
                    <span className="text-slate-500 mt-0.5">→</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-gradient-to-br from-purple-900/30 to-slate-900 border border-purple-500/30 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-purple-600 flex items-center justify-center">
                  <span className="text-white font-bold">M</span>
                </div>
                <h3 className="text-xl font-bold text-white">Use Mindy for</h3>
              </div>
              <ul className="space-y-3">
                {[
                  'Discovering opportunities matched to your business profile',
                  "Knowing who the incumbent is and when their contract expires",
                  'Recompete alerts 12 months before solicitations drop',
                  'Daily briefings instead of scrolling SAM.gov every morning',
                  'Forecast intelligence — what\'s coming before it posts',
                  'Weekly market analysis on spending in your NAICS codes',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-slate-300 text-sm">
                    <span className="text-purple-400 mt-0.5">→</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-8 bg-slate-900 border border-slate-800 rounded-xl p-6 text-center">
            <p className="text-slate-300">
              <strong className="text-white">Most pros use both.</strong> Mindy is the daily inbox
              that surfaces what&apos;s worth your attention. SAM.gov is where you go to act on it.
            </p>
          </div>
        </div>
      </section>

      {/* Time math */}
      <section className="bg-slate-900/50 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-12">
            The Time Math Most Contractors Ignore
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
              <div className="text-sm font-semibold text-slate-500 mb-2">SAM.gov Workflow</div>
              <div className="text-5xl font-black text-white mb-4">
                10–20<span className="text-2xl text-slate-400">hrs/week</span>
              </div>
              <p className="text-slate-400 text-sm">
                Logging in, running searches, filtering noise, opening tabs, copying notice IDs,
                Googling incumbents, building a tracking spreadsheet. Repeat every morning.
              </p>
              <p className="text-slate-500 text-xs mt-4 italic">
                At $50/hr for your time, that&apos;s $2,000–$4,000/mo.
              </p>
            </div>

            <div className="bg-gradient-to-br from-purple-900/30 to-slate-900 border border-purple-500/30 rounded-2xl p-8">
              <div className="text-sm font-semibold text-purple-300 mb-2">Mindy Workflow</div>
              <div className="text-5xl font-black text-white mb-4">
                ~15<span className="text-2xl text-slate-400">min/day</span>
              </div>
              <p className="text-slate-300 text-sm">
                Open one email at 7 AM. Skim the briefing. Click through to the 2–3 opportunities
                worth pursuing. Mindy did the searching, scoring, and incumbent research overnight.
              </p>
              <p className="text-purple-300 text-xs mt-4 italic">
                Pro is $149/mo. The time you save pays for it 10x over.
              </p>
            </div>
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
              href="/compare/govwin"
              className="text-slate-400 hover:text-purple-300 transition"
            >
              Mindy vs GovWin →
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
            Stop scrolling SAM.gov.<br />
            <span className="text-purple-400">Let Mindy do it.</span>
          </h2>
          <p className="text-xl text-slate-300 mb-8">
            Your first personalized briefing lands tomorrow morning. No credit card. No sales
            call. Cancel anytime.
          </p>
          <Link
            href="/signup"
            className="inline-block px-10 py-4 bg-white hover:bg-slate-100 text-purple-700 rounded-xl font-bold text-lg shadow-xl transition-all hover:scale-105"
          >
            Get Your First Briefing Free
          </Link>
          <p className="text-slate-400 text-sm mt-4">
            You&apos;ll still use SAM.gov. You just won&apos;t live there anymore.
          </p>
        </div>
      </section>
    </main>
  );
}

import Link from 'next/link';
import { MindySignupForm } from '@/components/mindy/MindySignupForm';
import { DemoMedia } from '@/components/mindy/DemoMedia';

// Product reels (vertical 9:16) for the "See Mindy in action" row. Vimeo player-
// embed URLs WITH app_id — the exact form Vimeo's own oembed serves (a bare player
// URL 401s for these Business team-library videos). Matched to captions by title:
//   1200497355 "How Do I Know Which Ones to Actually Bid On" → bid/search
//   1200497352 "5 active solicitations"                      → morning briefing
//   1200503755 "2_Mindy_AI"                                  → market research
const VIMEO_APP = 'app_id=122963';
const reel = (id: string) => `https://player.vimeo.com/video/${id}?${VIMEO_APP}`;
const DEMO_REELS = [reel('1200497355'), reel('1200497352'), reel('1200503755')];

// Route paid CTAs through /checkout first so purchase attribution (UTM /
// referrer captured pre-checkout) is joined to the Stripe purchase event.
const CHECKOUT_MONTHLY = '/checkout/mindy-pro-monthly'; // $149/mo
const CHECKOUT_ANNUAL = '/checkout/mindy-pro-annual';   // $1,490/yr
const FREE_SIGNUP_URL = '/signup';
const DASHBOARD_URL = '/app';

export default function MindyLandingPage() {

  // JSON-LD structured data. Three schema types in one graph:
  //   - Organization: anchors brand identity (helps with knowledge panel)
  //   - SoftwareApplication: signals this is a SaaS product with pricing
  //   - FAQPage: mirrors the on-page FAQ so Google can render rich results
  // Keep this in sync with the visible FAQ section below.
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
        description: 'Your 24/7 federal market intelligence analyst. Scans 24,000+ opportunities daily, tracks competitors, and delivers personalized briefings.',
        offers: [
          { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Pro', price: '149', priceCurrency: 'USD', priceSpecification: { '@type': 'UnitPriceSpecification', price: '149', priceCurrency: 'USD', unitCode: 'MON' } },
          { '@type': 'Offer', name: 'Teams', price: '499', priceCurrency: 'USD', priceSpecification: { '@type': 'UnitPriceSpecification', price: '499', priceCurrency: 'USD', unitCode: 'MON' } },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': 'https://getmindy.ai/#faq',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'How is this different from SAM.gov alerts?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'SAM.gov sends you everything that matches a keyword. Mindy learns your business and sends you what actually matters — with context on competition, incumbents, and why this opportunity fits you.',
            },
          },
          {
            '@type': 'Question',
            name: 'I already have a BD person. Why do I need Mindy?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "Mindy doesn't replace your BD team — she supercharges them. She handles the 20 hours/week of searching so your people can focus on relationships and proposals.",
            },
          },
          {
            '@type': 'Question',
            name: "What if I'm brand new to federal contracting?",
            acceptedAnswer: {
              '@type': 'Answer',
              text: "Perfect. Mindy explains opportunities in plain English and tells you exactly what you need to compete. She's like having a mentor who never sleeps.",
            },
          },
          {
            '@type': 'Question',
            name: 'Can Mindy help me write proposals?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "Not yet — but she'll tell you which opportunities are worth writing proposals for. That's half the battle.",
            },
          },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen bg-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero Section — py-20→py-10 + tighter logo/heading margins so the signup
          form (and the beta-setup banner below) sit above the fold. Beta users land
          here; they shouldn't have to scroll to find how to get in. */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-10 px-4">
        <div className="max-w-4xl mx-auto text-center">
          {/* Mindy Logo/Icon */}
          <div className="inline-flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-xl shadow-purple-500/30">
              <span className="text-white font-bold text-3xl">M</span>
            </div>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">
            Meet Mindy.
          </h1>
          <h2 className="text-xl md:text-2xl text-purple-200 mb-4">
            Your 24/7 Federal Market Intelligence Analyst.
          </h2>
          <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-6">
            While you sleep, Mindy scans 88,000+ federal opportunities, tracks your competitors,
            and delivers a personalized briefing before your first coffee.
          </p>

          {/* BETA-USER PATH — most arrivals right now are the email-only beta cohort
              who get alerts but never set a password. OAuth won't help them; they need
              the password-setup link. Lead with it. */}
          <div className="max-w-md mx-auto mb-6 rounded-2xl border-2 border-purple-500/50 bg-gradient-to-br from-blue-950/60 to-purple-950/60 p-5 text-left">
            <span className="text-xs font-bold uppercase tracking-wider text-purple-300 bg-purple-500/20 px-2 py-1 rounded-full">Beta user?</span>
            <h3 className="text-lg font-bold text-white mt-2 mb-1">Already getting Mindy alerts? Set up your account.</h3>
            <p className="text-sm text-slate-300 mb-3">
              If you&apos;ve been getting our daily emails, you just need to set a password once.
            </p>
            <Link
              href={DASHBOARD_URL}
              className="inline-block w-full text-center px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg font-semibold text-sm transition-colors"
            >
              Set up my account →
            </Link>
          </div>

          <MindySignupForm />

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <Link
              href={CHECKOUT_MONTHLY}
              className="px-8 py-4 bg-white hover:bg-slate-100 text-purple-700 rounded-xl font-bold text-lg shadow-xl transition-all hover:scale-105"
            >
              Go Pro — $149/mo
            </Link>
            <span className="text-slate-500 hidden sm:inline">or</span>
            <Link
              href={CHECKOUT_ANNUAL}
              className="text-purple-400 hover:text-purple-300 font-semibold"
            >
              Save $298/yr with annual →
            </Link>
          </div>

          {/* LIVE-PROOF BAR — real, verified numbers (not vague claims). For a new
              brand, concrete scale + real usage substitutes for big-name logos. */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
            {[
              { n: '88,000+', l: 'opportunities tracked' },
              { n: '90,000+', l: 'archived solicitations searchable' },
              { n: '9,900+', l: 'contractors using Mindy' },
              { n: 'Daily 6 AM', l: 'fresh scan, before coffee' },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4">
                <div className="text-xl md:text-2xl font-extrabold text-white">{s.n}</div>
                <div className="mt-1 text-xs text-slate-400 leading-snug">{s.l}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-slate-500 text-xs">
            Built by <a href="https://govcongiants.org" className="text-purple-400 hover:text-purple-300">GovCon Giants</a> — trusted by thousands of small federal contractors.
          </p>

          {/* Already have access link */}
          <div className="mt-6">
            <Link
              href={DASHBOARD_URL}
              className="text-purple-400 hover:text-purple-300 text-sm"
            >
              Already have access? Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* WATCH MINDY WORK — three short capability demos. Show, don't tell. Swap the
          DemoMedia placeholders for real GIFs/screen-captures as they're produced. */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-3">See Mindy in action</h2>
        <p className="text-slate-400 text-center max-w-2xl mx-auto mb-10">
          Not screenshots of a pitch deck — the actual product, working on real federal data.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { cap: 'Know which ones are worth bidding', sub: 'Mindy reads each opportunity and tells you the signals that matter — competition, timing, and fit — so you stop guessing.', embed: DEMO_REELS[0] },
            { cap: 'Your daily briefing, before coffee', sub: 'The active solicitations that fit your business, delivered every morning — already filtered, ranked, and explained.', embed: DEMO_REELS[1] },
            { cap: 'Ask Mindy anything', sub: 'Your 24/7 market intelligence analyst — ask about opportunities, agencies, or competitors and get a straight answer.', embed: DEMO_REELS[2] },
          ].map((d) => (
            <div key={d.cap}>
              <DemoMedia embed={d.embed} caption={d.cap} aspect="reel" />
              <h3 className="mt-4 text-base font-bold text-white text-center">{d.cap}</h3>
              <p className="mt-1 text-sm text-slate-400 text-center">{d.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* EXPLORE FREE, NO LOGIN — surface the LIVE public pages (top boards,
          contractor directory, NAICS) as real, browsable proof + SEO entry points.
          A new brand earns trust by letting people USE the data before signing up. */}
      <section className="bg-slate-900/40 border-y border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-3">Explore the data — free, no login</h2>
          <p className="text-slate-400 text-center max-w-2xl mx-auto mb-6">
            Real federal market intelligence you can browse right now. No account needed.
          </p>

          {/* Real, live top-50 boards — concrete proof, each links to an actual page. */}
          <div className="flex flex-wrap justify-center gap-2 mb-10">
            {[
              { slug: '8a-contractors', label: 'Top 50 8(a) Contractors' },
              { slug: 'army-contractors', label: 'Top 50 Army Contractors' },
              { slug: 'air-force-contractors', label: 'Top 50 Air Force Contractors' },
              { slug: 'navy-contractors', label: 'Top 50 Navy Contractors' },
              { slug: 'va-contractors', label: 'Top 50 VA Contractors' },
              { slug: 'sdvosb-contractors', label: 'Top 50 SDVOSB Contractors' },
              { slug: 'hubzone-contractors', label: 'Top 50 HUBZone Contractors' },
              { slug: 'wosb-contractors', label: 'Top 50 WOSB Contractors' },
            ].map((b) => (
              <Link
                key={b.slug}
                href={`/top/${b.slug}`}
                className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-purple-500/60 hover:text-purple-300 transition-colors"
              >
                {b.label}
              </Link>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Link href="/top" className="group rounded-2xl border border-slate-700 bg-slate-800/40 p-6 hover:border-purple-500/60 transition-colors">
              <div className="text-2xl mb-3">🏆</div>
              <h3 className="text-lg font-bold text-white group-hover:text-purple-300">Top Contractor Boards</h3>
              <p className="mt-2 text-sm text-slate-400">61 leaderboards — top contractors by agency, NAICS, set-aside, and state. See who&apos;s winning.</p>
              <span className="mt-3 inline-block text-sm font-semibold text-purple-400">Browse the boards →</span>
            </Link>
            <Link href="/contractors" className="group rounded-2xl border border-slate-700 bg-slate-800/40 p-6 hover:border-purple-500/60 transition-colors">
              <div className="text-2xl mb-3">🏢</div>
              <h3 className="text-lg font-bold text-white group-hover:text-purple-300">Contractor Directory</h3>
              <p className="mt-2 text-sm text-slate-400">Look up any federal contractor — award history, top agencies, NAICS, and 5-year spend.</p>
              <span className="mt-3 inline-block text-sm font-semibold text-purple-400">Search contractors →</span>
            </Link>
            <Link href="/naics" className="group rounded-2xl border border-slate-700 bg-slate-800/40 p-6 hover:border-purple-500/60 transition-colors">
              <div className="text-2xl mb-3">📊</div>
              <h3 className="text-lg font-bold text-white group-hover:text-purple-300">NAICS Market Pages</h3>
              <p className="mt-2 text-sm text-slate-400">Market data for your industry code — spend, buyers, and competition at a glance.</p>
              <span className="mt-3 inline-block text-sm font-semibold text-purple-400">Explore your market →</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="max-w-4xl mx-auto px-4 py-20">
        <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-6">
          The Big Contractors Have Armies.<br />
          <span className="text-purple-400">You Have... Spreadsheets.</span>
        </h2>

        <div className="grid md:grid-cols-3 gap-6 mt-10">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-purple-400 mb-2">47</div>
            <p className="text-slate-300">People in Lockheed&apos;s BD department</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-purple-400 mb-2">$2M</div>
            <p className="text-slate-300">Booz Allen spends on market intel tools</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-purple-400 mb-2">You?</div>
            <p className="text-slate-300">Scrolling SAM.gov on Sunday nights</p>
          </div>
        </div>

        <div className="mt-10 bg-slate-800/30 border border-slate-700 rounded-xl p-8">
          <h3 className="text-xl font-bold text-white mb-4">The math doesn&apos;t work:</h3>
          <ul className="space-y-3 text-slate-300">
            <li className="flex items-center gap-3">
              <span className="text-red-400">•</span>
              <span><strong>1,500+</strong> new opportunities posted daily</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="text-red-400">•</span>
              <span><strong>15+</strong> government websites to monitor</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="text-red-400">•</span>
              <span><strong>$750 billion</strong> in annual federal spending</span>
            </li>
          </ul>
          <p className="mt-6 text-xl text-white font-semibold">
            No human can track it all. <span className="text-purple-400">But Mindy can.</span>
          </p>
        </div>
      </section>

      {/* What Mindy Does */}
      <section className="bg-slate-900/50 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            Everything a $150K Capture Manager Does.
          </h2>
          <p className="text-xl text-purple-400 text-center mb-12">
            For less than your coffee budget.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🔍</span>
                <h3 className="text-lg font-bold text-white">Find Opportunities</h3>
              </div>
              <p className="text-slate-300">
                Scans SAM.gov, Grants.gov, agency forecasts, and 10+ sources — every single day.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">📅</span>
                <h3 className="text-lg font-bold text-white">Know What&apos;s Coming</h3>
              </div>
              <p className="text-slate-300">
                Tracks 7,600+ forecasts so you&apos;re ready before it posts.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🏆</span>
                <h3 className="text-lg font-bold text-white">Track Competitors</h3>
              </div>
              <p className="text-slate-300">
                Shows who&apos;s winning in your space and when their contracts expire.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🎯</span>
                <h3 className="text-lg font-bold text-white">Never Miss Deadlines</h3>
              </div>
              <p className="text-slate-300">
                Personalized alerts based on YOUR NAICS codes and capabilities.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 md:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">📊</span>
                <h3 className="text-lg font-bold text-white">Understand the Market</h3>
              </div>
              <p className="text-slate-300">
                Weekly deep dives on spending patterns, set-asides, and trends in your space.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-4xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-white text-center mb-12">
          From Signup to Briefing in 3 Minutes
        </h2>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-purple-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-white">1</div>
            <h3 className="text-lg font-bold text-white mb-2">Tell Mindy About Your Business</h3>
            <p className="text-slate-400">Your NAICS codes, target agencies, set-aside status. Takes 2 minutes.</p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-purple-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-white">2</div>
            <h3 className="text-lg font-bold text-white mb-2">Wake Up to Intelligence</h3>
            <p className="text-slate-400">Every morning, Mindy delivers opportunities matched to YOUR profile.</p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-purple-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-white">3</div>
            <h3 className="text-lg font-bold text-white mb-2">Go Win Contracts</h3>
            <p className="text-slate-400">Spend your time on proposals, not searching. Mindy handles the hunting.</p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="bg-slate-900/50 py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">
            Finally, Enterprise Intelligence at Small Business Prices
          </h2>
          <p className="text-slate-400 text-center mb-12">
            The tagline says it all: The big contractors have armies. You have Mindy.
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Free */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8">
              <h3 className="text-xl font-bold text-white mb-2">Free</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-bold text-white">$0</span>
                <span className="text-slate-400">/mo</span>
              </div>
              <p className="text-slate-400 text-sm mb-6">Start finding opportunities today</p>

              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Daily opportunity digest</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>5 NAICS codes</span>
                </li>
                <li className="flex items-start gap-2 text-slate-500 text-sm">
                  <span className="mt-0.5">—</span>
                  <span>No AI analysis</span>
                </li>
              </ul>

              <Link
                href={FREE_SIGNUP_URL}
                className="block w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl text-center transition-colors"
              >
                Start Free
              </Link>
            </div>

            {/* Pro - Most Popular */}
            <div className="bg-gradient-to-br from-purple-900/50 to-slate-800 border-2 border-purple-500 rounded-2xl p-8 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-purple-500 text-white text-xs font-bold px-4 py-1 rounded-full">MOST POPULAR</span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Pro</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-bold text-white">$149</span>
                <span className="text-slate-400">/mo</span>
              </div>
              <p className="text-purple-300 text-sm mb-6">The $150K capture manager in your pocket</p>

              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Full daily briefings with AI analysis</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Unlimited NAICS codes</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Competitor tracking</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Recompete alerts</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Weekly deep dives</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Pursuit briefs</span>
                </li>
              </ul>

              <Link
                href={CHECKOUT_MONTHLY}
                className="block w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-center transition-colors shadow-lg shadow-purple-500/25"
              >
                Get Mindy Pro
              </Link>
            </div>

            {/* Teams */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8">
              <h3 className="text-xl font-bold text-white mb-2">Teams</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-bold text-white">$499</span>
                <span className="text-slate-400">/mo</span>
              </div>
              <p className="text-slate-400 text-sm mb-6">For growing contractors with BD teams</p>

              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Everything in Pro</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Multiple users</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Shared pipeline</span>
                </li>
                <li className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Team dashboard</span>
                </li>
              </ul>

              <Link
                href="mailto:hello@getmindy.ai?subject=Mindy%20Teams%20Inquiry"
                className="block w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl text-center transition-colors"
              >
                Contact Sales
              </Link>
            </div>
          </div>

          {/* Annual Option */}
          <div className="mt-8 bg-slate-800/50 border border-purple-500/30 rounded-xl p-6 text-center">
            <p className="text-white font-medium mb-2">
              <span className="text-purple-400">Save $298</span> with annual billing
            </p>
            <p className="text-slate-400 text-sm mb-4">
              Pay $1,490/year instead of $1,788 (2 months free)
            </p>
            <Link
              href={CHECKOUT_ANNUAL}
              className="inline-block px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold transition-colors"
            >
              Get Annual Plan
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="max-w-3xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-white text-center mb-12">
          Questions? Mindy Has Answers.
        </h2>

        <div className="space-y-6">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">How is this different from SAM.gov alerts?</h3>
            <p className="text-slate-300">
              SAM.gov sends you everything that matches a keyword. Mindy learns your business and sends you
              what actually matters — with context on competition, incumbents, and why this opportunity fits you.
            </p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">I already have a BD person. Why do I need Mindy?</h3>
            <p className="text-slate-300">
              Mindy doesn&apos;t replace your BD team — she supercharges them. She handles the 20 hours/week
              of searching so your people can focus on relationships and proposals.
            </p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">What if I&apos;m brand new to federal contracting?</h3>
            <p className="text-slate-300">
              Perfect. Mindy explains opportunities in plain English and tells you exactly what you
              need to compete. She&apos;s like having a mentor who never sleeps.
            </p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">Can Mindy help me write proposals?</h3>
            <p className="text-slate-300">
              Not yet — but she&apos;ll tell you which opportunities are worth writing proposals for.
              That&apos;s half the battle.
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            The Big Contractors Won&apos;t Share Their Secrets.
            <span className="text-purple-400 block mt-2">Mindy Will.</span>
          </h2>
          <p className="text-xl text-slate-300 mb-8">
            Every day you&apos;re searching manually is a day you&apos;re falling behind.
            The contractors winning federal work aren&apos;t smarter than you — they just have better intelligence.
          </p>
          <p className="text-2xl text-white font-semibold mb-8">
            Now you do too.
          </p>

          <Link
            href={FREE_SIGNUP_URL}
            className="inline-block px-10 py-4 bg-white hover:bg-slate-100 text-purple-700 rounded-xl font-bold text-lg shadow-xl transition-all hover:scale-105"
          >
            Meet Mindy — Get Your First Briefing Free
          </Link>
        </div>
      </section>

      {/* Footer - Clean Mindy branding */}
      <footer className="border-t border-slate-800 py-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span className="text-white font-semibold">Mindy</span>
          </div>
          <p className="text-slate-500 text-sm mb-4">
            <a href="tel:7864770477" className="text-slate-400 hover:text-white transition">786-477-0477</a>
            <span className="mx-4">•</span>
            <a href="mailto:hello@getmindy.ai" className="text-slate-400 hover:text-white transition">hello@getmindy.ai</a>
            <span className="mx-4">•</span>
            <Link href="/privacy-policy" className="text-slate-400 hover:text-white transition">Privacy</Link>
            <span className="mx-4">•</span>
            <Link href="/terms" className="text-slate-400 hover:text-white transition">Terms</Link>
          </p>
          <p className="text-slate-600 text-xs">
            © 2026 Mindy AI
          </p>
          <p className="text-slate-700 text-xs mt-2 italic">
            &quot;The big contractors have armies. You have Mindy.&quot;
          </p>
        </div>
      </footer>
    </main>
  );
}

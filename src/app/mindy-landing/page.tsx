import Link from 'next/link';
import type { Metadata } from 'next';
import { MindySignupForm } from '@/components/mindy/MindySignupForm';
import { MindyDayBar } from '@/components/mindy/MindyDayBar';
import { MindyLogo } from '@/components/mindy/MindyLogo';

// Route paid CTAs through /checkout first so purchase attribution (UTM /
// referrer captured pre-checkout) is joined to the Stripe purchase event.
const CHECKOUT_MONTHLY = '/checkout/mindy-pro-monthly'; // $149/mo
const CHECKOUT_ANNUAL = '/checkout/mindy-pro-annual';   // $1,490/yr
const FREE_SIGNUP_URL = '/signup';
const DASHBOARD_URL = '/app';

/**
 * ⚠️ APEX RELEASED 2026-08-24 (homepage cutover). This page has NO metadata export of its own,
 * so it INHERITED `alternates.canonical: "/"` from the root layout — correct while it WAS the
 * homepage, wrong the moment `/` began serving Today's Intel. Two pages both claiming
 * https://getmindy.ai/ makes Google pick one, and a homepage that canonicals away to a subpath
 * tells it the apex is not the real page.
 *
 * This page is now ROLLBACK INSURANCE, not a competing homepage: still directly reachable,
 * deliberately NOT deleted, and pointing at itself.
 */
export const metadata: Metadata = {
  alternates: { canonical: '/mindy-landing' },
};

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
        sameAs: ['https://govcongiants.com'],
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
    <main className="min-h-screen bg-ground-deep">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* TOP ANNOUNCEMENT BAR — Mindy Day, the live product unveil (renamed from
          "Bootcamp"; training→tools). Pinned above the hero so every arrival sees it.
          Dismissible (× → localStorage); links to the GovCon Giants registration page. */}
      <MindyDayBar />

      {/* TOP NAV — the enterprise-SaaS pattern. Researched 2026-07-27 against Gong,
          Datadog, HubSpot and HigherGov (the closest direct competitor): 4 of 4 put
          SIGN IN as a small nav link, never a login form in the hero, and 4 of 4 lead
          with the value proposition + two CTAs.
          The homepage previously had NO nav at all and gave half the hero to a login
          card — a login screen wearing a homepage's clothes. A returning user knows to
          look top-right; a stranger evaluating the product needs Product/Pricing/proof. */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <nav className="max-w-6xl mx-auto flex items-center gap-6 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <MindyLogo size={32} />
            <span className="font-semibold text-white">Mindy</span>
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm text-ink-soft">
            <a href="#product" className="hover:text-white transition-colors">Product</a>
            <a href="#explore" className="hover:text-white transition-colors">Explore free</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            {/* Real route (not a #anchor) — the Mindy Institute's public research front door.
                A credibility signal for a stranger evaluating the product. */}
            <Link href="/research" className="hover:text-white transition-colors">Research</Link>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Link href={DASHBOARD_URL} className="text-sm font-medium text-ink-soft hover:text-white transition-colors">
              Sign in
            </Link>
            <Link
              href={FREE_SIGNUP_URL}
              className="rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              Start free
            </Link>
          </div>
        </nav>
      </header>

      {/* HERO — value proposition + two CTAs + the real product. No login form: that
          moved to the nav (see above). Primary CTA is "Start free", NOT "Go Pro —
          $149/mo"; HigherGov leads with Demo/Free Trial, and asking a stranger for a
          card before showing value is the wrong order. Paid CTAs live in the pricing
          section further down. */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 tracking-tight">
            Win more federal contracts.
          </h1>
          <p className="text-lg md:text-xl text-ink-soft max-w-2xl mx-auto mb-8">
            Mindy scans 88,000+ federal opportunities every night, tracks your competitors,
            and delivers a personalized briefing before your first coffee.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-4">
            <Link
              href={FREE_SIGNUP_URL}
              className="px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-900/40 transition-all"
            >
              Start free
            </Link>
            <a
              href="#product"
              className="px-8 py-4 rounded-xl border border-white/20 hover:border-white/40 text-white font-semibold text-lg transition-colors"
            >
              See it in action
            </a>
          </div>
          <p className="text-sm text-faint mb-12">Free forever · No credit card required</p>

          {/* PRODUCT VISUAL in the hero — the real thing on real federal data. Every
              competitor either shows the product or a concrete data visual; this page
              previously showed neither. */}
          <div className="relative aspect-video overflow-hidden rounded-2xl border border-purple-500/30 shadow-2xl shadow-purple-900/40">
            <iframe
              src="https://player.vimeo.com/video/1217687110?badge=0&autopause=0&player_id=0&app_id=122963"
              className="absolute inset-0 h-full w-full"
              allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
              allowFullScreen
              title="Meet Mindy — MCP Connector teaser"
            />
          </div>

          {/* THE TWO REAL PRODUCT CAPTURES — the same assets now on the launch page.
              The hero video SAYS what Mindy does; these SHOW it on live federal data:
              agency/value filters over 6,495 opportunities, then a single opportunity
              with its M-Estimate, named incumbent and contract history.

              MP4 not GIF: the sources were 14 MB EACH; h264 is ~87% smaller with no
              visible loss. autoplay+muted+loop+playsinline behaves exactly like a GIF,
              and iOS autoplays ONLY when muted AND playsinline are both present.
              Square (1:1) because the captures are square — no crop, no letterbox. */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[
              {
                src: '/demo/mindy-map-filters.mp4',
                poster: '/demo/mindy-map-filters.jpg',
                title: 'Find your market on the map',
                copy: 'Filter live opportunities by agency, value and horizon — real federal data, not a mockup.',
              },
              {
                src: '/demo/mindy-opportunity-detail.mp4',
                poster: '/demo/mindy-opportunity-detail.jpg',
                title: 'Work a single opportunity',
                copy: 'Scope of work, the named contracting officer, and the primes already winning it.',
              },
            ].map((d) => (
              <div key={d.src} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="relative w-full" style={{ paddingBottom: '100%' }}>
                  <video
                    src={d.src}
                    poster={d.poster}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
                <div className="p-4 text-left">
                  <h3 className="text-sm font-bold text-white">{d.title}</h3>
                  <p className="mt-1 text-xs text-muted leading-snug">{d.copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="max-w-4xl mx-auto text-center">

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
                <div className="mt-1 text-xs text-muted leading-snug">{s.l}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-faint text-xs">
            Built by <a href="https://govcongiants.com" className="text-purple-400 hover:text-purple-300">GovCon Giants</a> — trusted by thousands of small federal contractors.
          </p>

          {/* Already have access link + password recovery (was missing on the home page — a
              locked-out user had no way to reset from here). */}
          <div className="mt-6 flex items-center justify-center gap-4 text-sm">
            <Link
              href={DASHBOARD_URL}
              className="text-purple-400 hover:text-purple-300"
            >
              Already have access? Sign in
            </Link>
            <span className="text-slate-600">·</span>
            <Link
              href="/forgot-password"
              className="text-slate-400 hover:text-slate-300"
            >
              Forgot password?
            </Link>
          </div>
        </div>
      </section>

      {/* CREATE ACCOUNT / SIGN IN — the form still has a home, just not in the hero.
          The demo video that used to live here was PROMOTED into the hero (a stranger
          should see the product without scrolling), so this slot became the signup
          block: nav "Start free" and the hero CTA both anchor here. */}
      <section id="product" className="max-w-md mx-auto px-4 py-16 scroll-mt-20">
        <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-3">Get your first briefing free</h2>
        <p className="text-muted text-center mb-8">
          No credit card. Your first personalized federal briefing lands tomorrow morning.
        </p>
        <MindySignupForm />
      </section>

      {/* EXPLORE FREE, NO LOGIN — surface the LIVE public pages (top boards,
          contractor directory, NAICS) as real, browsable proof + SEO entry points.
          A new brand earns trust by letting people USE the data before signing up. */}
      <section id="explore" className="bg-ground/40 border-y border-surface scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-3">Explore the data — free, no login</h2>
          <p className="text-muted text-center max-w-2xl mx-auto mb-6">
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
                className="rounded-full border border-hairline bg-surface/60 px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-purple-500/60 hover:text-purple-300 transition-colors"
              >
                {b.label}
              </Link>
            ))}
          </div>

          {/* Discover hub — the front door to the shareable data feeds. */}
          <Link href="/discover" className="group mb-6 block rounded-2xl border border-purple-500/40 bg-gradient-to-br from-purple-900/30 to-surface/40 p-6 hover:border-purple-500/70 transition-colors">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-2xl mb-2">🧭</div>
                <h3 className="text-xl font-bold text-white group-hover:text-purple-300">Discover — the federal market, decoded</h3>
                <p className="mt-2 text-sm text-muted max-w-2xl">The biggest recent contracts, contracts coming up for grabs, the weirdest awards the government actually bought, and the top contractors ranked — all free, all verifiable.</p>
              </div>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-purple-300">
                <span className="rounded-full border border-hairline px-3 py-1">⏳ Up For Grabs</span>
                <span className="rounded-full border border-hairline px-3 py-1">🧐 Weird Awards</span>
                <span className="text-purple-400">Explore →</span>
              </span>
            </div>
          </Link>

          <div className="grid md:grid-cols-3 gap-6">
            <Link href="/top" className="group rounded-2xl border border-hairline bg-surface/40 p-6 hover:border-purple-500/60 transition-colors">
              <div className="text-2xl mb-3">🏆</div>
              <h3 className="text-lg font-bold text-white group-hover:text-purple-300">Top Contractor Boards</h3>
              <p className="mt-2 text-sm text-muted">61 leaderboards — top contractors by agency, NAICS, set-aside, and state. See who&apos;s winning.</p>
              <span className="mt-3 inline-block text-sm font-semibold text-purple-400">Browse the boards →</span>
            </Link>
            <Link href="/contractors" className="group rounded-2xl border border-hairline bg-surface/40 p-6 hover:border-purple-500/60 transition-colors">
              <div className="text-2xl mb-3">🏢</div>
              <h3 className="text-lg font-bold text-white group-hover:text-purple-300">Contractor Directory</h3>
              <p className="mt-2 text-sm text-muted">Look up any federal contractor — award history, top agencies, NAICS, and 5-year spend.</p>
              <span className="mt-3 inline-block text-sm font-semibold text-purple-400">Search contractors →</span>
            </Link>
            <Link href="/naics" className="group rounded-2xl border border-hairline bg-surface/40 p-6 hover:border-purple-500/60 transition-colors">
              <div className="text-2xl mb-3">📊</div>
              <h3 className="text-lg font-bold text-white group-hover:text-purple-300">NAICS Market Pages</h3>
              <p className="mt-2 text-sm text-muted">Market data for your industry code — spend, buyers, and competition at a glance.</p>
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
          <div className="bg-surface/50 border border-hairline rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-purple-400 mb-2">47</div>
            <p className="text-ink-soft">People in Lockheed&apos;s BD department</p>
          </div>
          <div className="bg-surface/50 border border-hairline rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-purple-400 mb-2">$2M</div>
            <p className="text-ink-soft">Booz Allen spends on market intel tools</p>
          </div>
          <div className="bg-surface/50 border border-hairline rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-purple-400 mb-2">You?</div>
            <p className="text-ink-soft">Scrolling SAM.gov on Sunday nights</p>
          </div>
        </div>

        <div className="mt-10 bg-surface/30 border border-hairline rounded-xl p-8">
          <h3 className="text-xl font-bold text-white mb-4">The math doesn&apos;t work:</h3>
          <ul className="space-y-3 text-ink-soft">
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
      <section className="bg-ground/50 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            Everything a $150K Capture Manager Does.
          </h2>
          <p className="text-xl text-purple-400 text-center mb-12">
            For less than your coffee budget.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-surface border border-hairline rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🔍</span>
                <h3 className="text-lg font-bold text-white">Find Opportunities</h3>
              </div>
              <p className="text-ink-soft">
                Scans SAM.gov, Grants.gov, agency forecasts, and 10+ sources — every single day.
              </p>
            </div>

            <div className="bg-surface border border-hairline rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">📅</span>
                <h3 className="text-lg font-bold text-white">Know What&apos;s Coming</h3>
              </div>
              <p className="text-ink-soft">
                Tracks 33,000+ forecasts so you&apos;re ready before it posts.
              </p>
            </div>

            <div className="bg-surface border border-hairline rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🏆</span>
                <h3 className="text-lg font-bold text-white">Track Competitors</h3>
              </div>
              <p className="text-ink-soft">
                Shows who&apos;s winning in your space and when their contracts expire.
              </p>
            </div>

            <div className="bg-surface border border-hairline rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🎯</span>
                <h3 className="text-lg font-bold text-white">Never Miss Deadlines</h3>
              </div>
              <p className="text-ink-soft">
                Personalized alerts based on YOUR NAICS codes and capabilities.
              </p>
            </div>

            <div className="bg-surface border border-hairline rounded-xl p-6 md:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">📊</span>
                <h3 className="text-lg font-bold text-white">Understand the Market</h3>
              </div>
              <p className="text-ink-soft">
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
            <p className="text-muted">Your NAICS codes, target agencies, set-aside status. Takes 2 minutes.</p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-purple-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-white">2</div>
            <h3 className="text-lg font-bold text-white mb-2">Wake Up to Intelligence</h3>
            <p className="text-muted">Every morning, Mindy delivers opportunities matched to YOUR profile.</p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-purple-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-white">3</div>
            <h3 className="text-lg font-bold text-white mb-2">Go Win Contracts</h3>
            <p className="text-muted">Spend your time on proposals, not searching. Mindy handles the hunting.</p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="bg-ground/50 py-20 px-4 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">
            Finally, Enterprise Intelligence at Small Business Prices
          </h2>
          <p className="text-muted text-center mb-12">
            The tagline says it all: The big contractors have armies. You have Mindy.
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Free */}
            <div className="bg-surface border border-hairline rounded-2xl p-8">
              <h3 className="text-xl font-bold text-white mb-2">Free</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-bold text-white">$0</span>
                <span className="text-muted">/mo</span>
              </div>
              <p className="text-muted text-sm mb-6">Start finding opportunities today</p>

              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2 text-ink-soft text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Daily opportunity digest</span>
                </li>
                <li className="flex items-start gap-2 text-ink-soft text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>5 NAICS codes</span>
                </li>
                <li className="flex items-start gap-2 text-faint text-sm">
                  <span className="mt-0.5">—</span>
                  <span>No AI analysis</span>
                </li>
              </ul>

              <Link
                href={FREE_SIGNUP_URL}
                className="block w-full py-3 bg-input hover:bg-slate-600 text-white font-semibold rounded-xl text-center transition-colors"
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
                <span className="text-muted">/mo</span>
              </div>
              <p className="text-purple-300 text-sm mb-6">The $150K capture manager in your pocket</p>

              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2 text-ink-soft text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Full daily briefings with AI analysis</span>
                </li>
                <li className="flex items-start gap-2 text-ink-soft text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Unlimited NAICS codes</span>
                </li>
                <li className="flex items-start gap-2 text-ink-soft text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Competitor tracking</span>
                </li>
                <li className="flex items-start gap-2 text-ink-soft text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Recompete alerts</span>
                </li>
                <li className="flex items-start gap-2 text-ink-soft text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Weekly deep dives</span>
                </li>
                <li className="flex items-start gap-2 text-ink-soft text-sm">
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
            <div className="bg-surface border border-hairline rounded-2xl p-8">
              <h3 className="text-xl font-bold text-white mb-2">Teams</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-bold text-white">$499</span>
                <span className="text-muted">/mo</span>
              </div>
              <p className="text-muted text-sm mb-6">For growing contractors with BD teams</p>

              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2 text-ink-soft text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Everything in Pro</span>
                </li>
                <li className="flex items-start gap-2 text-ink-soft text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Multiple users</span>
                </li>
                <li className="flex items-start gap-2 text-ink-soft text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Shared pipeline</span>
                </li>
                <li className="flex items-start gap-2 text-ink-soft text-sm">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Team dashboard</span>
                </li>
              </ul>

              <Link
                href="mailto:hello@getmindy.ai?subject=Mindy%20Teams%20Inquiry"
                className="block w-full py-3 bg-input hover:bg-slate-600 text-white font-semibold rounded-xl text-center transition-colors"
              >
                Contact Sales
              </Link>
            </div>
          </div>

          {/* Annual Option */}
          <div className="mt-8 bg-surface/50 border border-purple-500/30 rounded-xl p-6 text-center">
            <p className="text-white font-medium mb-2">
              <span className="text-purple-400">Save $298</span> with annual billing
            </p>
            <p className="text-muted text-sm mb-4">
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
      <section id="faq" className="max-w-3xl mx-auto px-4 py-20 scroll-mt-20">
        <h2 className="text-3xl font-bold text-white text-center mb-12">
          Questions? Mindy Has Answers.
        </h2>

        <div className="space-y-6">
          <div className="bg-surface border border-hairline rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">How is this different from SAM.gov alerts?</h3>
            <p className="text-ink-soft">
              SAM.gov sends you everything that matches a keyword. Mindy learns your business and sends you
              what actually matters — with context on competition, incumbents, and why this opportunity fits you.
            </p>
          </div>

          <div className="bg-surface border border-hairline rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">I already have a BD person. Why do I need Mindy?</h3>
            <p className="text-ink-soft">
              Mindy doesn&apos;t replace your BD team — she supercharges them. She handles the 20 hours/week
              of searching so your people can focus on relationships and proposals.
            </p>
          </div>

          <div className="bg-surface border border-hairline rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">What if I&apos;m brand new to federal contracting?</h3>
            <p className="text-ink-soft">
              Perfect. Mindy explains opportunities in plain English and tells you exactly what you
              need to compete. She&apos;s like having a mentor who never sleeps.
            </p>
          </div>

          <div className="bg-surface border border-hairline rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">Can Mindy help me write proposals?</h3>
            <p className="text-ink-soft">
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
          <p className="text-xl text-ink-soft mb-8">
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
      <footer className="border-t border-surface py-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span className="text-white font-semibold">Mindy</span>
          </div>
          <p className="text-faint text-sm mb-4">
            <a href="tel:5082906692" className="text-muted hover:text-white transition">508-290-6692</a>
            <span className="mx-4">•</span>
            <a href="mailto:hello@getmindy.ai" className="text-muted hover:text-white transition">hello@getmindy.ai</a>
            <span className="mx-4">•</span>
            <Link href="/research" className="text-muted hover:text-white transition">Research</Link>
            <span className="mx-4">•</span>
            <Link href="/privacy-policy" className="text-muted hover:text-white transition">Privacy</Link>
            <span className="mx-4">•</span>
            <Link href="/terms" className="text-muted hover:text-white transition">Terms</Link>
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

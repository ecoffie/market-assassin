/**
 * /set-asides/8a — 8(a) Business Development set-aside opportunities.
 *
 * Target keywords: "8a contracts", "8(a) set-aside opportunities",
 * "find 8(a) contracts". These are extremely high-intent searches:
 * the user is certified or about to be and is looking for active work
 * RIGHT NOW. Page intent is opportunities + strategy, not how-to-certify
 * (we link to glossary for the definition and assume the user knows
 * the program exists).
 *
 * The 8(a) program is the most powerful set-aside in federal contracting:
 * - Sole-source authority up to $4.5M services / $8M manufacturing
 * - Nine-year development period with mentor-protege joint ventures
 * - Roughly $35–40B awarded annually (per SBA reports; we frame without
 *   citing a number because the figure moves year to year and we can't
 *   verify a current FY without a fresh data pull).
 *
 * Schema: shared Organization @id, GovernmentService for the program,
 * BreadcrumbList, FAQPage.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '8(a) Contract Opportunities — Federal Set-Aside Alerts | Mindy',
  description:
    'Daily 8(a) set-aside opportunities from SAM.gov, agency forecasts, and recompetes. Free alerts for certified 8(a) firms — including sole-source intel.',
  alternates: {
    canonical: 'https://getmindy.ai/set-asides/8a',
  },
  keywords: [
    '8a contracts',
    '8(a) set-aside opportunities',
    '8a contract opportunities',
    'find 8a contracts',
    '8a sole source',
    '8(a) program contracts',
    'sba 8a contracts',
  ],
  openGraph: {
    title: '8(a) Contract Opportunities — Daily Set-Aside Alerts | Mindy',
    description:
      'Mindy filters SAM.gov, agency forecasts, and recompetes for 8(a) set-asides — including sole-source awards under $4.5M most firms never see.',
    type: 'website',
    url: 'https://getmindy.ai/set-asides/8a',
  },
};

const faqs = [
  {
    q: 'How do I find 8(a) contracts on SAM.gov?',
    a: 'SAM.gov has a set-aside filter on its opportunities search. Choose "8(a) Competed" or "8(a) Sole Source" under set-aside type. The hard part is that the filter is keyword-blind — you still have to scroll through every result to see which ones fit your NAICS codes and capabilities. Mindy applies the 8(a) filter automatically and only shows you opportunities matched to your NAICS profile.',
  },
  {
    q: 'What\'s the difference between 8(a) sole-source and 8(a) competed?',
    a: 'Sole-source means the contracting officer is awarding the contract to a single 8(a) firm without competition — allowed up to $4.5M for services and $8M for manufacturing. 8(a) competed means the procurement is restricted to 8(a) firms but multiple companies bid. Sole-source is faster, has no competition, and is the single biggest reason to pursue 8(a) certification — but you have to build the agency relationship before the CO will write the J&A justifying a sole-source to you specifically.',
  },
  {
    q: 'Do 8(a) sole-source awards show up on SAM.gov?',
    a: 'Sometimes — sole-source awards are required to be publicly noticed, but the notice often appears only as an award announcement (after the fact), not as a competitive solicitation you can respond to. To find sole-source opportunities before they\'re awarded, you need to track agency forecasts, talk to OSDBU offices, and respond aggressively to Sources Sought notices. Mindy aggregates 7,600+ agency forecasts and surfaces Sources Sought separately for exactly this reason.',
  },
  {
    q: 'What agencies award the most 8(a) contracts?',
    a: 'DoD (especially Army and Navy), DHS, GSA, HHS, and Treasury are consistently among the top 8(a) awarding agencies. DoD alone accounts for a large share of 8(a) spending because of the volume of IT services and base operations work it competes through 8(a) STARS III and similar vehicles. But every federal agency has 8(a) goals — even small agencies you\'ve never heard of can be excellent targets because they get less BD attention from large 8(a) primes.',
  },
  {
    q: 'How long does the 8(a) program last?',
    a: 'Nine years total, broken into a 4-year "developmental" stage and a 5-year "transitional" stage. The developmental stage is for building the business; the transitional stage requires you to win an increasing percentage of revenue from non-8(a) sources. You can only be 8(a) certified once — when your nine years are up, you graduate, and you can\'t reapply. The clock is real, which is why most successful 8(a) firms pursue mentor-protege joint ventures early to maximize the runway.',
  },
  {
    q: 'Can I bid on 8(a) contracts if I\'m not 8(a) certified?',
    a: 'No. 8(a) set-asides are restricted to certified 8(a) firms only. If you\'re not certified, you can\'t bid. You can, however, subcontract to an 8(a) prime, or teach as a mentor in the SBA Mentor-Protege Program if you qualify as a large business. If you think you might qualify for 8(a), apply through certify.SBA.gov — the process takes 3–6 months.',
  },
  {
    q: 'What is the 8(a) Mentor-Protege Program?',
    a: 'A formal SBA program that pairs a large business mentor with an 8(a) protege. Once approved, the two can form a joint venture and bid on 8(a) set-asides as a single entity — including contracts the protege couldn\'t qualify for alone. This is the single biggest growth lever inside the 8(a) program. Most large primes (Booz Allen, Leidos, SAIC, etc.) have active mentor-protege agreements; finding the right mentor is often a referral game.',
  },
];

export default function EightAPage() {
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
        description:
          'AI-powered federal market intelligence for small business contractors.',
        email: 'hello@getmindy.ai',
        sameAs: ['https://govcongiants.org'],
      },
      {
        '@type': 'GovernmentService',
        name: '8(a) Business Development Program',
        serviceType: 'Federal Set-Aside Program',
        provider: {
          '@type': 'GovernmentOrganization',
          name: 'U.S. Small Business Administration',
          url: 'https://www.sba.gov/federal-contracting/contracting-assistance-programs/8a-business-development-program',
        },
        audience: {
          '@type': 'Audience',
          audienceType:
            'Socially and economically disadvantaged small businesses certified by the SBA',
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://getmindy.ai' },
          { '@type': 'ListItem', position: 2, name: 'Set-Asides', item: 'https://getmindy.ai/set-asides' },
          { '@type': 'ListItem', position: 3, name: '8(a)', item: 'https://getmindy.ai/set-asides/8a' },
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

      {/* Breadcrumb */}
      <nav className="max-w-4xl mx-auto px-4 pt-6 text-sm text-slate-500">
        <Link href="/" className="hover:text-purple-300">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/set-asides" className="hover:text-purple-300">Set-Asides</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-300">8(a)</span>
      </nav>

      {/* Hero */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-full mb-6">
            <span className="text-purple-300 text-sm font-semibold uppercase tracking-wide">
              8(a) Business Development
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
            8(a) Set-Aside<br />
            <span className="text-purple-400">Contract Opportunities</span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto mb-8">
            The 8(a) program is the only federal set-aside with sole-source authority
            up to $4.5M for services and $8M for manufacturing — meaning a contracting
            officer can award you the contract without competition. Mindy surfaces
            every 8(a) opportunity SAM.gov posts and tracks the agency forecasts where
            the next sole-source is brewing.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-500/30 transition-all hover:scale-105"
          >
            Get Free 8(a) Opportunity Alerts
          </Link>
          <p className="text-slate-500 text-sm mt-4">First briefing lands tomorrow morning.</p>
        </div>
      </section>

      {/* Who qualifies */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Who Qualifies for 8(a)
          </h2>
          <p className="text-slate-300 mb-4">
            The 8(a) Business Development Program is for small businesses that are
            unconditionally owned and controlled by individuals who are both <em>socially</em>{' '}
            and <em>economically</em> disadvantaged. SBA presumes certain groups are
            socially disadvantaged; others must prove it through narrative evidence.
          </p>
          <ul className="space-y-3 text-slate-300">
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">51%+ ownership</strong> by socially and economically disadvantaged U.S. citizens.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">Economic disadvantage thresholds:</strong> personal net worth under $850K (initial entry), adjusted gross income averaging under $400K, and total assets under $6.5M.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">Small business size standards</strong> for your primary NAICS code.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">Two years of operating history</strong> (a waiver is possible if you can demonstrate management experience and capital).</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">Good character</strong> — SBA reviews for federal debt, criminal history, and tax compliance.</span>
            </li>
          </ul>
          <p className="text-slate-400 text-sm mt-4">
            Source: SBA, <a className="underline hover:text-purple-300" href="https://www.sba.gov/federal-contracting/contracting-assistance-programs/8a-business-development-program/8a-business-development-program-eligibility-requirements" target="_blank" rel="noopener noreferrer">8(a) Program Eligibility Requirements</a>.
          </p>
        </div>
      </section>

      {/* Where opportunities post */}
      <section className="bg-slate-900/50 py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Where 8(a) Opportunities Actually Live
          </h2>
          <p className="text-slate-300 mb-6">
            Most 8(a) work doesn&apos;t look like a normal RFP. The biggest opportunities
            are sole-source — awarded without ever being competed — which means
            scrolling SAM.gov for solicitations is the slowest way to find them.
            Here&apos;s where to look:
          </p>
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">SAM.gov set-aside filter</h3>
              <p className="text-slate-400 text-sm">
                Filter opportunities by &ldquo;8(a) Competed&rdquo; and &ldquo;8(a) Sole Source.&rdquo; The
                sole-source filter often returns award announcements rather than open
                solicitations, but it reveals which agencies are using the authority.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Agency forecasts</h3>
              <p className="text-slate-400 text-sm">
                Every federal agency publishes a forecast of upcoming procurements with
                anticipated set-aside type. 8(a) forecasts are the earliest indicator
                of a sole-source brewing 6–18 months out. Mindy aggregates 7,600+
                forecasts in one feed.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">8(a) STARS III and 8(a)-only vehicles</h3>
              <p className="text-slate-400 text-sm">
                If you&apos;re on the GSA-managed 8(a) STARS III GWAC, task orders compete
                only among holders. The vehicle itself recompetes every several years,
                so getting on is the leverage point.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Sources Sought + RFI responses</h3>
              <p className="text-slate-400 text-sm">
                Sources Sought is the agency asking &ldquo;is there a qualified 8(a) for this?&rdquo;
                Your response is what convinces the CO to set it aside for 8(a) at all.
                Two strong Sources Sought responses are worth more than ten RFP submissions.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Top agencies */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Top Agencies Awarding 8(a) Contracts
          </h2>
          <p className="text-slate-300 mb-6">
            Every federal agency has small-business goals that include an 8(a)
            component, but a handful of agencies drive the lion&apos;s share of 8(a)
            awards. These are the highest-volume targets:
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { name: 'Department of Defense (Army, Navy, Air Force)', why: 'Largest federal buyer; 8(a) STARS III, OASIS+, and base-ops set-asides drive billions in annual 8(a) volume.' },
              { name: 'Department of Homeland Security', why: 'CBP, ICE, TSA, and FEMA actively use 8(a) for IT services, logistics, and professional services.' },
              { name: 'General Services Administration', why: 'Manages 8(a) STARS III and uses 8(a) heavily for its own facility and tech procurements.' },
              { name: 'Department of Health and Human Services', why: 'NIH, CDC, and CMS are heavy 8(a) IT services buyers. CIO-SP4 is a key vehicle.' },
              { name: 'Department of the Treasury', why: 'IRS modernization work is a long-running 8(a) pipeline.' },
            ].map((a) => (
              <div key={a.name} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-1">{a.name}</h3>
                <p className="text-slate-400 text-sm">{a.why}</p>
              </div>
            ))}
          </div>
          <p className="text-slate-400 text-sm mt-6 italic">
            Don&apos;t sleep on smaller agencies. They have 8(a) goals too and far less
            competition from established primes — often the fastest path to a first
            sole-source.
          </p>
        </div>
      </section>

      {/* Strategy */}
      <section className="bg-slate-900/50 py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            How to Win 8(a) Contracts: 6 Tactics That Actually Work
          </h2>
          <div className="space-y-5">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">1. Build the sole-source case before the requirement exists</h3>
              <p className="text-slate-400 text-sm">
                Sole-source awards happen because a CO knows you can do the work and
                writes a J&amp;A justifying you specifically. That requires capability
                briefings, relationship-building with OSDBU, and capture work that
                starts 6–12 months before any solicitation. Don&apos;t wait for a posting.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">2. Pursue mentor-protege early</h3>
              <p className="text-slate-400 text-sm">
                The SBA Mentor-Protege Program lets you joint-venture with a large
                business and bid on 8(a) work you couldn&apos;t qualify for alone. Your
                nine-year clock is finite — start mentor-protege conversations in
                year 1 or 2, not year 7.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">3. Get on the right 8(a) vehicles</h3>
              <p className="text-slate-400 text-sm">
                8(a) STARS III is the obvious one for IT. But there are dozens of
                agency-specific 8(a) IDIQs (Army ITES-3S, Navy SeaPort task orders
                with 8(a) set-asides, etc.). Vehicle holders see task orders nobody
                else sees.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">4. Respond to every Sources Sought in your NAICS</h3>
              <p className="text-slate-400 text-sm">
                The CO uses Sources Sought responses to justify the set-aside type.
                If two qualified 8(a)s respond, the procurement gets set aside as
                8(a). If only large businesses respond, you lose the set-aside
                before the RFP even drops.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">5. Track the clock — and the transition</h3>
              <p className="text-slate-400 text-sm">
                Years 6–9 of the program require a rising share of non-8(a) revenue
                to graduate successfully. Start chasing full-and-open, GSA Schedule,
                and unrestricted small-business set-asides early. Mindy filters by
                set-aside type so you can build that mix deliberately.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">6. Track recompetes where the incumbent is also 8(a)</h3>
              <p className="text-slate-400 text-sm">
                When an 8(a) incumbent&apos;s contract is expiring, the recompete will
                almost always be re-set aside as 8(a). Knowing 12 months in advance
                gives you time to build a relationship before the solicitation drops.
                Mindy flags these recompetes specifically.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How Mindy helps */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            How Mindy Helps 8(a) Firms
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">8(a)-only filter</h3>
              <p className="text-slate-400 text-sm">
                Daily briefings filtered to 8(a) competed and 8(a) sole-source set-asides
                — no scrolling past full-and-open noise.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Sole-source intel</h3>
              <p className="text-slate-400 text-sm">
                Tracks which agencies actually use 8(a) sole-source authority and
                surfaces the forecasts most likely to convert.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">8(a) recompete alerts</h3>
              <p className="text-slate-400 text-sm">
                12-month advance notice when an 8(a) incumbent contract is expiring —
                including the incumbent&apos;s name and award value.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Mentor-protege intel</h3>
              <p className="text-slate-400 text-sm">
                The Mindy contractor database surfaces large primes winning in your
                NAICS — the shortlist for mentor outreach.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-900/50 py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-8 text-center">
            8(a) Frequently Asked Questions
          </h2>
          <div className="space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="group bg-slate-900 border border-slate-800 rounded-xl p-5">
                <summary className="text-white font-semibold cursor-pointer list-none flex items-center justify-between gap-4">
                  <span>{f.q}</span>
                  <span className="text-purple-400 text-xl group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="text-slate-400 mt-3 leading-relaxed text-sm">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Related programs */}
      <section className="px-4 py-12 border-t border-slate-800">
        <div className="max-w-4xl mx-auto text-center">
          <h3 className="text-lg font-semibold text-white mb-4">Other Set-Aside Programs</h3>
          <div className="flex flex-wrap gap-6 justify-center mb-4">
            <Link href="/set-asides/hubzone" className="text-slate-400 hover:text-purple-300 transition">HUBZone Opportunities →</Link>
            <Link href="/set-asides/sdvosb" className="text-slate-400 hover:text-purple-300 transition">SDVOSB Opportunities →</Link>
            <Link href="/set-asides/wosb" className="text-slate-400 hover:text-purple-300 transition">WOSB Opportunities →</Link>
          </div>
          <div className="flex flex-wrap gap-6 justify-center text-sm">
            <Link href="/glossary/8a-program" className="text-slate-500 hover:text-purple-300 transition">Full 8(a) definition →</Link>
            <Link href="/compare/sam-gov" className="text-slate-500 hover:text-purple-300 transition">Mindy vs SAM.gov →</Link>
            <Link href="/blog/how-to-find-federal-contracts" className="text-slate-500 hover:text-purple-300 transition">How to find federal contracts →</Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Get 8(a) opportunity alerts in your inbox.
          </h2>
          <p className="text-lg text-slate-300 mb-8">
            Daily briefings filtered to 8(a) set-asides and forecasts where your next
            sole-source could come from. Free. No credit card.
          </p>
          <Link
            href="/signup"
            className="inline-block px-10 py-4 bg-white hover:bg-slate-100 text-purple-700 rounded-xl font-bold text-lg shadow-xl transition-all hover:scale-105"
          >
            Get Free 8(a) Alerts
          </Link>
        </div>
      </section>
    </main>
  );
}

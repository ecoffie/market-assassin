/**
 * /set-asides/hubzone — HUBZone set-aside opportunities.
 *
 * Target keywords: "hubzone contracts", "hubzone certification
 * opportunities", "find hubzone contracts". HUBZone is the most
 * geographically-anchored SBA program — the principal office and
 * 35%+ employee residency requirement creates real strategic
 * questions (move HQ? hire locally?) so this page leans into the
 * "operational" angle more than the others.
 *
 * Differentiators from other set-aside pages:
 * - 10% price evaluation preference on full-and-open competitions
 * - Geographic eligibility is dynamic (HUBZone map updates)
 * - Stacks well with other certifications (8(a)+HUBZone is common)
 * - Federal HUBZone goal of 3% historically underperforms — the
 *   government is actively trying to drive more work to HUBZones
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'HUBZone Contract Opportunities — Federal Set-Aside Alerts | Mindy',
  description:
    'Daily HUBZone set-aside opportunities from SAM.gov, agency forecasts, and recompetes. Free alerts for certified HUBZone firms — including 10% price preference intel.',
  alternates: {
    canonical: 'https://getmindy.ai/set-asides/hubzone',
  },
  keywords: [
    'hubzone contracts',
    'hubzone certification opportunities',
    'hubzone contract opportunities',
    'find hubzone contracts',
    'hubzone set-aside',
    'hubzone sole source',
    'sba hubzone contracts',
  ],
  openGraph: {
    title: 'HUBZone Contract Opportunities — Daily Set-Aside Alerts | Mindy',
    description:
      'Mindy filters SAM.gov, agency forecasts, and recompetes for HUBZone set-asides and flags the 10% price preference on full-and-open bids.',
    type: 'website',
    url: 'https://getmindy.ai/set-asides/hubzone',
  },
};

const faqs = [
  {
    q: 'How do I know if my address is in a HUBZone?',
    a: 'Use the SBA HUBZone map at maps.certify.sba.gov/hubzone — enter your address and it tells you whether you\'re in a qualified HUBZone. Note that HUBZone designations change as census data and economic data refresh. An address that was in a HUBZone three years ago may not be today (and vice versa). Always re-verify before counting on the designation.',
  },
  {
    q: 'What\'s the 10% price evaluation preference?',
    a: 'On full-and-open competitive contracts (not set-asides), when a HUBZone firm and a non-HUBZone firm submit bids, the government treats the HUBZone bid as if it were 10% lower for evaluation purposes. The HUBZone firm still gets paid their actual bid price if they win — the 10% is purely an evaluation adjustment. It applies even outside HUBZone-set-aside competitions, which means HUBZone certification adds value beyond just the set-aside opportunities.',
  },
  {
    q: 'What does "principal office" mean for HUBZone?',
    a: 'The location where the greatest number of your employees perform their work — not necessarily your registered business address. For small firms this is usually obvious. For firms with multiple offices, SBA looks at headcount distribution. The principal office must be in a designated HUBZone, and at least 35% of all employees must reside in a HUBZone (not necessarily the same one).',
  },
  {
    q: 'Can HUBZone firms win sole-source contracts?',
    a: 'Yes — up to $4.5M for services and $8M for manufacturing, the same thresholds as 8(a). A contracting officer can sole-source to a HUBZone firm without competition when those thresholds are met and the price is fair. Sole-source HUBZone awards are less common than 8(a) sole-sources, but they exist and are worth pursuing once you\'ve built the agency relationship.',
  },
  {
    q: 'Why does the government push so hard on HUBZone?',
    a: 'The federal government has a statutory goal that 3% of all prime contract dollars go to HUBZone firms. Historically that goal has consistently underperformed — agencies routinely miss it. The shortfall means OSDBU offices and contracting officers are actively looking for qualified HUBZones to award work to. The gap between the 3% goal and actual performance is your opportunity.',
  },
  {
    q: 'Can I stack HUBZone with 8(a), SDVOSB, or WOSB?',
    a: 'Yes — these certifications are independent and stack. A firm that\'s 8(a), HUBZone, and SDVOSB qualifies for set-asides in all three categories, plus the HUBZone price preference on full-and-open bids. Stacking is the single highest-leverage move for diversifying your eligible pipeline, especially since each program has different agency targets and procurement patterns.',
  },
  {
    q: 'What happens if my HUBZone status changes mid-contract?',
    a: 'You don\'t lose the contract, but you may lose eligibility for the next one. HUBZone status is re-certified annually, and SBA does periodic recertifications. If census data shifts your address out of a HUBZone, or your employee residency drops below 35%, you have to address the gap before the next certification cycle. Most firms structure operations to maintain comfortable margins above the 35% threshold rather than running close to the line.',
  },
];

export default function HubzonePage() {
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
        name: 'HUBZone Program',
        serviceType: 'Federal Set-Aside Program',
        provider: {
          '@type': 'GovernmentOrganization',
          name: 'U.S. Small Business Administration',
          url: 'https://www.sba.gov/federal-contracting/contracting-assistance-programs/hubzone-program',
        },
        audience: {
          '@type': 'Audience',
          audienceType:
            'Small businesses with principal office in a HUBZone and 35%+ of employees residing in a HUBZone',
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://getmindy.ai' },
          { '@type': 'ListItem', position: 2, name: 'Set-Asides', item: 'https://getmindy.ai/set-asides' },
          { '@type': 'ListItem', position: 3, name: 'HUBZone', item: 'https://getmindy.ai/set-asides/hubzone' },
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
        <span className="text-slate-300">HUBZone</span>
      </nav>

      {/* Hero */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-full mb-6">
            <span className="text-purple-300 text-sm font-semibold uppercase tracking-wide">
              HUBZone Program
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
            HUBZone Set-Aside<br />
            <span className="text-purple-400">Contract Opportunities</span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto mb-8">
            The federal government has a statutory goal of awarding 3% of all prime
            contracts to HUBZone firms — and consistently misses it. That gap is your
            opportunity. Mindy filters every set-aside posted to SAM.gov, plus 7,600+
            agency forecasts, for HUBZone work — and flags the 10% price preference
            on full-and-open bids where it kicks in.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-500/30 transition-all hover:scale-105"
          >
            Get Free HUBZone Opportunity Alerts
          </Link>
          <p className="text-slate-500 text-sm mt-4">First briefing lands tomorrow morning.</p>
        </div>
      </section>

      {/* Who qualifies */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Who Qualifies for HUBZone
          </h2>
          <p className="text-slate-300 mb-4">
            HUBZone — Historically Underutilized Business Zone — is the most
            geography-dependent SBA program. It rewards companies that locate
            their operations and hire from economically distressed areas.
          </p>
          <ul className="space-y-3 text-slate-300">
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">Small business</strong> under SBA size standards for your primary NAICS.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">51%+ owned</strong> by U.S. citizens, a CDC, an agricultural cooperative, an Alaska Native corporation, an Indian tribe, or a Native Hawaiian organization.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">Principal office in a HUBZone.</strong> The location where the greatest number of employees perform their work.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">At least 35% of employees reside in a HUBZone.</strong> Any HUBZone — not necessarily the same one as the office.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">Annual recertification</strong> required to maintain status.</span>
            </li>
          </ul>
          <p className="text-slate-400 text-sm mt-4">
            Source: SBA, <a className="underline hover:text-purple-300" href="https://www.sba.gov/federal-contracting/contracting-assistance-programs/hubzone-program" target="_blank" rel="noopener noreferrer">HUBZone Program</a>. Check your address at <a className="underline hover:text-purple-300" href="https://maps.certify.sba.gov/hubzone" target="_blank" rel="noopener noreferrer">maps.certify.sba.gov/hubzone</a>.
          </p>
        </div>
      </section>

      {/* Where opportunities post */}
      <section className="bg-slate-900/50 py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Where HUBZone Opportunities Actually Live
          </h2>
          <p className="text-slate-300 mb-6">
            HUBZone work shows up in three distinct places — and the smartest firms
            track all three because the volume in each is different:
          </p>
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">SAM.gov HUBZone set-asides</h3>
              <p className="text-slate-400 text-sm">
                Filter SAM.gov opportunities by &ldquo;HUBZone Set-Aside&rdquo; or &ldquo;HUBZone Sole
                Source.&rdquo; Volume is real but smaller than 8(a) — most firms also
                bid on small-business and other set-asides.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Full-and-open with HUBZone price preference</h3>
              <p className="text-slate-400 text-sm">
                On any full-and-open competition (not a set-aside), the 10% price
                evaluation preference applies. That makes you competitive against
                larger firms on contracts that aren&apos;t HUBZone-only.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Agency forecasts with HUBZone designation</h3>
              <p className="text-slate-400 text-sm">
                Most agency forecasts identify anticipated set-aside type 6–18 months
                ahead. Forecasted HUBZone work is the earliest signal — gives you
                time to build agency relationships before the RFP drops.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Top agencies */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Top Agencies Awarding HUBZone Contracts
          </h2>
          <p className="text-slate-300 mb-6">
            Because the federal government chronically misses its 3% HUBZone goal,
            most agencies are actively trying to award more — but a handful drive
            the bulk of historical HUBZone spend:
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { name: 'Department of Defense', why: 'Army Corps of Engineers and base operations are major HUBZone buyers, especially for construction, environmental, and facility services.' },
              { name: 'Department of Veterans Affairs', why: 'Heavy HUBZone usage in medical center support services, facility maintenance, and construction.' },
              { name: 'General Services Administration', why: 'Federal building services, construction, and facility management — frequently HUBZone set-asides.' },
              { name: 'Department of Agriculture', why: 'Rural focus aligns with rural HUBZones; forestry, conservation, and field services often go HUBZone.' },
              { name: 'Department of Energy', why: 'National labs and cleanup sites are often in rural HUBZones; environmental remediation is a steady pipeline.' },
            ].map((a) => (
              <div key={a.name} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-1">{a.name}</h3>
                <p className="text-slate-400 text-sm">{a.why}</p>
              </div>
            ))}
          </div>
          <p className="text-slate-400 text-sm mt-6 italic">
            Construction, facility services, environmental, and rural-focused
            agencies tend to award more HUBZone work because the geographic
            requirement aligns naturally with rural and underserved areas.
          </p>
        </div>
      </section>

      {/* Strategy */}
      <section className="bg-slate-900/50 py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            How to Win HUBZone Contracts: 5 Tactics That Actually Work
          </h2>
          <div className="space-y-5">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">1. Bid full-and-open contracts and use the 10% preference</h3>
              <p className="text-slate-400 text-sm">
                Most HUBZone firms only look at HUBZone set-asides and leave the
                price preference on the table. On a $1M full-and-open bid, the 10%
                preference is worth $100K of pricing headroom. Filter SAM.gov for
                full-and-open in your NAICS and bid aggressively.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">2. Stack HUBZone with another certification</h3>
              <p className="text-slate-400 text-sm">
                HUBZone + 8(a) is a common pairing because the eligible pools are
                different. HUBZone + SDVOSB unlocks both HUBZone set-asides and
                VA Veterans First. Stacking expands your eligible opportunity volume
                substantially with no new operational change.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">3. Build a HUBZone hiring pipeline before you need it</h3>
              <p className="text-slate-400 text-sm">
                The 35% employee residency requirement bites when you scale fast.
                Identify HUBZones near your office, partner with local workforce
                boards, and build a sourcing pipeline so growth doesn&apos;t cost you
                certification.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">4. Talk to the OSDBU about the 3% gap</h3>
              <p className="text-slate-400 text-sm">
                Every agency has a small business goal scorecard. Ask the OSDBU
                where they stand against the 3% HUBZone goal — if they&apos;re behind,
                they will actively help you find work that closes the gap.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">5. Track HUBZone recompetes</h3>
              <p className="text-slate-400 text-sm">
                When a HUBZone contract is expiring, the recompete will almost always
                be re-set aside as HUBZone. Mindy flags these 12 months in advance
                with the incumbent name and award value so you have time to position.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How Mindy helps */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            How Mindy Helps HUBZone Firms
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">HUBZone-only filter</h3>
              <p className="text-slate-400 text-sm">
                Daily briefings filtered to HUBZone set-asides and sole-source
                opportunities across SAM.gov and Grants.gov.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Price-preference flag</h3>
              <p className="text-slate-400 text-sm">
                Mindy flags full-and-open opportunities where the 10% HUBZone price
                preference applies, so you don&apos;t miss the contracts you&apos;re
                advantaged on outside the set-aside lane.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">HUBZone recompete alerts</h3>
              <p className="text-slate-400 text-sm">
                12-month advance notice when a HUBZone incumbent contract is
                expiring — incumbent name and award value included.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">HUBZone forecast feed</h3>
              <p className="text-slate-400 text-sm">
                7,600+ agency forecasts aggregated; filter by HUBZone designation
                to see what&apos;s coming 6–18 months ahead.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-900/50 py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-8 text-center">
            HUBZone Frequently Asked Questions
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

      {/* Related */}
      <section className="px-4 py-12 border-t border-slate-800">
        <div className="max-w-4xl mx-auto text-center">
          <h3 className="text-lg font-semibold text-white mb-4">Other Set-Aside Programs</h3>
          <div className="flex flex-wrap gap-6 justify-center mb-4">
            <Link href="/set-asides/8a" className="text-slate-400 hover:text-purple-300 transition">8(a) Opportunities →</Link>
            <Link href="/set-asides/sdvosb" className="text-slate-400 hover:text-purple-300 transition">SDVOSB Opportunities →</Link>
            <Link href="/set-asides/wosb" className="text-slate-400 hover:text-purple-300 transition">WOSB Opportunities →</Link>
          </div>
          <div className="flex flex-wrap gap-6 justify-center text-sm">
            <Link href="/glossary/hubzone" className="text-slate-500 hover:text-purple-300 transition">Full HUBZone definition →</Link>
            <Link href="/compare/sam-gov" className="text-slate-500 hover:text-purple-300 transition">Mindy vs SAM.gov →</Link>
            <Link href="/blog/how-to-find-federal-contracts" className="text-slate-500 hover:text-purple-300 transition">How to find federal contracts →</Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Get HUBZone opportunity alerts in your inbox.
          </h2>
          <p className="text-lg text-slate-300 mb-8">
            Daily briefings filtered to HUBZone set-asides plus full-and-open bids
            where the 10% price preference applies. Free. No credit card.
          </p>
          <Link
            href="/signup"
            className="inline-block px-10 py-4 bg-white hover:bg-slate-100 text-purple-700 rounded-xl font-bold text-lg shadow-xl transition-all hover:scale-105"
          >
            Get Free HUBZone Alerts
          </Link>
        </div>
      </section>
    </main>
  );
}

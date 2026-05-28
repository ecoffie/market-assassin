/**
 * /set-asides/sdvosb — Service-Disabled Veteran-Owned Small Business
 * set-aside opportunities.
 *
 * Target keywords: "sdvosb contracts", "veteran-owned federal contracts",
 * "find sdvosb opportunities". The veteran small business population is
 * deeply engaged on this — SDVOSB searches skew transactional ("where do
 * I bid?") rather than informational ("what is SDVOSB?").
 *
 * Differentiators from other set-aside pages:
 * - VA Veterans First contracting priority (only program with agency-
 *   specific priority hierarchy)
 * - SBA certification (transitioned from self-certification in 2023 —
 *   firms certified by VA CVE were migrated; new applicants apply
 *   through certify.SBA.gov)
 * - 3% federal-wide goal (statutory; agencies consistently meet/exceed)
 * - Distinct from VOSB (which is VA-specific and requires no
 *   service-connected disability)
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'SDVOSB Contract Opportunities — Veteran Federal Contract Alerts | Mindy',
  description:
    'Daily SDVOSB set-aside opportunities from SAM.gov, agency forecasts, and VA Veterans First contracts. Free alerts for certified service-disabled veteran-owned firms.',
  alternates: {
    canonical: 'https://getmindy.ai/set-asides/sdvosb',
  },
  keywords: [
    'sdvosb contracts',
    'veteran-owned federal contracts',
    'sdvosb set-aside opportunities',
    'find sdvosb contracts',
    'va veterans first',
    'service disabled veteran contracts',
    'sba sdvosb contracts',
  ],
  openGraph: {
    title: 'SDVOSB Contract Opportunities — Daily Veteran Federal Alerts | Mindy',
    description:
      'Mindy filters SAM.gov, agency forecasts, and recompetes for SDVOSB set-asides — plus a dedicated stream for VA Veterans First opportunities.',
    type: 'website',
    url: 'https://getmindy.ai/set-asides/sdvosb',
  },
};

const faqs = [
  {
    q: 'What\'s the difference between SDVOSB and VOSB?',
    a: 'VOSB (Veteran-Owned Small Business) requires 51%+ ownership by any veteran. SDVOSB (Service-Disabled Veteran-Owned Small Business) requires the owner to have a service-connected disability rated by the VA. VOSB is recognized primarily at the VA under the Vets First Contracting Program. SDVOSB is recognized government-wide and unlocks set-asides at every federal agency, not just the VA. Most firms pursue SDVOSB whenever possible because the eligible opportunity pool is far larger.',
  },
  {
    q: 'How do I get SDVOSB certified?',
    a: 'As of January 2023, SDVOSB certification moved from the VA Center for Verification and Evaluation (CVE) to the SBA. You apply through certify.SBA.gov. If you were previously CVE-verified, your status was migrated. The application requires VA documentation of your service-connected disability, ownership and control documentation, and small business size standard verification for your primary NAICS. Processing typically takes 60–90 days.',
  },
  {
    q: 'What is VA Veterans First contracting?',
    a: 'A statutory program at the Department of Veterans Affairs that requires the VA to give priority to SDVOSBs and VOSBs when buying goods and services — ahead of all other small business set-aside categories. In practice, this means the VA is the single largest buyer of SDVOSB work because of the priority hierarchy. If you\'re SDVOSB and not actively pursuing VA work, you\'re leaving the most-aligned agency on the table.',
  },
  {
    q: 'Can SDVOSB firms win sole-source contracts?',
    a: 'Yes — up to $4.5M for services and $8M for manufacturing, same thresholds as 8(a) and HUBZone. A contracting officer can sole-source to an SDVOSB without competition when the requirement is below the threshold and the price is fair. SDVOSB sole-sources are more common at the VA (because of Veterans First) but happen across DoD, DHS, and other agencies too.',
  },
  {
    q: 'Does the federal government meet its SDVOSB goal?',
    a: 'Yes, consistently. The statutory federal-wide goal is 3% of prime contract dollars to SDVOSBs, and the government has met or exceeded this for many recent years. That makes SDVOSB one of the few set-aside categories that\'s working at scale. The competition inside SDVOSB is real because of this success — strong past performance and capture work matter more than just being certified.',
  },
  {
    q: 'Can I be SDVOSB and 8(a) at the same time?',
    a: 'Yes, and many veteran-owned firms are. The two certifications are independent and stack. An SDVOSB + 8(a) firm qualifies for set-asides in both categories, can sole-source under either, and benefits from the 8(a) nine-year development structure. If you qualify for both, certify for both — there\'s no downside.',
  },
  {
    q: 'What happens to my SDVOSB status if my disability rating changes?',
    a: 'SDVOSB eligibility is tied to having a service-connected disability — the rating percentage doesn\'t matter (a 10% rating qualifies the same as a 100% rating). If your disability rating is removed entirely, you would lose SDVOSB eligibility at the next recertification. If the rating is reduced but still present, your eligibility continues. Most SDVOSB-related issues stem from ownership/control documentation, not the disability rating itself.',
  },
];

export default function SdvosbPage() {
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
        name: 'Service-Disabled Veteran-Owned Small Business Program',
        serviceType: 'Federal Set-Aside Program',
        provider: {
          '@type': 'GovernmentOrganization',
          name: 'U.S. Small Business Administration',
          url: 'https://www.sba.gov/federal-contracting/contracting-assistance-programs/service-disabled-veteran-owned-small-business-program',
        },
        audience: {
          '@type': 'Audience',
          audienceType:
            'Small businesses 51%+ owned and controlled by veterans with a service-connected disability',
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://getmindy.ai' },
          { '@type': 'ListItem', position: 2, name: 'Set-Asides', item: 'https://getmindy.ai/set-asides' },
          { '@type': 'ListItem', position: 3, name: 'SDVOSB', item: 'https://getmindy.ai/set-asides/sdvosb' },
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
        <span className="text-slate-300">SDVOSB</span>
      </nav>

      {/* Hero */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-full mb-6">
            <span className="text-purple-300 text-sm font-semibold uppercase tracking-wide">
              Service-Disabled Veteran-Owned
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
            SDVOSB Set-Aside<br />
            <span className="text-purple-400">Contract Opportunities</span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto mb-8">
            SDVOSB is the only set-aside with a dedicated agency-level priority
            hierarchy — VA Veterans First — and the federal government consistently
            meets its 3% SDVOSB goal. Mindy filters SAM.gov, agency forecasts, and
            recompetes for SDVOSB work agency-wide, plus a dedicated stream for VA
            Veterans First opportunities.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-500/30 transition-all hover:scale-105"
          >
            Get Free SDVOSB Opportunity Alerts
          </Link>
          <p className="text-slate-500 text-sm mt-4">First briefing lands tomorrow morning.</p>
        </div>
      </section>

      {/* Who qualifies */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Who Qualifies for SDVOSB
          </h2>
          <p className="text-slate-300 mb-4">
            SDVOSB eligibility centers on veteran ownership, control, and a
            VA-rated service-connected disability. Certification moved from the VA
            to the SBA in 2023.
          </p>
          <ul className="space-y-3 text-slate-300">
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">51%+ unconditionally owned</strong> by one or more service-disabled veterans.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">Service-connected disability</strong> rated by the VA or DoD (any percentage qualifies).</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">Day-to-day management and long-term decision-making</strong> controlled by one or more service-disabled veterans.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">Small business size standards</strong> for your primary NAICS code.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-400 mt-1">→</span>
              <span><strong className="text-white">SBA certification via certify.SBA.gov</strong> (prior CVE certifications were migrated).</span>
            </li>
          </ul>
          <p className="text-slate-400 text-sm mt-4">
            Source: SBA, <a className="underline hover:text-purple-300" href="https://www.sba.gov/federal-contracting/contracting-assistance-programs/service-disabled-veteran-owned-small-business-program" target="_blank" rel="noopener noreferrer">SDVOSB Program</a>. Surviving spouses and caregivers of veterans rated 100% disabled or who died from a service-connected disability may also qualify in limited circumstances.
          </p>
        </div>
      </section>

      {/* Where opportunities post */}
      <section className="bg-slate-900/50 py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Where SDVOSB Opportunities Actually Live
          </h2>
          <p className="text-slate-300 mb-6">
            SDVOSB work shows up in two distinct lanes — federal-wide set-asides
            and VA-specific Veterans First procurements. The smartest firms
            track both because the rules and the volume are different:
          </p>
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">SAM.gov SDVOSB set-asides (federal-wide)</h3>
              <p className="text-slate-400 text-sm">
                Filter SAM.gov by &ldquo;SDVOSB Set-Aside&rdquo; or &ldquo;SDVOSB Sole Source.&rdquo;
                Available at every federal agency. The 3% federal-wide goal drives
                consistent volume across DoD, DHS, GSA, and elsewhere.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">VA Veterans First (VA-only priority)</h3>
              <p className="text-slate-400 text-sm">
                At the VA, SDVOSBs and VOSBs get statutory priority — ahead of all
                other small business categories. Most VA procurements that any
                small business could perform end up going to a verified veteran-owned
                firm.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">SDVOSB-set-aside IDIQ vehicles</h3>
              <p className="text-slate-400 text-sm">
                The VA T4NG (Transformation Twenty-One Total Technology Next
                Generation), GSA VETS 2 GWAC, and various agency-specific
                veteran-owned IDIQs run task-order competitions only among
                vehicle holders.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Agency forecasts</h3>
              <p className="text-slate-400 text-sm">
                Forecasts often identify anticipated SDVOSB or VOSB set-asides
                6–18 months ahead. The VA&apos;s forecast is especially useful
                because Veterans First means most opportunities default to
                veteran-owned firms.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Top agencies */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Top Agencies Awarding SDVOSB Contracts
          </h2>
          <p className="text-slate-300 mb-6">
            Because the federal-wide 3% goal is consistently met, SDVOSB work is
            spread across most agencies. But a handful dominate:
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { name: 'Department of Veterans Affairs', why: 'By far the largest SDVOSB buyer. Veterans First priority means most procurements end up at a veteran-owned firm. T4NG is the key IT vehicle.' },
              { name: 'Department of Defense', why: 'Largest absolute SDVOSB dollar volume outside the VA. Army, Navy, and Air Force all run substantial SDVOSB set-aside programs.' },
              { name: 'Department of Homeland Security', why: 'Active SDVOSB usage across CBP, ICE, USCIS, and FEMA — especially in IT services, logistics, and training.' },
              { name: 'General Services Administration', why: 'GSA VETS 2 GWAC and SDVOSB Schedule contracts drive consistent task-order flow.' },
              { name: 'Department of Health and Human Services', why: 'NIH, CDC, and CMS regularly use SDVOSB set-asides for IT services, professional services, and research support.' },
            ].map((a) => (
              <div key={a.name} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-1">{a.name}</h3>
                <p className="text-slate-400 text-sm">{a.why}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Strategy */}
      <section className="bg-slate-900/50 py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            How to Win SDVOSB Contracts: 5 Tactics That Actually Work
          </h2>
          <div className="space-y-5">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">1. Make the VA your first target</h3>
              <p className="text-slate-400 text-sm">
                Veterans First priority makes the VA the most aligned agency for
                any SDVOSB. Start with the VA Forecast of Contracting Opportunities,
                attend VA OSDBU events, and pursue T4NG or a VA Schedule contract
                early.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">2. Don&apos;t ignore federal-wide opportunities</h3>
              <p className="text-slate-400 text-sm">
                Many SDVOSB firms cluster at the VA and miss the larger federal-wide
                pool. DoD alone awards substantial SDVOSB volume across hundreds of
                NAICS codes. Mindy&apos;s SDVOSB filter spans all agencies, not just
                the VA.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">3. Pursue sole-source aggressively</h3>
              <p className="text-slate-400 text-sm">
                SDVOSB sole-source authority goes up to $4.5M services / $8M
                manufacturing. Contracting officers can use it when they know you
                — meaning capability briefings and relationship-building convert
                directly to award value. Start before you need it.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">4. Stack with HUBZone or 8(a)</h3>
              <p className="text-slate-400 text-sm">
                The certifications are independent. SDVOSB + HUBZone is common
                because the eligible pools rarely overlap and both compound.
                SDVOSB + 8(a) gives you the deepest possible set-aside coverage
                for the 8(a) program duration.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">5. Track SDVOSB recompetes</h3>
              <p className="text-slate-400 text-sm">
                When an SDVOSB incumbent contract is expiring, the recompete will
                almost always be re-set aside as SDVOSB. Mindy flags these 12 months
                in advance — including incumbent name and award value so you can
                position before the solicitation drops.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How Mindy helps */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            How Mindy Helps SDVOSB Firms
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">SDVOSB filter agency-wide</h3>
              <p className="text-slate-400 text-sm">
                Daily briefings filtered to SDVOSB set-asides across every
                federal agency — not just the VA.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">VA Veterans First stream</h3>
              <p className="text-slate-400 text-sm">
                Dedicated feed of VA procurements that fall under Veterans First —
                the highest-conversion pool for any SDVOSB.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">SDVOSB recompete alerts</h3>
              <p className="text-slate-400 text-sm">
                12-month advance notice when an SDVOSB incumbent contract is
                expiring — incumbent name and award value included.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Sole-source intel</h3>
              <p className="text-slate-400 text-sm">
                Tracks which agencies actually use SDVOSB sole-source authority
                and surfaces the forecasts most likely to convert.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-900/50 py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-8 text-center">
            SDVOSB Frequently Asked Questions
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
            <Link href="/set-asides/hubzone" className="text-slate-400 hover:text-purple-300 transition">HUBZone Opportunities →</Link>
            <Link href="/set-asides/wosb" className="text-slate-400 hover:text-purple-300 transition">WOSB Opportunities →</Link>
          </div>
          <div className="flex flex-wrap gap-6 justify-center text-sm">
            <Link href="/glossary/sdvosb" className="text-slate-500 hover:text-purple-300 transition">Full SDVOSB definition →</Link>
            <Link href="/glossary/vosb" className="text-slate-500 hover:text-purple-300 transition">VOSB definition →</Link>
            <Link href="/compare/sam-gov" className="text-slate-500 hover:text-purple-300 transition">Mindy vs SAM.gov →</Link>
            <Link href="/blog/how-to-find-federal-contracts" className="text-slate-500 hover:text-purple-300 transition">How to find federal contracts →</Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Get SDVOSB opportunity alerts in your inbox.
          </h2>
          <p className="text-lg text-slate-300 mb-8">
            Daily briefings filtered to SDVOSB set-asides federal-wide plus a
            dedicated VA Veterans First stream. Free. No credit card.
          </p>
          <Link
            href="/signup"
            className="inline-block px-10 py-4 bg-white hover:bg-slate-100 text-purple-700 rounded-xl font-bold text-lg shadow-xl transition-all hover:scale-105"
          >
            Get Free SDVOSB Alerts
          </Link>
        </div>
      </section>
    </main>
  );
}

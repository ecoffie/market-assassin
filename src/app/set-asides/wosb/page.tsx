/**
 * /set-asides/wosb — Women-Owned Small Business set-aside opportunities.
 *
 * Target keywords: "wosb contracts", "women-owned federal contracts",
 * "find wosb opportunities". The WOSB / EDWOSB structure is the most
 * NAICS-dependent of the four programs — the set-aside only applies in
 * specific NAICS codes where women-owned businesses are underrepresented,
 * which is the single most-asked question this page needs to answer.
 *
 * Differentiators from other set-aside pages:
 * - Eligibility is NAICS-restricted — different NAICS list for WOSB
 *   vs EDWOSB
 * - Two-tier structure: WOSB (general) and EDWOSB (economically
 *   disadvantaged track, broader NAICS eligibility)
 * - 5% federal-wide goal (historically underperformed, similar to
 *   HUBZone)
 * - Self-certification was eliminated in 2020 — all WOSB/EDWOSB
 *   firms must be SBA-certified or third-party certified
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'WOSB Contract Opportunities — Women-Owned Federal Alerts | Mindy',
  description:
    'Daily WOSB and EDWOSB set-aside opportunities from SAM.gov, agency forecasts, and recompetes. Free alerts for certified women-owned small business firms.',
  alternates: {
    canonical: 'https://getmindy.ai/set-asides/wosb',
  },
  keywords: [
    'wosb contracts',
    'women-owned federal contracts',
    'wosb set-aside opportunities',
    'find wosb contracts',
    'edwosb opportunities',
    'women-owned small business contracts',
    'sba wosb contracts',
  ],
  openGraph: {
    title: 'WOSB Contract Opportunities — Daily Women-Owned Federal Alerts | Mindy',
    description:
      'Mindy filters SAM.gov, agency forecasts, and recompetes for WOSB and EDWOSB set-asides in the specific NAICS codes where the program applies.',
    type: 'website',
    url: 'https://getmindy.ai/set-asides/wosb',
  },
};

const faqs = [
  {
    q: 'What\'s the difference between WOSB and EDWOSB?',
    a: 'WOSB (Women-Owned Small Business) is the general certification — 51%+ owned and controlled by U.S. citizen women. EDWOSB (Economically Disadvantaged WOSB) adds economic-disadvantage thresholds on top: personal net worth under $850K, adjusted gross income under $400K average, and personal assets under $6.5M. The practical impact is that the EDWOSB-eligible NAICS list is broader than the WOSB-only list. If you qualify economically, certify as EDWOSB — you get access to both the WOSB and EDWOSB set-aside pools.',
  },
  {
    q: 'Why does WOSB only apply in certain NAICS codes?',
    a: 'The WOSB and EDWOSB programs are restricted to NAICS codes where SBA determined women-owned businesses are underrepresented or substantially underrepresented in federal contracting. The list is maintained by SBA and updated periodically based on disparity studies. If your primary NAICS isn\'t on the eligible list, the WOSB set-aside doesn\'t apply to that work — even if you\'re certified. Check your NAICS against the current eligible list at sba.gov before counting on the set-aside.',
  },
  {
    q: 'Do I still need to be SBA-certified, or can I self-certify?',
    a: 'You must be certified. SBA eliminated self-certification for WOSB and EDWOSB effective October 2020. You can certify directly through certify.SBA.gov (free), or through an SBA-approved third-party certifier like WBENC, the National Women Business Owners Corporation, or El Paso Hispanic Chamber of Commerce (which may charge a fee). Either path gets you in the SBA database; both are equally valid for bidding on WOSB set-asides.',
  },
  {
    q: 'Can WOSB firms win sole-source contracts?',
    a: 'Yes, but with conditions. WOSB and EDWOSB sole-source authority goes up to $4.5M for services and $8M for manufacturing — same thresholds as 8(a), HUBZone, and SDVOSB. The CO can sole-source to a WOSB or EDWOSB in the eligible NAICS codes when the requirement is below the threshold. WOSB sole-sources are less common than 8(a) sole-sources but do happen, especially at agencies actively pushing to meet the 5% federal-wide WOSB goal.',
  },
  {
    q: 'Does the federal government meet its WOSB goal?',
    a: 'Historically, no — the 5% federal-wide WOSB goal has been chronically underperformed across most years. Like HUBZone, this gap is your opportunity: OSDBU offices and contracting officers are actively looking for qualified WOSBs to award work to. The shortfall means a certified WOSB with strong capability briefings can often find an agency that\'s motivated to award.',
  },
  {
    q: 'How does EDWOSB compare to 8(a) for women-owned firms?',
    a: 'They can overlap. EDWOSB and 8(a) both have economic-disadvantage thresholds, and a woman-owned firm meeting both can certify under both simultaneously. The differences: 8(a) has a nine-year clock and adds the development-program structure; EDWOSB is permanent (as long as you continue to qualify) but restricted to specific NAICS codes. Most successful women-owned 8(a) firms maintain EDWOSB certification too so they don\'t lose access to WOSB set-asides when they graduate from 8(a).',
  },
  {
    q: 'What happens if my company outgrows the WOSB size standard?',
    a: 'You lose WOSB eligibility for future opportunities, but you keep contracts you already won. Each NAICS code has its own size standard (revenue or employee count), so it\'s possible to outgrow WOSB in one NAICS while remaining eligible in another. If you\'re close to a threshold, work with your primary NAICS carefully — sometimes a slightly different code with a higher size standard preserves eligibility for longer.',
  },
];

export default function WosbPage() {
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
        name: 'Women-Owned Small Business Federal Contracting Program',
        serviceType: 'Federal Set-Aside Program',
        provider: {
          '@type': 'GovernmentOrganization',
          name: 'U.S. Small Business Administration',
          url: 'https://www.sba.gov/federal-contracting/contracting-assistance-programs/women-owned-small-business-federal-contracting-program',
        },
        audience: {
          '@type': 'Audience',
          audienceType:
            'Small businesses 51%+ owned and controlled by U.S. citizen women, in eligible NAICS codes',
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://getmindy.ai' },
          { '@type': 'ListItem', position: 2, name: 'Set-Asides', item: 'https://getmindy.ai/set-asides' },
          { '@type': 'ListItem', position: 3, name: 'WOSB', item: 'https://getmindy.ai/set-asides/wosb' },
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
        <span className="text-slate-300">WOSB</span>
      </nav>

      {/* Hero */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-full mb-6">
            <span className="text-purple-300 text-sm font-semibold uppercase tracking-wide">
              Women-Owned Small Business
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
            WOSB &amp; EDWOSB Set-Aside<br />
            <span className="text-purple-400">Contract Opportunities</span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto mb-8">
            The federal government has a statutory 5% WOSB goal — and consistently
            misses it. That gap is your opportunity. Mindy maps WOSB and EDWOSB
            eligibility to the specific NAICS codes where the set-aside applies, so
            you only see work your certification actually unlocks.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-500/30 transition-all hover:scale-105"
          >
            Get Free WOSB Opportunity Alerts
          </Link>
          <p className="text-slate-500 text-sm mt-4">First briefing lands tomorrow morning.</p>
        </div>
      </section>

      {/* Who qualifies */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Who Qualifies for WOSB and EDWOSB
          </h2>
          <p className="text-slate-300 mb-4">
            WOSB and EDWOSB are two tracks of the same program. Both require
            women ownership and control; EDWOSB adds an economic-disadvantage
            threshold that expands the eligible NAICS list.
          </p>
          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-3">WOSB</h3>
              <ul className="space-y-2 text-slate-300 text-sm">
                <li className="flex gap-2"><span className="text-purple-400">→</span><span>51%+ owned and controlled by U.S. citizen women</span></li>
                <li className="flex gap-2"><span className="text-purple-400">→</span><span>Day-to-day management by one or more women</span></li>
                <li className="flex gap-2"><span className="text-purple-400">→</span><span>Small business size standards for your NAICS</span></li>
                <li className="flex gap-2"><span className="text-purple-400">→</span><span>Operates in a WOSB-eligible NAICS code</span></li>
                <li className="flex gap-2"><span className="text-purple-400">→</span><span>SBA certification via certify.SBA.gov or approved third-party certifier</span></li>
              </ul>
            </div>
            <div className="bg-slate-900 border border-purple-500/30 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-3">EDWOSB <span className="text-purple-300 text-xs font-normal">(broader NAICS access)</span></h3>
              <ul className="space-y-2 text-slate-300 text-sm">
                <li className="flex gap-2"><span className="text-purple-400">→</span><span>Everything required for WOSB, plus:</span></li>
                <li className="flex gap-2"><span className="text-purple-400">→</span><span>Owner personal net worth under $850K</span></li>
                <li className="flex gap-2"><span className="text-purple-400">→</span><span>Average AGI under $400K (last 3 years)</span></li>
                <li className="flex gap-2"><span className="text-purple-400">→</span><span>Personal assets under $6.5M</span></li>
                <li className="flex gap-2"><span className="text-purple-400">→</span><span>Access to a substantially broader list of eligible NAICS codes</span></li>
              </ul>
            </div>
          </div>
          <p className="text-slate-400 text-sm">
            Source: SBA, <a className="underline hover:text-purple-300" href="https://www.sba.gov/federal-contracting/contracting-assistance-programs/women-owned-small-business-federal-contracting-program" target="_blank" rel="noopener noreferrer">WOSB Federal Contracting Program</a>. Self-certification was eliminated in October 2020 — you must be SBA-certified or third-party certified to bid on WOSB set-asides.
          </p>
        </div>
      </section>

      {/* Where opportunities post */}
      <section className="bg-slate-900/50 py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Where WOSB Opportunities Actually Live
          </h2>
          <p className="text-slate-300 mb-6">
            WOSB and EDWOSB opportunities show up across the standard federal
            channels — but the NAICS restriction means you have to filter
            carefully. Here&apos;s where to look:
          </p>
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">SAM.gov WOSB / EDWOSB set-asides</h3>
              <p className="text-slate-400 text-sm">
                Filter SAM.gov by &ldquo;WOSB Set-Aside&rdquo; or &ldquo;EDWOSB Set-Aside.&rdquo;
                Sole-source variants exist for both. The set-aside type field on
                each opportunity tells you exactly which track applies.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Full-and-open with small business consideration</h3>
              <p className="text-slate-400 text-sm">
                On full-and-open contracts, WOSB certification helps you count
                toward an agency&apos;s small-business and women-owned goals — making
                you a preferred small-business teaming partner for large primes
                building bids.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Agency forecasts</h3>
              <p className="text-slate-400 text-sm">
                Most agency forecasts identify anticipated WOSB or EDWOSB set-aside
                designations 6–18 months out. Use forecasts to start agency
                conversations early — before the RFP locks the requirement.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Subcontracting opportunities</h3>
              <p className="text-slate-400 text-sm">
                Large primes on contracts over $750K must submit subcontracting
                plans with small-business goals — including women-owned categories.
                Certified WOSBs are sought-after teaming partners.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Top agencies */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Top Agencies Awarding WOSB Contracts
          </h2>
          <p className="text-slate-300 mb-6">
            Because the federal government chronically misses the 5% WOSB goal,
            most agencies are actively trying to award more — but a handful drive
            the bulk of historical WOSB spend:
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { name: 'Department of Defense', why: 'Largest absolute WOSB dollar volume. Army, Navy, and Air Force run WOSB set-asides across professional services, IT, and base operations.' },
              { name: 'Department of Homeland Security', why: 'Active WOSB usage in CBP, FEMA, and TSA — especially for IT services, training, and administrative support.' },
              { name: 'General Services Administration', why: 'WOSB and EDWOSB Schedule task orders are a consistent pipeline; GSA actively promotes the program.' },
              { name: 'Department of Health and Human Services', why: 'NIH, CDC, and CMS regularly use WOSB set-asides for research support, IT, and consulting.' },
              { name: 'Department of Veterans Affairs', why: 'WOSB applies after Veterans First priority is met — significant volume for women-owned firms that aren\'t also veteran-owned.' },
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
            How to Win WOSB Contracts: 6 Tactics That Actually Work
          </h2>
          <div className="space-y-5">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">1. Certify as EDWOSB if you qualify</h3>
              <p className="text-slate-400 text-sm">
                EDWOSB unlocks a substantially broader list of eligible NAICS
                codes than WOSB alone. If you meet the economic-disadvantage
                thresholds, certify at the EDWOSB level — you still keep WOSB
                eligibility and add the EDWOSB-only pool on top.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">2. Confirm your NAICS is eligible</h3>
              <p className="text-slate-400 text-sm">
                The single biggest WOSB-strategy mistake is assuming the set-aside
                applies to your work when your primary NAICS isn&apos;t on the
                eligible list. Check the current SBA list before counting on the
                set-aside — and consider adding eligible NAICS codes if you can
                legitimately perform that work.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">3. Talk to OSDBU about the 5% gap</h3>
              <p className="text-slate-400 text-sm">
                Every agency has a scorecard. Ask the OSDBU where they stand
                against the 5% WOSB goal. If they&apos;re behind, they will actively
                help you find work that closes the gap — including sole-source
                consideration in NAICS where the agency has weak performance.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">4. Position as a teaming partner</h3>
              <p className="text-slate-400 text-sm">
                Large primes on $750K+ contracts must submit subcontracting plans
                with women-owned goals. Certified WOSBs are sought-after teaming
                partners — especially on contracts where the prime is below their
                WOSB subcontracting commitments.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">5. Stack with other certifications</h3>
              <p className="text-slate-400 text-sm">
                EDWOSB + 8(a) is common because the economic-disadvantage
                thresholds overlap. WOSB + HUBZone or WOSB + SDVOSB stack
                cleanly and expand your eligible pipeline well beyond what
                any single certification opens up.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">6. Track WOSB recompetes</h3>
              <p className="text-slate-400 text-sm">
                When a WOSB incumbent contract is expiring, the recompete will
                almost always be re-set aside as WOSB or EDWOSB. Mindy flags
                these 12 months in advance — incumbent name and award value
                included so you can position before the solicitation drops.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How Mindy helps */}
      <section className="py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            How Mindy Helps WOSB and EDWOSB Firms
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">NAICS-aware filtering</h3>
              <p className="text-slate-400 text-sm">
                Mindy maps your certification to the specific NAICS codes where
                the WOSB or EDWOSB set-aside applies — no false positives from
                ineligible NAICS.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">EDWOSB dedicated stream</h3>
              <p className="text-slate-400 text-sm">
                If you&apos;re EDWOSB-certified, Mindy surfaces the broader EDWOSB
                NAICS pool in addition to WOSB so you see every opportunity your
                tier unlocks.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">WOSB recompete alerts</h3>
              <p className="text-slate-400 text-sm">
                12-month advance notice when a WOSB or EDWOSB incumbent contract
                is expiring — including incumbent name and award value.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-1">Sole-source intel</h3>
              <p className="text-slate-400 text-sm">
                Tracks which agencies actually use WOSB sole-source authority and
                surfaces the forecasts most likely to convert.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-900/50 py-14 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-8 text-center">
            WOSB Frequently Asked Questions
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
            <Link href="/set-asides/sdvosb" className="text-slate-400 hover:text-purple-300 transition">SDVOSB Opportunities →</Link>
          </div>
          <div className="flex flex-wrap gap-6 justify-center text-sm">
            <Link href="/glossary/wosb" className="text-slate-500 hover:text-purple-300 transition">Full WOSB definition →</Link>
            <Link href="/glossary/edwosb" className="text-slate-500 hover:text-purple-300 transition">EDWOSB definition →</Link>
            <Link href="/compare/sam-gov" className="text-slate-500 hover:text-purple-300 transition">Mindy vs SAM.gov →</Link>
            <Link href="/blog/how-to-find-federal-contracts" className="text-slate-500 hover:text-purple-300 transition">How to find federal contracts →</Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Get WOSB opportunity alerts in your inbox.
          </h2>
          <p className="text-lg text-slate-300 mb-8">
            Daily briefings filtered to WOSB and EDWOSB set-asides in your
            eligible NAICS codes. Free. No credit card.
          </p>
          <Link
            href="/signup"
            className="inline-block px-10 py-4 bg-white hover:bg-slate-100 text-purple-700 rounded-xl font-bold text-lg shadow-xl transition-all hover:scale-105"
          >
            Get Free WOSB Alerts
          </Link>
        </div>
      </section>
    </main>
  );
}

/**
 * /set-asides — SBA set-aside programs index.
 *
 * Hub page for the four high-intent set-aside landing pages:
 * 8(a), HUBZone, SDVOSB, and WOSB. Targets the umbrella keyword
 * "SBA set-aside programs" and acts as the canonical internal-link
 * anchor for all four program pages.
 *
 * Intent: a certified (or about-to-be-certified) small business
 * landing here should be one click from the program they hold,
 * with enough context to pick the right one if they're still
 * deciding which to pursue.
 *
 * Server component, dark theme, full JSON-LD (Organization shared
 * @id + ItemList of the four programs).
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'SBA Set-Aside Programs — 8(a), HUBZone, SDVOSB, WOSB Contracts | Mindy',
  description:
    'Daily federal set-aside contract opportunities for 8(a), HUBZone, SDVOSB, and WOSB certified small businesses. Free opportunity alerts from SAM.gov and agency forecasts.',
  alternates: {
    canonical: 'https://getmindy.ai/set-asides',
  },
  keywords: [
    'sba set-aside programs',
    'small business set-aside',
    '8a contracts',
    'hubzone contracts',
    'sdvosb contracts',
    'wosb contracts',
    'federal set-aside opportunities',
  ],
  openGraph: {
    title: 'SBA Set-Aside Programs — Find Contracts You\'re Certified For',
    description:
      'Daily federal set-aside opportunities for 8(a), HUBZone, SDVOSB, and WOSB firms. Free alerts from SAM.gov, agency forecasts, and recompetes.',
    type: 'website',
    url: 'https://getmindy.ai/set-asides',
  },
};

const programs = [
  {
    slug: '8a',
    name: '8(a) Business Development',
    short: '8(a)',
    eligibility:
      'Socially and economically disadvantaged small businesses certified by the SBA. Nine-year program with sole-source authority up to $4.5M services / $8M manufacturing.',
    href: '/set-asides/8a',
  },
  {
    slug: 'hubzone',
    name: 'HUBZone',
    short: 'HUBZone',
    eligibility:
      'Small businesses with principal office in a Historically Underutilized Business Zone and 35%+ of employees living in a HUBZone. Gets a 10% price evaluation preference on full-and-open bids.',
    href: '/set-asides/hubzone',
  },
  {
    slug: 'sdvosb',
    name: 'Service-Disabled Veteran-Owned',
    short: 'SDVOSB',
    eligibility:
      'Small businesses 51%+ owned and controlled by veterans with a service-connected disability. SBA-certified as of 2023. VA Veterans First gives priority at the VA.',
    href: '/set-asides/sdvosb',
  },
  {
    slug: 'wosb',
    name: 'Women-Owned Small Business',
    short: 'WOSB / EDWOSB',
    eligibility:
      'Small businesses 51%+ owned and controlled by U.S. citizen women. EDWOSB adds an economic-disadvantage threshold and unlocks set-asides in a broader range of NAICS codes.',
    href: '/set-asides/wosb',
  },
];

export default function SetAsidesIndexPage() {
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
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://getmindy.ai' },
          { '@type': 'ListItem', position: 2, name: 'Set-Asides', item: 'https://getmindy.ai/set-asides' },
        ],
      },
      {
        '@type': 'ItemList',
        name: 'SBA Set-Aside Programs',
        itemListElement: programs.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `https://getmindy.ai${p.href}`,
          name: p.name,
        })),
      },
    ],
  };

  return (
    <main className="bg-(--mp-paper)">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumb */}
      <nav className="max-w-4xl mx-auto px-4 pt-6 text-sm text-(--mp-muted)">
        <Link href="/" className="hover:text-(--mp-navy-hover)">Home</Link>
        <span className="mx-2">/</span>
        <span className="text-(--mp-body)">Set-Asides</span>
      </nav>

      {/* Hero */}
      <section className="py-16 px-4 bg-(--mp-wash)">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-(--mp-navy-wash) border border-(--mp-line) rounded-lg mb-6">
            <span className="text-(--mp-navy) text-sm font-semibold uppercase tracking-wide">
              SBA Set-Aside Programs
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-(--mp-ink) mb-6 leading-tight font-(family-name:--mp-font-serif)">
            Find the Federal Contracts<br />
            <span className="text-(--mp-navy)">You&apos;re Certified For.</span>
          </h1>

          <p className="text-lg md:text-xl text-(--mp-body) max-w-2xl mx-auto mb-8">
            Set-asides are the single highest-leverage filter in federal contracting.
            Mindy reads SAM.gov, agency forecasts, and recompetes — then surfaces only
            the work your certification actually unlocks.
          </p>

          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white rounded-lg font-bold text-lg transition-colors"
          >
            Get Free Set-Aside Alerts
          </Link>
          <p className="text-(--mp-muted) text-sm mt-4">First briefing lands tomorrow morning.</p>
        </div>
      </section>

      {/* Program grid */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-(--mp-ink) mb-2 text-center font-(family-name:--mp-font-serif)">
            Four Programs. Pick the One You Qualify For.
          </h2>
          <p className="text-(--mp-muted) text-center mb-12 max-w-2xl mx-auto">
            Each program restricts a slice of federal spending to certified small businesses.
            Click through for current opportunities, top awarding agencies, and program-specific strategy.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            {programs.map((p) => (
              <Link
                key={p.slug}
                href={p.href}
                className="group block bg-(--mp-surface) border border-(--mp-line) hover:border-(--mp-navy) rounded-lg p-6 transition-colors"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-lg bg-(--mp-navy-wash) border border-(--mp-line) flex items-center justify-center">
                    <span className="text-(--mp-navy) font-bold text-sm">{p.short}</span>
                  </div>
                  <h3 className="text-xl font-bold text-(--mp-ink) group-hover:text-(--mp-navy-hover) transition font-(family-name:--mp-font-serif)">
                    {p.name}
                  </h3>
                </div>
                <p className="text-(--mp-muted) text-sm leading-relaxed mb-4">{p.eligibility}</p>
                <span className="text-(--mp-navy) text-sm font-semibold">
                  View {p.short} opportunities →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* How to choose */}
      <section className="bg-(--mp-wash) py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-(--mp-ink) mb-6 text-center font-(family-name:--mp-font-serif)">
            Not Sure Which Program Fits You?
          </h2>
          <p className="text-(--mp-muted) mb-8 text-center">
            A quick decision tree — most contractors qualify for more than one. You
            can hold multiple certifications simultaneously and stack them.
          </p>

          <div className="space-y-4">
            <div className="bg-(--mp-surface) border border-(--mp-line) rounded-lg p-5">
              <h3 className="text-(--mp-ink) font-semibold mb-1">
                You&apos;re a veteran with a VA-rated service-connected disability
              </h3>
              <p className="text-(--mp-muted) text-sm">
                Start with <Link href="/set-asides/sdvosb" className="text-(--mp-navy) hover:text-(--mp-navy-hover)">SDVOSB</Link> —
                it&apos;s the most powerful veteran-focused set-aside and unlocks VA
                Veterans First priority.
              </p>
            </div>

            <div className="bg-(--mp-surface) border border-(--mp-line) rounded-lg p-5">
              <h3 className="text-(--mp-ink) font-semibold mb-1">
                Your business is 51%+ owned by women
              </h3>
              <p className="text-(--mp-muted) text-sm">
                Start with <Link href="/set-asides/wosb" className="text-(--mp-navy) hover:text-(--mp-navy-hover)">WOSB</Link> —
                if the owner also meets the economic-disadvantage threshold, the EDWOSB
                certification expands the eligible NAICS list.
              </p>
            </div>

            <div className="bg-(--mp-surface) border border-(--mp-line) rounded-lg p-5">
              <h3 className="text-(--mp-ink) font-semibold mb-1">
                You meet the SBA&apos;s social and economic disadvantage criteria
              </h3>
              <p className="text-(--mp-muted) text-sm">
                Apply for <Link href="/set-asides/8a" className="text-(--mp-navy) hover:text-(--mp-navy-hover)">8(a)</Link> —
                it&apos;s a nine-year development program with sole-source authority that no
                other certification matches.
              </p>
            </div>

            <div className="bg-(--mp-surface) border border-(--mp-line) rounded-lg p-5">
              <h3 className="text-(--mp-ink) font-semibold mb-1">
                Your principal office is in (or could move to) a HUBZone
              </h3>
              <p className="text-(--mp-muted) text-sm">
                Look at <Link href="/set-asides/hubzone" className="text-(--mp-navy) hover:text-(--mp-navy-hover)">HUBZone</Link> —
                check the SBA HUBZone map before assuming you don&apos;t qualify.
                Designations change as the data updates.
              </p>
            </div>
          </div>

          <div className="mt-8 bg-(--mp-navy-wash) border border-(--mp-line) rounded-lg p-5 text-center">
            <p className="text-(--mp-body)">
              <strong className="text-(--mp-ink)">Most successful firms stack certifications.</strong>{' '}
              An 8(a) firm that&apos;s also SDVOSB and HUBZone qualifies for every set-aside
              category — three times the eligible opportunity volume.
            </p>
          </div>
        </div>
      </section>

      {/* How Mindy helps */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-(--mp-ink) mb-6 text-center font-(family-name:--mp-font-serif)">
            How Mindy Surfaces Set-Aside Work
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-(--mp-surface) border border-(--mp-line) rounded-lg p-5">
              <h3 className="text-(--mp-ink) font-semibold mb-2">Set-aside filter on every alert</h3>
              <p className="text-(--mp-muted) text-sm">
                Mindy applies your certifications to every SAM.gov opportunity so you
                never see work you can&apos;t bid on — and never miss work reserved for
                your program.
              </p>
            </div>
            <div className="bg-(--mp-surface) border border-(--mp-line) rounded-lg p-5">
              <h3 className="text-(--mp-ink) font-semibold mb-2">Sole-source intelligence</h3>
              <p className="text-(--mp-muted) text-sm">
                8(a), SDVOSB, HUBZone, and WOSB firms can win sole-source awards up to
                $4.5M (services) / $8M (manufacturing). Mindy tracks which agencies
                actually use that authority.
              </p>
            </div>
            <div className="bg-(--mp-surface) border border-(--mp-line) rounded-lg p-5">
              <h3 className="text-(--mp-ink) font-semibold mb-2">Recompete alerts</h3>
              <p className="text-(--mp-muted) text-sm">
                When a set-aside contract is 12 months from expiring, Mindy flags it —
                including whether the incumbent shares your certification.
              </p>
            </div>
            <div className="bg-(--mp-surface) border border-(--mp-line) rounded-lg p-5">
              <h3 className="text-(--mp-ink) font-semibold mb-2">Forecast aggregation</h3>
              <p className="text-(--mp-muted) text-sm">
                33,000+ federal forecasts pulled into one feed, filtered by set-aside.
                See what&apos;s coming 6–18 months before the solicitation hits SAM.gov.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Related */}
      <section className="px-4 py-12 border-t border-(--mp-line)">
        <div className="max-w-4xl mx-auto text-center">
          <h3 className="text-lg font-semibold text-(--mp-ink) mb-4">Related</h3>
          <div className="flex flex-wrap gap-6 justify-center">
            <Link href="/glossary/set-aside" className="text-(--mp-muted) hover:text-(--mp-navy-hover) transition">
              What is a set-aside?
            </Link>
            <Link href="/compare/sam-gov" className="text-(--mp-muted) hover:text-(--mp-navy-hover) transition">
              Mindy vs SAM.gov alerts
            </Link>
            <Link href="/blog/how-to-find-federal-contracts" className="text-(--mp-muted) hover:text-(--mp-navy-hover) transition">
              How to find federal contracts
            </Link>
            <Link href="/recompete" className="text-(--mp-muted) hover:text-(--mp-navy-hover) transition">
              Expiring contracts
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16 px-4 bg-(--mp-wash)">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-(--mp-ink) mb-4 font-(family-name:--mp-font-serif)">
            Stop missing set-aside contracts.
          </h2>
          <p className="text-lg text-(--mp-body) mb-8">
            Pick your program, get a daily briefing of opportunities matched to your
            certification. Free, no credit card.
          </p>
          <Link
            href="/signup"
            className="inline-block px-10 py-4 bg-white hover:bg-(--mp-wash) text-(--mp-navy) rounded-lg font-bold text-lg transition-colors"
          >
            Get Free Alerts
          </Link>
        </div>
      </section>
    </main>
  );
}

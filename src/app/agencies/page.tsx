/**
 * /agencies — Federal agency directory index.
 *
 * Programmatic SEO surface for buyer-intent queries like
 * "federal agencies that buy [X]" and "[agency] contract opportunities".
 * Groups the 49-agency canonical list by Cabinet / independent /
 * small so the page is scannable, sorted within each group by FY26
 * budget so the biggest buyers surface first.
 *
 * Server component, statically rendered. The data file is built by
 * scripts/build-agencies-seo.py — see that script for source-of-truth
 * mapping rules.
 */
import type { Metadata } from 'next';
import MeetMindyStrip from '@/components/MeetMindyStrip';
import Link from 'next/link';
import {
  AGENCIES_SEO,
  getAgenciesByGroup,
  type AgencySeo,
} from '@/data/agencies-seo';

export const metadata: Metadata = {
  title:
    'Federal Agency Directory — Contract Opportunities by Buyer | Mindy',
  description:
    'Browse 49 federal agencies by spending, pain points, and procurement portals. Find the right buyer for your NAICS — and get daily opportunity alerts from Mindy.',
  alternates: { canonical: 'https://getmindy.ai/agencies' },
  openGraph: {
    title:
      'Federal Agency Directory — Contract Opportunities by Buyer | Mindy',
    description:
      'Browse 49 federal agencies by spending, pain points, and procurement portals. Find the right buyer for your NAICS.',
    type: 'website',
    url: 'https://getmindy.ai/agencies',
  },
  keywords: [
    'federal agencies',
    'federal agency directory',
    'government contract opportunities',
    'federal contracting agencies',
    'who buys government contracts',
    'agency spending data',
  ],
};

// Total spend across agencies that have budget data. Used in the hero
// stat block. Computed at module scope (not inside render) because
// AGENCIES_SEO is a static import.
const TOTAL_BUDGET_B = AGENCIES_SEO.reduce(
  (sum, a) => sum + (a.fy26BudgetB ?? 0),
  0,
);

export default function AgenciesIndexPage() {
  const defense = getAgenciesByGroup('defense');
  const health = getAgenciesByGroup('health');
  const civilian = getAgenciesByGroup('civilian');
  const independent = getAgenciesByGroup('independent');
  const small = getAgenciesByGroup('small');

  // ItemList JSON-LD signals to Google that this is a curated list of
  // entities. Each entry points at its detail page so the crawl graph
  // is explicit.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: 'https://getmindy.ai',
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Agencies',
            item: 'https://getmindy.ai/agencies',
          },
        ],
      },
      {
        '@type': 'ItemList',
        '@id': 'https://getmindy.ai/agencies#list',
        name: 'Federal Agency Directory',
        description:
          'Federal agencies with spending, pain points, and procurement portals.',
        numberOfItems: AGENCIES_SEO.length,
        itemListElement: AGENCIES_SEO.map((a, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `https://getmindy.ai/agencies/${a.slug}`,
          name: a.name,
        })),
      },
    ],
  };

  return (
    <main className="bg-(--mp-paper)">
      <MeetMindyStrip variant="banner" appearance="public" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="max-w-4xl mx-auto px-4 pt-8 text-sm text-(--mp-muted)"
      >
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="hover:text-(--mp-navy-hover) transition">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-(--mp-muted)" aria-current="page">
            Agencies
          </li>
        </ol>
      </nav>

      {/* Hero */}
      <section className="py-16 px-4 bg-(--mp-wash)">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-(--mp-navy)">
              <span className="text-(--mp-surface) font-bold text-xl">M</span>
            </div>
            <span className="text-(--mp-navy) font-semibold tracking-wide uppercase text-sm">
              Agency Directory
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-(--mp-ink) mb-4 font-(family-name:--mp-font-serif)">
            Federal Agencies —{' '}
            <span className="text-(--mp-navy)">Contract Opportunities by Buyer</span>
          </h1>
          <p className="text-lg md:text-xl text-(--mp-body) max-w-2xl mx-auto mb-10">
            {AGENCIES_SEO.length} federal agencies, ranked by FY26 budget.
            Click any agency to see what they buy, where they post
            opportunities, and what they actually struggle with.
          </p>

          <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
            <Stat label="Agencies" value={AGENCIES_SEO.length.toString()} />
            <Stat
              label="FY26 Budget Tracked"
              value={`$${Math.round(TOTAL_BUDGET_B).toLocaleString()}B`}
            />
            <Stat
              label="Procurement Portals"
              value={`${AGENCIES_SEO.reduce(
                (n, a) => n + a.procurement.secondarySources.length,
                0,
              )}+`}
            />
          </div>
        </div>
      </section>

      {/* Groups */}
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-12">
        {defense.length > 0 && (
          <Group
            label="Defense & Homeland"
            description="DoD, DHS, and USACE — the largest single buyer cluster in the federal market."
            agencies={defense}
          />
        )}
        {health.length > 0 && (
          <Group
            label="Health"
            description="HHS and its sub-agencies — primary civilian buyer of R&D and IT services."
            agencies={health}
          />
        )}
        {civilian.length > 0 && (
          <Group
            label="Cabinet — Civilian"
            description="The other 12 cabinet departments. Strong set-aside programs at VA, USDA, and DOI."
            agencies={civilian}
          />
        )}
        {independent.length > 0 && (
          <Group
            label="Independent Agencies"
            description="NASA, GSA, EPA, NSF and others — often the easiest entry points for small business."
            agencies={independent}
          />
        )}
        {small.length > 0 && (
          <Group
            label="Smaller Agencies & Commissions"
            description="Lower competition, predictable repeat buyers. Often overlooked by primes."
            agencies={small}
          />
        )}
      </div>

      {/* CTA */}
      <section className="px-4 pb-20">
        <div className="max-w-3xl mx-auto border border-(--mp-line) rounded-lg p-8 md:p-12 text-center bg-(--mp-wash)">
          <h2 className="text-3xl font-bold text-(--mp-ink) mb-4 font-(family-name:--mp-font-serif)">
            Stop checking 12 portals. Let Mindy do it.
          </h2>
          <p className="text-lg text-(--mp-body) mb-8 max-w-xl mx-auto">
            Mindy aggregates SAM.gov, agency forecast portals, NIH RePORTER,
            SBIR/STTR, and dozens of agency-specific bid boards into one daily
            briefing — matched to your NAICS codes.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white rounded-lg font-bold text-lg transition-colors"
          >
            Get Free Daily Opportunity Alerts
          </Link>
          <p className="text-(--mp-muted) text-sm mt-4">
            No credit card. First briefing lands tomorrow morning.
          </p>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-(--mp-surface) border border-(--mp-line) rounded-lg p-4">
      <div className="text-2xl font-bold text-(--mp-navy)">{value}</div>
      <div className="text-xs text-(--mp-muted) mt-1">{label}</div>
    </div>
  );
}

const GROUP_STYLE = {
  pill: 'bg-(--mp-navy-wash) text-(--mp-navy) border-(--mp-line)',
  hover: 'hover:border-(--mp-navy)',
  accent: 'text-(--mp-navy)',
};

function Group({
  label,
  description,
  agencies,
}: {
  label: string;
  description: string;
  agencies: AgencySeo[];
}) {
  const styles = GROUP_STYLE;
  return (
    <section>
      <div className="flex items-center gap-3 mb-2">
        <span
          className={`px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wide border ${styles.pill}`}
        >
          {label}
        </span>
        <span className="text-(--mp-muted) text-sm">
          {agencies.length} agencies
        </span>
      </div>
      <p className="text-(--mp-muted) text-sm mb-6 max-w-3xl">{description}</p>
      <ul className="grid sm:grid-cols-2 gap-4">
        {agencies.map((a) => (
          <li key={a.slug}>
            <Link
              href={`/agencies/${a.slug}`}
              className={`block bg-(--mp-wash) border border-(--mp-line) rounded-lg p-5 transition group ${styles.hover}`}
            >
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className={`font-bold ${styles.accent}`}>
                  {a.abbreviation || a.name}
                </span>
                {a.fy26BudgetB ? (
                  <span className="text-(--mp-muted) text-sm whitespace-nowrap">
                    ${a.fy26BudgetB.toLocaleString()}B FY26
                  </span>
                ) : null}
              </div>
              <h3 className="text-(--mp-ink) font-semibold leading-snug group-hover:text-(--mp-ink)">
                {a.name}
              </h3>
              <p className="text-xs text-(--mp-muted) mt-2">
                {a.painPoints.length > 0
                  ? `${a.painPoints.length} priorities tracked`
                  : 'View opportunities'}{' '}
                <span aria-hidden className="ml-1">
                  →
                </span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

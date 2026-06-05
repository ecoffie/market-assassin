/**
 * /contractors — public index of federal contractor profiles.
 *
 * Serves two purposes:
 *
 *   1. Internal-linking for SEO. Every contractor profile page
 *      should be reachable in 1-2 clicks from the index. Google
 *      uses this internal link graph to distribute PageRank +
 *      decide which pages are important.
 *
 *   2. Human-browsable directory. Users who Google "federal
 *      contractors database" land here and can drill in to
 *      specific companies.
 *
 * Strategy: group contractors by spend tier so the index isn't a
 * flat list of 2,768 names. Top tier (>$1B) gets prominent display;
 * smaller tiers collapse into paginated grids.
 *
 * Statically generated at build time. Revalidates every 24h
 * (matches the contractor page TTL).
 */
import type { Metadata } from 'next';
import MeetMindyStrip from '@/components/MeetMindyStrip';
import Link from 'next/link';
import contractorsData from '@/data/contractors.json';
import {
  formatCompactCurrency,
  getContractorSlug,
} from '@/lib/contractor-sales-history';

export const revalidate = 86_400;

const SITE_NAME = 'GovCon Giants';

export const metadata: Metadata = {
  // Title rewrite based on GSC week-1 data (May 2026): the highest-impression
  // queries are "national database of federal contractors", "federal contracts
  // awarded", "top government contractors". Lead with "317K" and "Database"
  // to match how searchers describe what they want. Updated stat from the
  // stale 2,700 (contractors.json era) to the real BQ count.
  title: '317,000 Federal Contractors — Award History Database | Mindy',
  description:
    'Search 317,000 federal contractors by name. Year-over-year award history, top agencies, NAICS coverage, executive disclosures. Pulled live from USAspending.gov FY2016-FY2026.',
  alternates: {
    canonical: 'https://getmindy.ai/contractors',
  },
  openGraph: {
    title: '317,000 Federal Contractors — Award History Database | Mindy',
    description:
      'Search 317,000 federal contractors by name. Year-over-year award history, top agencies, NAICS coverage, executive disclosures.',
    url: 'https://getmindy.ai/contractors',
    type: 'website',
    siteName: 'Mindy',
  },
  twitter: {
    card: 'summary_large_image',
    title: '317,000 Federal Contractors — Award History Database | Mindy',
    description: 'Search 317,000 federal contractors. Real USAspending data, FY2016-FY2026.',
  },
};

interface ContractorRow {
  company: string;
  contract_value_num?: number;
  agencies?: string;
  naics?: string;
  contract_count?: string;
}

interface TierBucket {
  label: string;
  description: string;
  threshold: number; // inclusive minimum spend
  contractors: ContractorRow[];
}

function buildTiers(rows: ContractorRow[]): TierBucket[] {
  // De-dupe by slug so near-duplicate rows in contractors.json
  // ("OPTUM PUBLIC SECTOR SOLUTIONS INC" vs " INC.") don't render
  // two entries pointing at the same page.
  const seen = new Set<string>();
  const deduped: ContractorRow[] = [];
  for (const c of rows) {
    if (!c.company) continue;
    const slug = getContractorSlug({ company: c.company });
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    deduped.push(c);
  }

  // Sort by spend desc once; bucketing assumes the input is sorted.
  deduped.sort((a, b) => (b.contract_value_num || 0) - (a.contract_value_num || 0));

  const tiers: TierBucket[] = [
    {
      label: 'Mega Primes ($1B+)',
      description: 'Top-tier federal contractors with billion-dollar awards.',
      threshold: 1_000_000_000,
      contractors: [],
    },
    {
      label: 'Large Contractors ($100M-$1B)',
      description: 'Established primes with significant federal market share.',
      threshold: 100_000_000,
      contractors: [],
    },
    {
      label: 'Mid-Market ($10M-$100M)',
      description: 'Active federal contractors — strong recompete + teaming candidates.',
      threshold: 10_000_000,
      contractors: [],
    },
    {
      label: 'Emerging ($1M-$10M)',
      description: 'Smaller contractors with recent federal wins.',
      threshold: 1_000_000,
      contractors: [],
    },
    {
      label: 'New Entrants (Under $1M)',
      description: 'Early-stage federal contractors.',
      threshold: 0,
      contractors: [],
    },
  ];

  for (const c of deduped) {
    const spend = c.contract_value_num || 0;
    const tier = tiers.find(t => spend >= t.threshold);
    if (tier) tier.contractors.push(c);
  }
  return tiers;
}

// Per-tier display cap so the index page doesn't render 2,700+
// links above the fold. Lower tiers cap harder; the long tail
// is reachable via the per-tier "See all" link if we add one.
const TIER_DISPLAY_CAP: Record<string, number> = {
  'Mega Primes ($1B+)': 100,
  'Large Contractors ($100M-$1B)': 100,
  'Mid-Market ($10M-$100M)': 100,
  'Emerging ($1M-$10M)': 100,
  'New Entrants (Under $1M)': 50,
};

export default function ContractorsIndexPage() {
  const tiers = buildTiers(contractorsData as ContractorRow[]);
  const totalCount = tiers.reduce((sum, t) => sum + t.contractors.length, 0);
  const totalSpend = tiers.reduce(
    (sum, t) => sum + t.contractors.reduce((s, c) => s + (c.contract_value_num || 0), 0),
    0
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      <MeetMindyStrip variant="banner" />
      <div className="mx-auto max-w-6xl px-6 py-12">
        {/* Hero */}
        <header className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold text-white">
            Federal Contractor Database
          </h1>
          <p className="mt-3 text-lg text-slate-400 max-w-3xl">
            Browse {totalCount.toLocaleString()} federal contractors with year-over-year award
            history, top agency relationships, and NAICS coverage. Powered by USAspending +
            SAM.gov data.
          </p>
          <div className="mt-6 flex flex-wrap gap-4 text-sm">
            <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
              <div className="text-2xl font-bold text-emerald-400">{totalCount.toLocaleString()}</div>
              <div className="text-xs text-slate-500 mt-0.5">contractors profiled</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
              <div className="text-2xl font-bold text-emerald-400">{formatCompactCurrency(totalSpend)}</div>
              <div className="text-xs text-slate-500 mt-0.5">combined federal spend</div>
            </div>
          </div>
        </header>

        {/* Tiers */}
        <div className="space-y-12">
          {tiers
            .filter(t => t.contractors.length > 0)
            .map(tier => {
              const cap = TIER_DISPLAY_CAP[tier.label] || 100;
              const visible = tier.contractors.slice(0, cap);
              const hidden = tier.contractors.length - visible.length;
              return (
                <section key={tier.label}>
                  <header className="mb-4 border-b border-slate-800 pb-2">
                    <h2 className="text-xl font-bold text-white">{tier.label}</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      {tier.description} ({tier.contractors.length.toLocaleString()} total)
                    </p>
                  </header>

                  {/* Grid of contractor links. Compact list-style
                      so each tier fits a few hundred without
                      overwhelming the page. */}
                  <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                    {visible.map(c => {
                      const slug = getContractorSlug({ company: c.company });
                      return (
                        <li key={slug}>
                          <Link
                            href={`/contractors/${slug}`}
                            className="block py-1 px-2 rounded hover:bg-slate-900 transition-colors group"
                          >
                            <span className="text-slate-200 group-hover:text-white truncate block">
                              {c.company}
                            </span>
                            <span className="text-[10px] text-slate-500 group-hover:text-slate-400">
                              {formatCompactCurrency(c.contract_value_num || 0)}
                              {c.contract_count && ` · ${c.contract_count} contracts`}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>

                  {hidden > 0 && (
                    <p className="text-xs text-slate-500 italic mt-3">
                      +{hidden.toLocaleString()} more contractors in this tier (browse via search or sitemap).
                    </p>
                  )}
                </section>
              );
            })}
        </div>

        {/* CTA back to the product */}
        <section className="mt-16 rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-900/30 to-purple-800/10 p-6 text-center">
          <h2 className="text-xl font-bold text-white mb-2">
            Need full federal contracting intelligence?
          </h2>
          <p className="text-sm text-slate-400 mb-4 max-w-2xl mx-auto">
            {SITE_NAME} Market Intelligence gives you SAM.gov opportunities, recompete tracking,
            agency pain points, OSBP contacts, AI bid/no-bid analysis, and 7,700+ agency forecasts
            — all in one workspace.
          </p>
          <Link
            href="/market-intelligence"
            className="inline-block px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold"
          >
            Try Market Intelligence Free →
          </Link>
        </section>

        <footer className="mt-12 pt-6 border-t border-slate-800 text-xs text-slate-500 text-center">
          Data sources: USAspending.gov + SAM.gov, updated weekly.
        </footer>
      </div>
    </main>
  );
}

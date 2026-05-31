/**
 * /top — hub page linking to every /top/[slug] listicle.
 *
 * Static — no BQ. Pulls from src/data/top-listicles.ts so adding a
 * listicle automatically adds it to the hub.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { LISTICLES } from '@/data/top-listicles';

const SITE_URL = 'https://getmindy.ai';

export const metadata: Metadata = {
  title: 'Top Federal Contractor Lists — Rankings by Agency, NAICS, Set-Aside | Mindy',
  description:
    'Mindy ranks the top federal contractors by total obligated dollars. Lists by agency (DoD, VA, DHS), NAICS, and set-aside (8(a), HUBZone, SDVOSB, WOSB).',
  alternates: { canonical: `${SITE_URL}/top` },
  openGraph: {
    title: 'Top Federal Contractor Lists | Mindy',
    description:
      'Mindy ranks the top federal contractors by total obligated dollars across agency, NAICS, and SBA set-aside cohorts.',
    url: `${SITE_URL}/top`,
    type: 'website',
    siteName: 'Mindy',
  },
};

export default function TopHubPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Top Federal Contractor Lists',
    description:
      'Rankings of the top federal contractors by total obligated dollars across agency, NAICS, and SBA set-aside cohorts.',
    url: `${SITE_URL}/top`,
    hasPart: LISTICLES.map((l) => ({
      '@type': 'WebPage',
      name: l.title,
      url: `${SITE_URL}/top/${l.slug}`,
    })),
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-6xl px-6 pt-6 text-sm text-slate-400">
        <Link href="/" className="hover:text-purple-400">Home</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-300">Top Lists</span>
      </div>

      <section className="mx-auto max-w-6xl px-6 pt-6 pb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400">Rankings</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight">Top Federal Contractor Lists</h1>
        <p className="mt-4 max-w-3xl text-lg text-slate-300">
          The largest federal contractors ranked by total obligated dollars, sliced by agency, NAICS, and SBA
          set-aside cohort. All lists pull live from USAspending.gov (FY2016–FY2026).
        </p>
      </section>

      {/* Featured rankings (agency / NAICS / set-aside / branch) */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-4">By Sector</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {LISTICLES.filter((l) => l.kind !== 'state').map((l) => (
            <Link
              key={l.slug}
              href={`/top/${l.slug}`}
              className="block rounded-xl border border-slate-800 bg-slate-900 p-6 hover:border-purple-500/50 hover:bg-slate-800 transition-colors"
            >
              <h3 className="text-lg font-bold text-white">{l.title}</h3>
              <p className="mt-2 text-sm text-slate-400">{l.description}</p>
              <p className="mt-3 text-xs uppercase tracking-wider text-purple-300">
                View ranking →
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* State rankings — 51 entries, dense grid */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-4">By State</h2>
        <p className="text-sm text-slate-400 mb-4">
          The 50 largest federal contractors headquartered in each U.S. state plus DC.
        </p>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {LISTICLES.filter((l) => l.kind === 'state').map((l) => (
            <Link
              key={l.slug}
              href={`/top/${l.slug}`}
              className="block rounded-lg border border-slate-800 bg-slate-900 px-3 py-2.5 text-sm text-slate-200 hover:border-purple-500/50 hover:bg-slate-800 transition-colors"
            >
              {l.shortTitle.replace('Top Contractors in ', '')}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

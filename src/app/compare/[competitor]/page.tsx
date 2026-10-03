/**
 * /compare/[competitor] — data-driven "<competitor> alternative" pages (Phase 3 SEO).
 *
 * The hand-built /compare/govwin + /compare/sam-gov pages stay as bespoke routes;
 * this catch-all renders every entry in src/data/competitors.ts (HigherGov,
 * GovTribe, Bloomberg Gov, …) from data — ship many fast (Elon mode). Honest
 * comparison + FAQPage + SoftwareApplication JSON-LD for rich results.
 *
 * Note: Next resolves the static /compare/govwin + /compare/sam-gov routes before
 * this dynamic segment, so they are NOT shadowed. getCompetitor() also has no
 * govwin/sam-gov entry, so a stray hit would 404 (correct).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCompetitor, COMPETITORS } from '@/data/competitors';

export const dynamicParams = true;
export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ competitor: c.slug }));
}

const SITE_URL = 'https://getmindy.ai';

export async function generateMetadata({ params }: { params: Promise<{ competitor: string }> }): Promise<Metadata> {
  const { competitor } = await params;
  const c = getCompetitor(competitor);
  if (!c) return { title: 'Not found | Mindy' };
  const url = `${SITE_URL}/compare/${c.slug}`;
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    alternates: { canonical: url },
    openGraph: { title: c.metaTitle, description: c.metaDescription, type: 'website', url },
    keywords: c.keywords,
  };
}

export default async function ComparePage({ params }: { params: Promise<{ competitor: string }> }) {
  const { competitor } = await params;
  const c = getCompetitor(competitor);
  if (!c) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Mindy',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        offers: [
          { '@type': 'Offer', price: '0', priceCurrency: 'USD', name: 'Free' },
          { '@type': 'Offer', price: '149', priceCurrency: 'USD', name: 'Pro (monthly)' },
        ],
        url: SITE_URL,
      },
      {
        '@type': 'FAQPage',
        mainEntity: c.faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Compare', item: `${SITE_URL}/compare` },
          { '@type': 'ListItem', position: 3, name: `${c.name} alternative`, item: `${SITE_URL}/compare/${c.slug}` },
        ],
      },
    ],
  };

  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Hero */}
      <section className="py-16 px-4 bg-(--mp-wash)">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs font-semibold tracking-widest text-(--mp-navy) uppercase mb-3">The {c.name} alternative</p>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight font-(family-name:--mp-font-serif)">
            Mindy: the {c.name} alternative built for small federal contractors
          </h1>
          <p className="text-(--mp-body) mt-4 text-lg">{c.wedge}</p>
          <div className="mt-6 flex gap-3 justify-center flex-wrap">
            <Link href="/app" className="bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-semibold rounded-lg px-6 py-3">Start free →</Link>
            <Link href="/pricing" className="border border-(--mp-line) hover:border-(--mp-line) rounded-lg px-6 py-3">See pricing</Link>
          </div>
          <p className="text-xs text-(--mp-muted) mt-3">{c.name}: {c.pricing} · Mindy: free → $149/mo, no sales call</p>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* Comparison table */}
        <h2 className="text-2xl font-bold mb-4 font-(family-name:--mp-font-serif)">Mindy vs {c.name}</h2>
        <div className="overflow-x-auto rounded-lg border border-(--mp-line)">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-(--mp-surface) text-(--mp-muted) text-left">
                <th className="px-4 py-3 font-semibold"> </th>
                <th className="px-4 py-3 font-semibold">{c.name}</th>
                <th className="px-4 py-3 font-semibold text-(--mp-navy)">Mindy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--mp-line)">
              {c.rows.map(([dim, them, mindy]) => (
                <tr key={dim}>
                  <td className="px-4 py-3 text-(--mp-muted)">{dim}</td>
                  <td className="px-4 py-3 text-(--mp-body)">{them}</td>
                  <td className="px-4 py-3 text-(--mp-ink) font-medium">{mindy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* When to choose them — honest credibility */}
        <div className="mt-8 bg-(--mp-surface) border border-(--mp-line) rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2">When to choose {c.name} instead</h2>
          <p className="text-(--mp-body) text-sm leading-relaxed">{c.whenToChoose}</p>
        </div>

        {/* FAQ */}
        <h2 className="text-2xl font-bold mt-12 mb-4 font-(family-name:--mp-font-serif)">{c.name} alternative — FAQ</h2>
        <div className="space-y-4">
          {c.faqs.map((f) => (
            <div key={f.q} className="border border-(--mp-line) rounded-lg p-5">
              <h3 className="font-semibold text-(--mp-ink)">{f.q}</h3>
              <p className="text-(--mp-body) text-sm mt-2 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 text-center border border-(--mp-line) rounded-lg p-8 bg-(--mp-wash)">
          <h2 className="text-2xl font-bold font-(family-name:--mp-font-serif)">Try Mindy free — no sales call</h2>
          <p className="text-(--mp-body) mt-2">Daily federal opportunity alerts, grounded in real government data. Upgrade when you’re ready.</p>
          <Link href="/app" className="inline-block mt-5 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-semibold rounded-lg px-7 py-3">Start free →</Link>
        </div>

        {/* Cross-links to other compare pages */}
        <nav className="mt-10 pt-6 border-t border-(--mp-line) text-sm flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/compare" className="text-(--mp-navy) hover:underline">All comparisons →</Link>
          {COMPETITORS.filter((x) => x.slug !== c.slug).map((x) => (
            <Link key={x.slug} href={`/compare/${x.slug}`} className="text-(--mp-navy) hover:underline">{x.name} alternative →</Link>
          ))}
          <Link href="/compare/govwin" className="text-(--mp-navy) hover:underline">GovWin alternative →</Link>
        </nav>
      </div>
    </main>
  );
}

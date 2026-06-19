/**
 * /opportunity/[slug] — public, indexable landing page for one active SAM
 * opportunity. Phase 1 of Mindy's programmatic-SEO layer (own the index, like
 * HigherGov: a page per opportunity + "Similar Opportunities" cross-linking).
 *
 * ISR-only (no build prerender — 34k+ opps). Each page reads one row + a
 * NAICS-matched similar set, then edge-caches. Thin opps (no real body) 404 and
 * are kept out of the sitemap — Google penalizes thin pages.
 *
 * Keyword targets per page:
 *   - "<title> government contract"
 *   - "<solicitation number>"
 *   - "<naics> opportunity <agency>"
 *
 * Data discipline (rule #1): every field from sam_opportunities. No fabrication.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MemberAwareCta from '@/components/MemberAwareCta';
import {
  getOpportunityBySlug,
  getSimilarOpportunities,
  type SeoOpportunity,
} from '@/lib/seo/opportunities';

export const dynamicParams = true;
export const revalidate = 86400; // 1d — opps change (deadlines, amendments)

export async function generateStaticParams() {
  return []; // ISR-only; pages render on first crawl, then cache
}

const SITE_URL = 'https://getmindy.ai';

function clampDesc(s: string, n = 158): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 3).trimEnd()}...` : clean;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const opp = await getOpportunityBySlug(slug);
  if (!opp) {
    return {
      title: 'Opportunity not found | Mindy',
      description: 'This federal contract opportunity is no longer active or was not found.',
    };
  }
  const agency = opp.department || opp.subTier || 'a federal agency';
  const desc = clampDesc(
    `${opp.title} — federal contract opportunity from ${agency}` +
      (opp.solicitationNumber ? ` (Solicitation ${opp.solicitationNumber})` : '') +
      (opp.responseDeadline ? `. Responses due ${fmtDate(opp.responseDeadline)}.` : '. ') +
      ` Track it and draft your response with Mindy.`,
  );
  const url = `${SITE_URL}/opportunity/${slug}`;
  const titleStr = `${opp.title} — Federal Contract Opportunity | Mindy`;
  return {
    title: titleStr.length > 65 ? `${opp.title.slice(0, 50)}… — Federal Opportunity | Mindy` : titleStr,
    description: desc,
    alternates: { canonical: url },
    openGraph: { title: titleStr, description: desc, type: 'article', url },
    keywords: [
      `${opp.title.toLowerCase()} government contract`,
      opp.solicitationNumber ? `${opp.solicitationNumber} solicitation` : 'federal solicitation',
      opp.naicsCode ? `naics ${opp.naicsCode} opportunity` : 'federal opportunity',
      `${agency.toLowerCase()} contract opportunity`,
      'federal contract opportunity',
      'sam.gov opportunity',
      'mindy opportunity',
    ].filter(Boolean) as string[],
  };
}

function jsonLdFor(opp: SeoOpportunity, slug: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'GovernmentService',
        name: opp.title,
        serviceType: 'Federal Contract Opportunity',
        provider: {
          '@type': 'GovernmentOrganization',
          name: opp.department || opp.subTier || 'U.S. Federal Government',
        },
        description: clampDesc(opp.description || opp.title, 300),
        url: `${SITE_URL}/opportunity/${slug}`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Opportunities', item: `${SITE_URL}/opportunity-hunter` },
          { '@type': 'ListItem', position: 3, name: opp.title, item: `${SITE_URL}/opportunity/${slug}` },
        ],
      },
    ],
  };
}

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const opp = await getOpportunityBySlug(slug);
  if (!opp) notFound();

  const similar = await getSimilarOpportunities(opp);
  const agency = opp.department || opp.subTier || null;
  const body = (opp.sowText && opp.sowText.length > opp.description.length ? opp.sowText : opp.description) || '';

  return (
    <main className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFor(opp, slug)) }}
      />

      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Breadcrumb */}
        <nav className="text-xs text-gray-400 mb-4">
          <Link href="/" className="hover:text-gray-600">Home</Link>
          <span className="mx-1.5">/</span>
          <Link href="/opportunity-hunter" className="hover:text-gray-600">Opportunities</Link>
          <span className="mx-1.5">/</span>
          <span className="text-gray-500">{opp.noticeType || 'Opportunity'}</span>
        </nav>

        {/* Header */}
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 leading-tight">{opp.title}</h1>
        <p className="text-sm text-gray-500 mt-2">
          {agency && <span className="font-medium text-slate-700">{agency}</span>}
          {opp.office && <span> · {opp.office}</span>}
        </p>

        {/* Fact strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          {[
            ['Notice type', opp.noticeType],
            ['Solicitation #', opp.solicitationNumber],
            ['NAICS', opp.naicsCode],
            ['PSC', opp.pscCode],
            ['Set-aside', opp.setAsideDescription],
            ['Posted', fmtDate(opp.postedDate)],
            ['Response due', fmtDate(opp.responseDeadline)],
            ['Place of performance', [opp.popCity, opp.popState].filter(Boolean).join(', ') || null],
          ]
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <div key={label as string} className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{label}</div>
                <div className="text-sm text-slate-800 mt-0.5 break-words">{value}</div>
              </div>
            ))}
        </div>

        {/* AI analysis — unique, data-grounded content (Phase 4 enrichment) */}
        {opp.seoSummary && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">What this opportunity is</h2>
            <p className="text-slate-700 leading-relaxed">{opp.seoSummary}</p>
            <p className="text-xs text-gray-400 mt-2">Analysis by Mindy, grounded in the SAM.gov notice.</p>
          </section>
        )}

        {/* Body / description */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Description</h2>
          <div className="prose prose-sm max-w-none text-slate-700 whitespace-pre-wrap leading-relaxed">
            {body.slice(0, 6000)}
            {body.length > 6000 && '…'}
          </div>
          <p className="text-xs text-gray-400 mt-3">Source: SAM.gov, as posted. Verify the current solicitation before responding.</p>
        </section>

        {/* CTA — the Mindy pitch */}
        <div className="mt-8 bg-gradient-to-br from-indigo-50 to-purple-50 border border-purple-100 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-slate-900">Pursue this opportunity with Mindy</h2>
          <p className="text-sm text-slate-600 mt-1">
            See who holds it now, who else is bidding, and draft your response — grounded in real
            government data, not generic AI.
          </p>
          <div className="mt-4">
            <MemberAwareCta memberHref="/app" memberLabel="Open in Mindy →">
              <Link
                href="/app"
                className="inline-block bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg px-5 py-2.5 text-sm"
              >
                Track this free in Mindy →
              </Link>
            </MemberAwareCta>
          </div>
          {opp.uiLink && (
            <a href={opp.uiLink} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-purple-600 hover:underline mt-3">
              View the original notice on SAM.gov ↗
            </a>
          )}
        </div>

        {/* Similar Opportunities — the internal-link web (SEO juice) */}
        {similar.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              Similar Active Opportunities{opp.naicsCode ? ` (NAICS ${opp.naicsCode})` : ''}
            </h2>
            <div className="grid md:grid-cols-2 gap-3">
              {similar.map((s) => (
                <Link
                  key={s.slug}
                  href={`/opportunity/${s.slug}`}
                  className="block border border-gray-200 rounded-lg p-4 hover:border-purple-300 hover:bg-purple-50/30 transition-colors"
                >
                  <div className="text-sm font-medium text-slate-900 line-clamp-2">{s.title}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {[s.department, s.noticeType].filter(Boolean).join(' · ')}
                    {s.responseDeadline && ` · due ${fmtDate(s.responseDeadline)}`}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Cross-links to the broader SEO web */}
        <nav className="mt-10 pt-6 border-t border-gray-100 text-sm text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          {opp.naicsCode && (
            <Link href={`/naics/${opp.naicsCode}`} className="text-purple-600 hover:underline">
              More NAICS {opp.naicsCode} opportunities →
            </Link>
          )}
          <Link href="/opportunity-hunter" className="text-purple-600 hover:underline">Browse all opportunities →</Link>
          <Link href="/forecasts" className="text-purple-600 hover:underline">Upcoming forecasts →</Link>
        </nav>
      </div>
    </main>
  );
}

/**
 * Shared layout for Phase-2 faceted SEO pages (NAICS×state, PSC, set-aside×NAICS).
 * One component, three routes. Renders the active opps for the facet as
 * cross-linked cards + a Mindy CTA. Server component (no client JS).
 */
import Link from 'next/link';
import MemberAwareCta from '@/components/MemberAwareCta';
import type { FacetOpp } from '@/lib/seo/facets';

const SITE_URL = 'https://getmindy.ai';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function FacetPage({
  h1,
  intro,
  total,
  opps,
  crossLinks,
  canonicalPath,
  breadcrumb,
}: {
  h1: string;
  intro: string;
  total: number;
  opps: FacetOpp[];
  crossLinks: { href: string; label: string }[];
  /** Path of THIS facet page, e.g. `/psc/r425`. Enables the JSON-LD block. */
  canonicalPath?: string;
  /** Intermediate crumb between Home and this page, e.g. { name: 'NAICS', href: '/naics' }. */
  breadcrumb?: { name: string; href: string };
}) {
  /* Structured data. These three clusters (PSC 366 URLs, set-aside 235, NAICS×state)
     shipped with NO JSON-LD at all while their sibling clusters (/naics/[code],
     /agencies/[slug], /glossary) all carried it — measured live 2026-09-21. An
     ItemList of the real, linked opportunities is the honest description of the
     page: it lists what it lists, and only when it actually has rows. */
  const jsonLd = canonicalPath
    ? {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'CollectionPage',
            '@id': `${SITE_URL}${canonicalPath}#page`,
            name: h1,
            description: intro,
            url: `${SITE_URL}${canonicalPath}`,
            ...(opps.length > 0
              ? {
                  mainEntity: {
                    '@type': 'ItemList',
                    numberOfItems: opps.length,
                    itemListElement: opps.map((o, i) => ({
                      '@type': 'ListItem',
                      position: i + 1,
                      name: o.title,
                      url: `${SITE_URL}/opportunity/${o.slug}`,
                    })),
                  },
                }
              : {}),
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
              ...(breadcrumb
                ? [{ '@type': 'ListItem', position: 2, name: breadcrumb.name, item: `${SITE_URL}${breadcrumb.href}` }]
                : []),
              {
                '@type': 'ListItem',
                position: breadcrumb ? 3 : 2,
                name: h1,
                item: `${SITE_URL}${canonicalPath}`,
              },
            ],
          },
        ],
      }
    : null;

  return (
    <main className="min-h-screen bg-white">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <div className="max-w-4xl mx-auto px-4 py-10">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 leading-tight">{h1}</h1>
        <p className="text-sm text-gray-500 mt-2">{intro}</p>

        {opps.length > 0 ? (
          <>
            <p className="text-xs text-gray-400 mt-6 mb-3">
              {total.toLocaleString()} active {total === 1 ? 'opportunity' : 'opportunities'}
              {opps.length < total ? ` (showing ${opps.length})` : ''} · source: SAM.gov
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              {opps.map((o) => (
                <Link
                  key={o.slug}
                  href={`/opportunity/${o.slug}`}
                  className="block border border-gray-200 rounded-lg p-4 hover:border-purple-300 hover:bg-purple-50/30 transition-colors"
                >
                  <div className="text-sm font-medium text-slate-900 line-clamp-2">{o.title}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {[o.department, o.noticeType, o.setAside].filter(Boolean).join(' · ')}
                    {o.responseDeadline && fmtDate(o.responseDeadline) && ` · due ${fmtDate(o.responseDeadline)}`}
                  </div>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-500 mt-6">
            No active opportunities match right now. Set up a free alert in Mindy and get notified the
            moment one posts.
          </p>
        )}

        {/* CTA */}
        <div className="mt-8 bg-gradient-to-br from-indigo-50 to-purple-50 border border-purple-100 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-slate-900">Never miss one — track this market in Mindy</h2>
          <p className="text-sm text-slate-600 mt-1">
            Free daily alerts the moment a matching opportunity posts, plus who holds the work now and
            who&apos;s likely to bid — grounded in real government data.
          </p>
          <div className="mt-4">
            <MemberAwareCta memberHref="/app" memberLabel="Open Mindy →">
              <Link href="/app" className="inline-block bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg px-5 py-2.5 text-sm">
                Get free alerts in Mindy →
              </Link>
            </MemberAwareCta>
          </div>
        </div>

        {/* Cross-links — the internal web */}
        {crossLinks.length > 0 && (
          <nav className="mt-10 pt-6 border-t border-gray-100 text-sm flex flex-wrap gap-x-4 gap-y-1">
            {crossLinks.map((l) => (
              <Link key={l.href} href={l.href} className="text-purple-600 hover:underline">{l.label}</Link>
            ))}
          </nav>
        )}
      </div>
    </main>
  );
}

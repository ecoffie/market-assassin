/**
 * /recompetes — hub linking the soonest-expiring federal contracts that have a public record page.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * /recompetes/[slug] record pages were reachable only through the numbered recompete sitemaps.
 * This hub (linked from the site footer, /recompete and the forecasts hub) gives the soonest
 * ones a server-rendered link from a crawled page. /recompete (singular) stays the explainer +
 * member tool; this is the plural record family's index.
 *
 * DATA
 * ----
 * getRecompeteHubLinks: real rows only (`quality_flag IS NULL`), end date from today forward, the
 * sitemap's real-row filters applied IN the query before the limit, then the page's own thin gate
 * (recompeteIndexVerdict) so no link points at a noindex page. Supabase only, never BigQuery.
 * A read failure renders "temporarily unavailable" + noindex — never "no contracts expiring".
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { getRecompeteHubLinks, type RecompeteLink } from '@/lib/seo/recompetes';
import { formatCompanyName } from '@/lib/format-name';
import { formatMoneyCompact } from '@/lib/format-money';

const SITE_URL = 'https://getmindy.ai';
const HUB_LIMIT = 200;

export const revalidate = 21600; // 6h — end dates move with the hourly sync; a failed read is replaced soon

type HubLoad = { ok: true; links: RecompeteLink[] } | { ok: false };

const loadHub = cache(async (): Promise<HubLoad> => {
  try {
    return { ok: true, links: await getRecompeteHubLinks(HUB_LIMIT) };
  } catch (e) {
    console.error('[recompetes hub] read failed:', (e as Error).message);
    return { ok: false };
  }
});

export async function generateMetadata(): Promise<Metadata> {
  const hub = await loadHub();
  const url = `${SITE_URL}/recompetes`;
  const title = 'Federal Contracts Expiring Soon — Upcoming Recompetes | Mindy';
  const description =
    'The federal contracts whose period of performance ends soonest — incumbent, agency, value and end date for each, from USASpending award records. Track the recompete before the solicitation posts.';
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: hub.ok && hub.links.length > 0 ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, type: 'website', url },
  };
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Not stated';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? 'Not stated'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Group by awarding agency, largest group first; each group keeps the soonest-first order. */
function groupByAgency(links: RecompeteLink[]): Array<{ agency: string; links: RecompeteLink[] }> {
  const m = new Map<string, RecompeteLink[]>();
  for (const l of links) {
    const k = l.agency || 'Agency not stated';
    const g = m.get(k);
    if (g) g.push(l); else m.set(k, [l]);
  }
  return Array.from(m.entries())
    .map(([agency, ls]) => ({ agency, links: ls }))
    .sort((a, b) => b.links.length - a.links.length || a.agency.localeCompare(b.agency));
}

export default async function RecompetesHubPage() {
  const hub = await loadHub();
  const groups = hub.ok ? groupByAgency(hub.links) : [];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': `${SITE_URL}/recompetes#page`, name: 'Federal contracts expiring soon', url: `${SITE_URL}/recompetes` },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Recompetes', item: `${SITE_URL}/recompetes` },
        ],
      },
    ],
  };

  return (
    <main className="bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-5xl mx-auto px-4 py-10">
        <nav className="text-xs text-(--mp-muted) mb-4">
          <Link href="/" className="hover:underline">Home</Link>
          <span className="mx-1.5">/</span>
          <span>Recompetes</span>
        </nav>

        <h1 className="text-2xl md:text-3xl font-bold text-(--mp-ink) leading-tight font-(family-name:--mp-font-serif)">
          Federal contracts expiring soon
        </h1>
        <p className="mt-3 text-(--mp-body) max-w-3xl">
          When a contract&rsquo;s period of performance ends, the agency usually has to buy the work again.
          These are the contracts ending soonest, each with the incumbent, the agency, the value and the end
          date from the public award record.{' '}
          <Link href="/recompete" className="text-(--mp-navy) hover:underline">How recompetes work →</Link>
        </p>

        {!hub.ok ? (
          <div className="mt-8 rounded-lg border border-(--mp-line) bg-(--mp-surface) p-5 text-sm text-(--mp-body)">
            The contract list is temporarily unavailable. Please try again shortly.
          </div>
        ) : (
          <>
            <p className="mt-4 text-sm text-(--mp-muted)">
              The {hub.links.length.toLocaleString('en-US')} soonest-ending contracts with a full public record
              (named incumbent, agency, stated value), grouped by agency. This is the start of the list, not every
              expiring contract.
            </p>
            {groups.map((g) => (
              <section key={g.agency} className="mt-10">
                <h2 className="text-xl font-bold text-(--mp-ink) font-(family-name:--mp-font-serif)">{g.agency}</h2>
                <ul className="mt-3 divide-y divide-(--mp-hair)">
                  {g.links.map((l) => (
                    <li key={l.contract_id} className="flex items-baseline justify-between gap-4 py-2">
                      <Link href={l.href} className="text-sm text-(--mp-navy) hover:underline">
                        {formatCompanyName(l.incumbent_name || '')}
                        {l.piid && <span className="ml-2 font-(family-name:--mp-font-mono) text-xs text-(--mp-muted)">{l.piid}</span>}
                        {l.subAgency && l.subAgency !== l.agency && (
                          <span className="block text-xs text-(--mp-muted)">{l.subAgency}</span>
                        )}
                      </Link>
                      <span className="shrink-0 text-right text-xs text-(--mp-muted)">
                        ends {fmtDate(l.end)}
                        {l.value != null && <span className="block font-(family-name:--mp-font-mono)">{formatMoneyCompact(l.value)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        <div className="mt-12 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/forecasts" className="text-(--mp-navy) hover:underline">Agency forecasts →</Link>
          <Link href="/offices" className="text-(--mp-navy) hover:underline">DoD buying offices →</Link>
          <Link href="/contractors" className="text-(--mp-navy) hover:underline">Contractor database →</Link>
          <Link href="/agencies" className="text-(--mp-navy) hover:underline">Agency directory →</Link>
        </div>
      </div>
    </main>
  );
}

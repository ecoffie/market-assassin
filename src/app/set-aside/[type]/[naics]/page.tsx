/**
 * /set-aside/[type]/[naics] — "8(a)/HUBZone/SDVOSB/WOSB opportunities in NAICS X".
 * Phase 2 SEO. High commercial intent — set-aside searchers are qualified small
 * businesses (Mindy's exact buyer). ISR.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import FacetPage from '@/components/seo/FacetPage';
import { getSetAsideNaicsOpps, SET_ASIDE_LABELS } from '@/lib/seo/facets';

export const dynamicParams = true;
export const revalidate = 86400;
export async function generateStaticParams() { return []; }

const SITE_URL = 'https://getmindy.ai';

export async function generateMetadata({ params }: { params: Promise<{ type: string; naics: string }> }): Promise<Metadata> {
  const { type, naics } = await params;
  const label = SET_ASIDE_LABELS[type.toLowerCase()];
  if (!label) return { title: 'Not found | Mindy' };
  const title = `${label} Opportunities — NAICS ${naics} | Mindy`;
  const description = `Active ${label} set-aside federal opportunities under NAICS ${naics}. Daily alerts and incumbent intel for small businesses in Mindy.`;
  const url = `${SITE_URL}/set-aside/${type.toLowerCase()}/${naics}`;
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, type: 'website', url },
    keywords: [
      `${type.toLowerCase()} contracts naics ${naics}`,
      `${label.toLowerCase()} opportunities`,
      `${type.toLowerCase()} set aside ${naics}`,
      `small business set aside naics ${naics}`,
    ],
  };
}

export default async function SetAsideNaicsPage({ params }: { params: Promise<{ type: string; naics: string }> }) {
  const { type, naics } = await params;
  const slug = type.toLowerCase();
  const label = SET_ASIDE_LABELS[slug];
  if (!label || !/^\d{4,6}$/.test(naics)) notFound();

  const { opps, total } = await getSetAsideNaicsOpps(slug, naics);

  return (
    <FacetPage
      h1={`${label} Opportunities — NAICS ${naics}`}
      intro={`Active ${label} set-aside federal contract opportunities classified under NAICS ${naics}.`}
      total={total}
      opps={opps}
      crossLinks={[
        { href: `/naics/${naics}`, label: `All NAICS ${naics} opportunities →` },
        { href: '/opportunity-hunter', label: 'Browse all opportunities →' },
        { href: '/forecasts', label: 'Upcoming forecasts →' },
      ]}
    />
  );
}

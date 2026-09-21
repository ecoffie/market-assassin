/**
 * /psc/[code] — Product Service Code opportunities page. Phase 2 SEO.
 * PSC = "what was actually bought" (the GovCon-pro axis HigherGov has, we lacked). ISR.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import FacetPage from '@/components/seo/FacetPage';
import { getPscOpps } from '@/lib/seo/facets';

export const dynamicParams = true;
export const revalidate = 86400;
export async function generateStaticParams() { return []; }

const SITE_URL = 'https://getmindy.ai';

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const psc = code.toUpperCase();
  const title = `PSC ${psc} Federal Contract Opportunities | Mindy`;
  const description = `Active federal opportunities under Product Service Code (PSC) ${psc} — what the government is actually buying. Daily alerts and market intel in Mindy.`;
  const url = `${SITE_URL}/psc/${code.toLowerCase()}`;
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, type: 'website', url },
    keywords: [`psc ${psc}`, `psc ${psc} federal contracts`, `product service code ${psc}`, `what is psc ${psc}`, 'government contract opportunities'],
  };
}

export default async function PscPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const psc = code.toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(psc)) notFound();

  const { opps, total } = await getPscOpps(psc);

  return (
    <FacetPage
      h1={`PSC ${psc} — Federal Contract Opportunities`}
      intro={`Active federal opportunities under Product Service Code ${psc}. PSC describes what the government is actually buying — the most precise way to find your market.`}
      total={total}
      opps={opps}
      crossLinks={[
        { href: '/opportunity-hunter', label: 'Browse all opportunities →' },
        { href: '/naics', label: 'Browse by NAICS →' },
        { href: '/forecasts', label: 'Upcoming forecasts →' },
      ]}
    />
  );
}

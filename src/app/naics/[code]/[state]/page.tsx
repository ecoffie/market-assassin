/**
 * /naics/[code]/[state] — faceted page: "NAICS X opportunities in [State]".
 * Phase 2 SEO. Geo+category long-tail (the Yelp pattern). ISR.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import FacetPage from '@/components/seo/FacetPage';
import { getNaicsStateOpps, US_STATES } from '@/lib/seo/facets';

export const dynamicParams = true;
export const revalidate = 86400;
export async function generateStaticParams() { return []; }

const SITE_URL = 'https://getmindy.ai';

export async function generateMetadata({ params }: { params: Promise<{ code: string; state: string }> }): Promise<Metadata> {
  const { code, state } = await params;
  const st = US_STATES[state.toUpperCase()];
  if (!st) return { title: 'Not found | Mindy' };
  const title = `NAICS ${code} Federal Opportunities in ${st} | Mindy`;
  const description = `Active federal contract opportunities for NAICS ${code} with place of performance in ${st}. Daily alerts, incumbent intel, and response drafting in Mindy.`;
  const url = `${SITE_URL}/naics/${code}/${state.toLowerCase()}`;
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, type: 'website', url },
    keywords: [
      `naics ${code} ${st.toLowerCase()}`,
      `federal contracts ${st.toLowerCase()} naics ${code}`,
      `government contracts ${st.toLowerCase()}`,
      `naics ${code} opportunities`,
    ],
  };
}

export default async function NaicsStatePage({ params }: { params: Promise<{ code: string; state: string }> }) {
  const { code, state } = await params;
  const stCode = state.toUpperCase();
  const st = US_STATES[stCode];
  if (!st || !/^\d{4,6}$/.test(code)) notFound();

  const { opps, total } = await getNaicsStateOpps(code, stCode);

  return (
    <FacetPage
      h1={`NAICS ${code} Federal Opportunities in ${st}`}
      intro={`Active federal contract opportunities classified under NAICS ${code} with a place of performance in ${st}.`}
      total={total}
      opps={opps}
      crossLinks={[
        { href: `/naics/${code}`, label: `All NAICS ${code} opportunities →` },
        { href: '/opportunity-hunter', label: 'Browse all opportunities →' },
        { href: '/forecasts', label: 'Upcoming forecasts →' },
      ]}
    />
  );
}

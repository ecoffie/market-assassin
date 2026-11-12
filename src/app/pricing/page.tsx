/**
 * /pricing — Mindy pricing page.
 *
 * Target: replace the getmindy.ai/pricing 404 with a real conversion
 * surface. The wedge is honest pricing transparency — GovWin charges
 * $15K-$50K/yr because they sell to enterprise primes. Mindy is
 * $149/mo because we built for the 1-25 person small business that
 * never could afford enterprise market intel.
 *
 * Server component shell (metadata + JSON-LD). The visible page is SimplePricing:
 * Pro / Team / Enterprise, 14-day trial, no Free plan (Nov 2026). The credit-only
 * MCP plans keep the UnifiedPricing surface at /mcp/pricing.
 *
 * Schema: Organization @id is shared with the Mindy landing page so
 * Google consolidates brand entity. SoftwareApplication offers
 * exactly mirror the visible price cards. FAQPage mirrors the
 * visible FAQ. NO aggregateRating — adding fake reviews is a Google
 * penalty risk and we don't have real ones yet.
 */
import type { Metadata } from 'next';
import SimplePricing from '@/components/public-site/pricing/SimplePricing';
import { appPricingFaqs } from '@/components/public-site/pricing/faqs';
// Server component, so the credit constants are imported directly — the same values
// /api/mcp/catalog serves as `tierCredits` and the grant cron actually pays out.
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS } from '@/lib/mcp/packages';
// Corpus counts come from ONE place — see the file header for why (they were hand-typed
// in 32 spots and every one understated the real table by 4.3x).
import { forecastsLabel } from '@/lib/marketing-stats';

// Checkout links live in src/components/public-site/pricing/app-plan-links.ts.
// FAQ is mirrored in JSON-LD below — same list the page renders.
const faqs = appPricingFaqs({ proCredits: PRO_MONTHLY_CREDITS, teamCredits: TEAM_MONTHLY_CREDITS });

export const metadata: Metadata = {
  title: 'Pricing — Pro, Team and Enterprise | Mindy',
  description:
    'Pro at $149/mo, Team at $499/mo, both with a 14-day free trial. Save up to 33% billed annually. 100x cheaper than GovWin.',
  alternates: {
    canonical: 'https://getmindy.ai/pricing',
  },
  keywords: [
    'mindy pricing',
    'federal market intelligence pricing',
    'govcon software pricing',
    'cheap govwin alternative',
    'small business federal contracting tools',
  ],
  openGraph: {
    title: 'Mindy Pricing — Pro, Team and Enterprise. 14-day free trial.',
    description:
      'Same federal market intelligence as the $15K/yr enterprise tools, at a price small business can actually pay.',
    type: 'website',
    url: 'https://getmindy.ai/pricing',
  },
};

export default function PricingPage() {
  // JSON-LD graph. Organization @id matches the landing + comparison
  // pages so Google consolidates brand entity. SoftwareApplication
  // offers mirror the visible price cards (Pro, Team; Enterprise is quote-only).
  // FAQPage mirrors the visible FAQ. No aggregateRating — penalty risk.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://getmindy.ai/#organization',
        name: 'Mindy',
        alternateName: 'Mindy AI',
        url: 'https://getmindy.ai',
        logo: 'https://getmindy.ai/icon.png',
        description: 'AI-powered federal market intelligence for small business contractors.',
        email: 'admin@getmindy.ai',
        sameAs: ['https://govcongiants.org'],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': 'https://getmindy.ai/#software',
        name: 'Mindy',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description:
          `Federal market intelligence platform for small business contractors. Daily opportunity briefings, recompete alerts, competitor tracking, and ${forecastsLabel} agency forecasts.`,
        offers: [
          {
            '@type': 'Offer',
            name: 'Pro',
            price: '149',
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '149',
              priceCurrency: 'USD',
              unitCode: 'MON',
            },
          },
          {
            '@type': 'Offer',
            name: 'Team',
            price: '499',
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '499',
              priceCurrency: 'USD',
              unitCode: 'MON',
            },
          },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': 'https://getmindy.ai/pricing#faq',
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SimplePricing proCredits={PRO_MONTHLY_CREDITS} teamCredits={TEAM_MONTHLY_CREDITS} forecastsLabel={forecastsLabel} faqs={faqs} />
    </>
  );
}

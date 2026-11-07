/**
 * getmindy.ai/mcp/pricing — the MCP credit plans.
 *
 * Renders the same UnifiedPricing surface as /pricing, with the "MCP Credits" tab
 * selected first. Both URLs stay live; only the default tab differs.
 *
 * Plan prices + Stripe payment links come from the public /api/mcp/catalog, with a
 * static fallback inside UnifiedPricing that MUST stay in sync with SUBSCRIPTION_PLANS
 * in src/lib/mcp/packages.ts (same fallback this page shipped before the redesign).
 */
import type { Metadata } from 'next';
import UnifiedPricing from '@/components/public-site/pricing/UnifiedPricing';
import { pricingFaqs } from '@/components/public-site/pricing/faqs';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS } from '@/lib/mcp/packages';
import { SIGNUP_CREDITS } from '@/lib/mcp/credits';
import { forecastsLabel } from '@/lib/marketing-stats';

export const metadata: Metadata = {
  title: 'MCP Credit Pricing — Mindy for Claude, Cursor & any AI agent | Mindy',
  description:
    'Metered federal-contracting credits for any AI agent. Free signup credits, then Entry, Mid, Growth or Agency plans — charged only on successful calls.',
  alternates: { canonical: 'https://getmindy.ai/mcp/pricing' },
};

export default function McpPricingPage() {
  return (
    <UnifiedPricing
      initialTab="mcp"
      proCredits={PRO_MONTHLY_CREDITS}
      teamCredits={TEAM_MONTHLY_CREDITS}
      signupCredits={SIGNUP_CREDITS}
      forecastsLabel={forecastsLabel}
      faqs={pricingFaqs({ signupCredits: SIGNUP_CREDITS, proCredits: PRO_MONTHLY_CREDITS, teamCredits: TEAM_MONTHLY_CREDITS })}
    />
  );
}

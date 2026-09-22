import type { Metadata } from 'next';

export const metadata: Metadata = {
  // Self-canonical. Without this the ROOT layout's `alternates: { canonical: '/' }`
  // default applies and this page tells Google to index the homepage instead of
  // itself. Measured on production 2026-09-21 by crawling all 36,070 sitemap
  // URLs: this page canonicalised to https://getmindy.ai.
  alternates: { canonical: 'https://getmindy.ai/opportunity-hunter' },
  title: 'Opportunity Hunter | Mindy',
  description: 'Discover 50+ agencies awarding contracts to businesses like yours. Find federal contracting opportunities.',
};

export default function OpportunityHunterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

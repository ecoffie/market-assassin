import type { Metadata } from 'next';

export const metadata: Metadata = {
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

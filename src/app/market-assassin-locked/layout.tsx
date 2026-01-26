import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Federal Market Assassin | GovCon Giants',
  description: 'Generate comprehensive strategic reports from just 5 inputs.',
};

export default function MarketAssassinLockedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Federal Market Assassin | GovCon Giants',
  description: 'Generate comprehensive strategic reports from just 5 inputs. The ultimate government contracting intelligence tool.',
};

export default function FederalMarketAssassinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

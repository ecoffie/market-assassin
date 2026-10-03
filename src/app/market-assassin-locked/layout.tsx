import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';

export const metadata: Metadata = {
  title: 'Federal Market Assassin | GovCon Giants',
  description: 'Generate comprehensive strategic reports from just 5 inputs.',
};

export default function MarketAssassinLockedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}

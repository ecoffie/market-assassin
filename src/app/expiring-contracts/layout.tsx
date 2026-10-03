import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';

export const metadata: Metadata = {
  title: 'Expiring Contracts Tracker | GovCon Giants',
  description: 'Track expiring federal contracts and find recompete opportunities.',
};

export default function ExpiringContractsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}

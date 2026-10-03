import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';

export const metadata: Metadata = {
  title: 'Federal Contractor Database | GovCon Giants',
  description: 'Access 3,500+ prime contractors with subcontracting plans seeking small business partners.',
};

export default function DatabaseLockedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}

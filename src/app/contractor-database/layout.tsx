import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Federal Contractor Database | GovCon Giants',
  description: 'Find 3,500+ prime contractors with subcontracting plans seeking small business partners.',
};

export default function ContractorDatabaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

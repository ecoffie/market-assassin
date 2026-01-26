import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tier-2 Supplier Directory | GovCon Giants',
  description: '50+ prime contractor supplier contacts with vendor registration portal links.',
};

export default function Tier2DirectoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

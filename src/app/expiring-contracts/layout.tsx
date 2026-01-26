import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Expiring Contracts Tracker | GovCon Giants',
  description: 'Track expiring federal contracts and find recompete opportunities.',
};

export default function ExpiringContractsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

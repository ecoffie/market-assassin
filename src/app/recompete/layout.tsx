import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Recompete Contracts Tracker | GovCon Giants',
  description: 'Track expiring federal contracts and find recompete opportunities. 6,900+ contracts worth $77T+ in potential value.',
};

export default function RecompeteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

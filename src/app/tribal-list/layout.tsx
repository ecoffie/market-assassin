import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tribal Contractor List | GovCon Giants',
  description: '500+ Native American-owned federal contractors for teaming opportunities.',
};

export default function TribalListLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

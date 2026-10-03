import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';

export const metadata: Metadata = {
  title: 'Tribal Contractor List | Mindy',
  description: '500+ Native American-owned federal contractors for teaming opportunities.',
};

export default function TribalListLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}

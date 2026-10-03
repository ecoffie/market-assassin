import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';

export const metadata: Metadata = {
  title: 'December Spend Forecast | Mindy',
  description: 'Year-end government spending predictions with hot agencies and categories.',
};

export default function DecemberSpendLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}

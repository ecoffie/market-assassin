import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'December Spend Forecast | GovCon Giants',
  description: 'Year-end government spending predictions with hot agencies and categories.',
};

export default function DecemberSpendLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

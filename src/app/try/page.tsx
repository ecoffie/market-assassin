import type { Metadata } from 'next';
import { TryLanding } from '@/components/beginner/TryLanding';

export const metadata: Metadata = {
  title: 'See where the government buys what you sell — Mindy',
  description:
    'Describe your business in plain English and see current federal opportunities. No NAICS or PSC knowledge required.',
  alternates: { canonical: '/try' },
};

export default function TryPage() {
  return <TryLanding />;
}

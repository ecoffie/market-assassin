import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';

export const metadata: Metadata = {
  title: 'Mindy Ambassadors | Mindy',
  description: 'Apply to the Mindy Ambassadors program: use Mindy unlimited, shape the product with your feedback, and earn by sharing it with your audience.',
  alternates: { canonical: 'https://getmindy.ai/ambassadors' },
  openGraph: {
    title: 'Mindy Ambassadors',
    description: 'Use Mindy unlimited, shape the product, and earn by sharing it.',
    url: 'https://getmindy.ai/ambassadors',
  },
};

export default function AmbassadorsLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}

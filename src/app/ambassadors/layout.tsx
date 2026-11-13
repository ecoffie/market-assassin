import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';

const DESCRIPTION = 'Fifty federal contractors. Twelve months of Mindy. One public post a week showing what you actually did with it.';

export const metadata: Metadata = {
  title: 'Mindy Ambassador Program | Mindy',
  description: DESCRIPTION,
  alternates: { canonical: 'https://getmindy.ai/ambassadors' },
  openGraph: {
    title: 'Mindy Ambassador Program',
    description: DESCRIPTION,
    url: 'https://getmindy.ai/ambassadors',
  },
};

export default function AmbassadorsLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}

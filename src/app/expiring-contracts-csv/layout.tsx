import type { ReactNode } from 'react';
import PublicShell from '@/components/public-site/PublicShell';

export default function ProductLayout({ children }: { children: ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}

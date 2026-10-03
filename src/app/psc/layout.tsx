import type { ReactNode } from 'react';
import PublicShell from '@/components/public-site/PublicShell';

export default function PscLayout({ children }: { children: ReactNode }) {
  return <PublicShell contentElement="div">{children}</PublicShell>;
}

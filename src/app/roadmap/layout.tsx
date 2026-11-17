import type { ReactNode } from 'react';
import PublicShell from '@/components/public-site/PublicShell';

/** /roadmap renders inside the shared public shell (homepage top bar + footer). */
export default function RoadmapLayout({ children }: { children: ReactNode }) {
  return <PublicShell contentElement="div">{children}</PublicShell>;
}

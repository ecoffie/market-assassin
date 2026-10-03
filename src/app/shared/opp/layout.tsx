import type { ReactNode } from 'react';
import PublicShell from '@/components/public-site/PublicShell';

/** The family's pages render their own <main>, so the shell's content element is a div. */
export default function Layout({ children }: { children: ReactNode }) {
  return <PublicShell contentElement="div">{children}</PublicShell>;
}

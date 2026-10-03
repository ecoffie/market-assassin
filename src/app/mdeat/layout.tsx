import type { ReactNode } from 'react';
import PublicShell from '@/components/public-site/PublicShell';

/** PartnerLandingPage renders its own <main>, so the shell uses a div landmark. */
export default function PartnerLayout({ children }: { children: ReactNode }) {
  return <PublicShell contentElement="div">{children}</PublicShell>;
}

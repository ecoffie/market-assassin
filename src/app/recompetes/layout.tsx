import type { ReactNode } from 'react';
import PublicShell from '@/components/public-site/PublicShell';

/**
 * One public frame for the whole /recompetes family — the hub and every /recompetes/[slug] record
 * page (moved up from [slug]/layout.tsx so the two never double-wrap). Pages render their own <main>.
 */
export default function RecompetesLayout({ children }: { children: ReactNode }) {
  return <PublicShell contentElement="div">{children}</PublicShell>;
}

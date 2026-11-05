import type { ReactNode } from 'react';
import PublicShell from '@/components/public-site/PublicShell';

// chrome={false}: the homepage brings its own top bar, event banner and footer.
export default function HomeLayout({ children }: { children: ReactNode }) {
  return <PublicShell chrome={false} contentElement="div">{children}</PublicShell>;
}

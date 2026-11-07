import type { ReactNode } from 'react';
import PublicShell from '@/components/public-site/PublicShell';

// The sign-up page wears the public site's look (homepage tokens, fonts, light canvas), not the
// dark app theme. chrome={false}: the page draws its own slim logo bar, like the homepage.
export default function SignupLayout({ children }: { children: ReactNode }) {
  return <PublicShell chrome={false} contentElement="div">{children}</PublicShell>;
}

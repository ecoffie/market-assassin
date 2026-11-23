import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import PublicShell from '@/components/public-site/PublicShell';

// The page is a client component, so its route metadata lives here. Without its own canonical
// the route inherits the root layout's '/' and claims to be a copy of the homepage.
export const metadata: Metadata = {
  alternates: { canonical: '/mcp/tools' },
};

export default function McpToolsLayout({ children }: { children: ReactNode }) {
  return <PublicShell contentElement="div">{children}</PublicShell>;
}

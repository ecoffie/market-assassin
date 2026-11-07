import type { ReactNode } from 'react';
import Link from 'next/link';
import PublicShell from '@/components/public-site/PublicShell';

// The post-signup pages (/welcome, /welcome/company) wear the homepage look, like /signup:
// light canvas, navy, serif headings, and a slim logo bar instead of the full site nav.
export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return (
    <PublicShell chrome={false} contentElement="div">
      <header className="flex h-16 items-center px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-[20px] font-bold tracking-[-0.02em] text-(--mp-ink) no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element -- brand mark, same file as the site header */}
          <img src="/brand/mindy-logo-icon.png" alt="" className="h-7 w-7" />
          <span>Mindy</span>
        </Link>
      </header>
      {children}
    </PublicShell>
  );
}

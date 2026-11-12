import type { ReactNode } from 'react';
import Link from 'next/link';
import PublicShell from '@/components/public-site/PublicShell';

// No site menu or footer on the event page (2026-11-12): every link out is a lost registration.
// Logo only, like the sign-up page.
export default function LazyBlueprintLayout({ children }: { children: ReactNode }) {
  return (
    <PublicShell chrome={false} contentElement="div">
      <header style={{ padding: '18px 24px', borderBottom: '1px solid var(--mp-hair)' }}>
        <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'var(--mp-ink)', fontWeight: 700, fontSize: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the brand mark, same file as the site header */}
          <img src="/brand/mindy-logo-icon.png" alt="" width={28} height={28} />
          <span>Mindy</span>
        </Link>
      </header>
      {children}
    </PublicShell>
  );
}

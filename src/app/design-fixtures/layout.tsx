import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Test fixtures for the public design system (scripts/verify-public-site.mjs). Available on
 * local and preview builds only; production returns 404, and the pages are never indexable.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function DesignFixturesLayout({ children }: { children: ReactNode }) {
  if (process.env.VERCEL_ENV === 'production') notFound();
  return children;
}

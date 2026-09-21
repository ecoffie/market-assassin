import type { Metadata } from 'next';

/**
 * `/free-resources` is a `'use client'` page with no metadata export of its own,
 * so the ROOT layout's `alternates: { canonical: '/' }` default applied and the
 * page told Google to index the homepage instead of itself.
 *
 * Measured on production 2026-09-21 by crawling all 36,070 sitemap URLs: this
 * page returned 200 with `<link rel="canonical" href="https://getmindy.ai">`.
 * It is advertised in sitemap.xml, so it was a sitemap entry pointing at a URL
 * that disclaims itself.
 *
 * A layout is the minimal fix: a client page cannot export `metadata`, and
 * changing the root default would silently re-point every page that currently
 * relies on it.
 */
export const metadata: Metadata = {
  title: 'Free GovCon Resources — Templates, Guides & Tools | Mindy',
  description:
    'Free federal contracting resources: capability statement templates, market research guides and tools for small businesses selling to the government.',
  alternates: { canonical: 'https://getmindy.ai/free-resources' },
};

export default function FreeResourcesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

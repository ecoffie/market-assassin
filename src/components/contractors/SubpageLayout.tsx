/**
 * Shared layout wrapper for contractor sub-pages.
 *
 * Every sub-page (`/contractors/[slug]/contracts`, `/agencies`, `/naics`)
 * uses this. It owns the breadcrumb, the contractor identity strip,
 * and the tab nav so users can move between sub-pages without re-
 * fetching the recipient summary on the page itself.
 *
 * Server component — no client JS needed. Tabs are plain Link nav.
 *
 * BackToAppHeader is a client component; it hydrates and only renders for
 * authenticated visitors (anonymous SEO traffic sees nothing). Deep-links
 * back to the same contractor in the in-app drawer.
 */
import Link from 'next/link';
import BackToAppHeader from '@/components/BackToAppHeader';
import { SUBPAGE_MIN_ROWS } from '@/lib/bigquery/recipients';

interface SubpageTab {
  href: string;
  label: string;
  active?: boolean;
}

interface Props {
  slug: string;
  displayName: string;
  totalObligated: string;
  awardCount: number;
  agencyCount: number;
  naicsCount: number;
  activeTab: 'overview' | 'contracts' | 'agencies' | 'naics';
  children: React.ReactNode;
}

export function SubpageLayout({
  slug,
  displayName,
  totalObligated,
  awardCount,
  agencyCount,
  naicsCount,
  activeTab,
  children,
}: Props) {
  // Only show the /agencies and /naics tabs when they clear the same
  // SUBPAGE_MIN_ROWS thin-page gate those pages enforce with notFound() — else
  // the nav links Googlebot to 404s. The active tab is always kept (you're on a
  // page that already passed the gate). Mirrors the contractor profile + sitemap.
  const tabs: SubpageTab[] = [
    { href: `/contractors/${slug}`, label: 'Overview', active: activeTab === 'overview' },
    { href: `/contractors/${slug}/contracts`, label: 'Contracts', active: activeTab === 'contracts' },
    ...(agencyCount >= SUBPAGE_MIN_ROWS || activeTab === 'agencies'
      ? [{ href: `/contractors/${slug}/agencies`, label: 'Agencies', active: activeTab === 'agencies' }]
      : []),
    ...(naicsCount >= SUBPAGE_MIN_ROWS || activeTab === 'naics'
      ? [{ href: `/contractors/${slug}/naics`, label: 'NAICS', active: activeTab === 'naics' }]
      : []),
  ];

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <BackToAppHeader slug={slug} company={displayName} />
      {/* Breadcrumb */}
      <div className="mx-auto max-w-6xl px-6 pt-6 text-sm text-slate-400">
        <Link href="/" className="hover:text-purple-400">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/contractors" className="hover:text-purple-400">Contractors</Link>
        <span className="mx-2">/</span>
        <Link href={`/contractors/${slug}`} className="hover:text-purple-400">{displayName}</Link>
        {activeTab !== 'overview' && (
          <>
            <span className="mx-2">/</span>
            <span className="text-slate-300 capitalize">{activeTab}</span>
          </>
        )}
      </div>

      {/* Compact identity strip */}
      <section className="mx-auto max-w-6xl px-6 pt-6 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400">
          Federal Contractor Profile
        </p>
        <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">{displayName}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-400">
          <span>
            <span className="font-mono text-purple-300 font-semibold">{totalObligated}</span> obligated
          </span>
          <span>·</span>
          <span>{awardCount.toLocaleString()} awards</span>
          <span>·</span>
          <span>{agencyCount} agencies</span>
          <span>·</span>
          <span>{naicsCount} NAICS</span>
        </div>
      </section>

      {/* Tabs */}
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex gap-1 border-b border-slate-800 overflow-x-auto">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab.active
                  ? 'border-purple-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
    </main>
  );
}

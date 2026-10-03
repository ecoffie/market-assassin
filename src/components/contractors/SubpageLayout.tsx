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
  const tabs: SubpageTab[] = [
    { href: `/contractors/${slug}`, label: 'Overview', active: activeTab === 'overview' },
    { href: `/contractors/${slug}/contracts`, label: 'Contracts', active: activeTab === 'contracts' },
    { href: `/contractors/${slug}/agencies`, label: 'Agencies', active: activeTab === 'agencies' },
    { href: `/contractors/${slug}/naics`, label: 'NAICS', active: activeTab === 'naics' },
  ];

  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <BackToAppHeader slug={slug} company={displayName} />
      {/* Breadcrumb */}
      <div className="mx-auto max-w-6xl px-6 pt-6 text-sm text-(--mp-muted)">
        <Link href="/" className="hover:text-(--mp-navy-hover)">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/contractors" className="hover:text-(--mp-navy-hover)">Contractors</Link>
        <span className="mx-2">/</span>
        <Link href={`/contractors/${slug}`} className="hover:text-(--mp-navy-hover)">{displayName}</Link>
        {activeTab !== 'overview' && (
          <>
            <span className="mx-2">/</span>
            <span className="text-(--mp-body) capitalize">{activeTab}</span>
          </>
        )}
      </div>

      {/* Compact identity strip */}
      <section className="mx-auto max-w-6xl px-6 pt-6 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--mp-navy)">
          Federal Contractor Profile
        </p>
        <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight font-(family-name:--mp-font-serif)">{displayName}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-(--mp-muted)">
          <span>
            <span className="font-(family-name:--mp-font-mono) text-(--mp-navy) font-semibold">{totalObligated}</span> obligated
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
        <div className="flex gap-1 border-b border-(--mp-line) overflow-x-auto">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab.active
                  ? 'border-(--mp-navy) text-(--mp-ink)'
                  : 'border-transparent text-(--mp-muted) hover:text-(--mp-ink) hover:border-(--mp-line)'
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

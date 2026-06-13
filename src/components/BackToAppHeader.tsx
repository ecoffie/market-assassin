'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Sticky "back to Mindy app" bar shown ONLY to authenticated users on the
 * public SEO contractor pages (/contractors and /contractors/[slug]).
 *
 * Why this exists:
 * The contractor public pages are server-rendered SEO pages — no app shell,
 * no sidebar. When a logged-in user lands on one (from a Google result, a
 * shared link, or a stale in-app navigation), there's no obvious path back
 * into the app. This bar gives them one click home.
 *
 * Auth detection mirrors MemberAwareCta — checks localStorage tokens. Server
 * can't read them, so the bar only appears post-hydration. Anonymous visitors
 * see nothing (no flash, no shift) since we start in `null` state and render
 * nothing until checked.
 *
 * Context-aware: when given `slug` + `company`, the back link deep-links to
 * the in-app full ContractorProfileView for that specific contractor — so the
 * user lands at the same firm they were just looking at, but inside the app
 * shell.
 */
export default function BackToAppHeader({
  slug,
  company,
}: {
  /** Contractor slug — when present, back link opens that profile in-app. */
  slug?: string;
  /** Contractor display name — required when slug is provided. */
  company?: string;
}) {
  const [member, setMember] = useState<boolean | null>(null);

  // useEffect never runs on the server, so the `typeof window === 'undefined'`
  // SSR branch is unreachable and lint complains about a synchronous
  // setState in an effect. Initial state stays `null` (renders nothing),
  // then post-hydration we read the localStorage tokens once.
  useEffect(() => {
    setMember(Boolean(
      localStorage.getItem('mi_beta_auth_token') ||
      localStorage.getItem('mi_beta_2fa_token') ||
      localStorage.getItem('mi_beta_email'),
    ));
  }, []);

  if (member !== true) return null;

  // When viewing a specific contractor, deep-link to the full in-app
  // profile view (?view=profile). Otherwise just go to /app.
  let href = '/app';
  let label = 'Back to Mindy';
  if (slug && company) {
    const params = new URLSearchParams({
      panel: 'contractors',
      view: 'profile',
      slug,
      company,
    });
    href = `/app?${params.toString()}`;
    label = `Open ${company} in Mindy`;
  }

  return (
    <div className="sticky top-0 z-40 border-b border-purple-500/30 bg-slate-950/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-2.5 text-sm">
        <Link
          href={href}
          className="inline-flex items-center gap-2 text-purple-300 transition-colors hover:text-white"
        >
          <span aria-hidden="true">←</span>
          <span className="font-medium">{label}</span>
        </Link>
        <span className="hidden text-xs text-slate-500 sm:inline">
          You&rsquo;re viewing the public profile · signed in to Mindy
        </span>
      </div>
    </div>
  );
}

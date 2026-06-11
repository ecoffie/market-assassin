'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Public-page CTA that adapts to the visitor:
 *  - Anonymous → the acquisition CTA (sign up / try free) — children.
 *  - Signed-in Mindy member → a member-appropriate action (go to the app), NOT a
 *    "sign up free" nag they've already done.
 *
 * Detects auth from the localStorage Mindy token. Starts in the "member" state
 * (renders nothing of the acquisition CTA) until checked, so a member never sees a
 * flash of "sign up free".
 */
export default function MemberAwareCta({
  children,
  memberHref = '/app',
  memberLabel = 'Open in Mindy →',
  memberHint,
}: {
  children: React.ReactNode;   // the anonymous-visitor CTA
  memberHref?: string;
  memberLabel?: string;
  memberHint?: string;         // optional line shown above the member button
}) {
  const [member, setMember] = useState<boolean | null>(null);
  useEffect(() => {
    setMember(
      typeof window !== 'undefined' && Boolean(
        localStorage.getItem('mi_beta_auth_token') ||
        localStorage.getItem('mi_beta_2fa_token') ||
        localStorage.getItem('mi_beta_email'),
      ),
    );
  }, []);

  // Until we know, render nothing (avoids flashing the wrong CTA either way).
  if (member === null) return null;

  if (member) {
    return (
      <div className="text-center">
        {memberHint && <p className="mb-3 text-sm text-slate-400">{memberHint}</p>}
        <Link
          href={memberHref}
          className="inline-flex rounded-xl bg-purple-600 px-6 py-3 font-semibold text-white hover:bg-purple-500 shadow-lg shadow-purple-500/20"
        >
          {memberLabel}
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}

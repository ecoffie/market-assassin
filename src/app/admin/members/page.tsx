'use client';

/**
 * Members admin — standalone Pro/Team access management for staff.
 *
 * The grant/revoke UI itself lives in <MemberAccessSection> (shared with the
 * Command Center). This page wraps it with staff-session auth: any logged-in
 * staff member (govcongiants.com / getmindy.ai / internal allowlist) can use it
 * via their existing /app session token — no shared admin password.
 *
 * Employees normally manage access from the Command Center
 * (getmindy.ai/command-center → "Member Access" section); this page is the
 * password-free fallback for staff who don't have the admin password.
 */

import { useEffect, useState } from 'react';
import MemberAccessSection from '@/components/admin/MemberAccessSection';

export default function AdminMembersPage() {
  const [callerEmail, setCallerEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCallerEmail(localStorage.getItem('mi_beta_email'));
    }
    setAuthChecked(true);
  }, []);

  // Not signed in → tell them to log into /app first (that's where the session token lives).
  if (authChecked && !callerEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-8 text-center shadow">
          <h1 className="text-xl font-bold">Members Admin</h1>
          <p className="mt-3 text-sm text-slate-400">Sign in with your team account first, then come back here.</p>
          <a
            href="/app"
            className="mt-5 inline-block rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Go to sign in →
          </a>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Members — Grant Pro / Team Access</h1>
          <p className="mt-1 text-sm text-slate-400">
            Signed in as <span className="font-medium text-slate-200">{callerEmail}</span>. Grants apply instantly; the
            user sees the change on their next sign-in or refresh.
          </p>
        </div>
        <MemberAccessSection callerEmail={callerEmail} fullMode />
      </div>
    </main>
  );
}

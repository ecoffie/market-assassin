'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type AccountStatus = 'ready' | 'needs_setup' | 'needs_profile' | 'needs_attention';

type AccountStatusRow = {
  email: string;
  status: AccountStatus;
  recommendedAction: string;
  sources: string[];
  isInternal: boolean;
  auth: {
    hasAccount: boolean;
    createdAt: string | null;
    emailConfirmedAt: string | null;
    lastSignInAt: string | null;
  };
  profile: {
    exists: boolean;
    accessBriefings: boolean;
  };
  settings: {
    exists: boolean;
    isActive: boolean;
    alertsEnabled: boolean;
    briefingsEnabled: boolean;
    hasProfileSignals: boolean;
  };
  setupEmail: {
    sent: boolean;
    sentAt: string | null;
    type: string | null;
    status: string | null;
    subject: string | null;
  };
};

type AccountReport = {
  success: boolean;
  summary: {
    entitledCandidates: number;
    existingAuthAccounts: number;
    needsSetup: number;
    needsProfile: number;
    needsAttention: number;
    ready: number;
    setupEmailsSent: number;
    internalUsers: number;
    authDirectorySize: number;
    warnings: number;
  };
  accounts: AccountStatusRow[];
  warnings: string[];
  error?: string;
};

const statusLabels: Record<AccountStatus, string> = {
  needs_setup: 'Needs Setup',
  needs_profile: 'Needs Profile',
  needs_attention: 'Needs Attention',
  ready: 'Ready',
};

const statusClasses: Record<AccountStatus, string> = {
  needs_setup: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  needs_profile: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
  needs_attention: 'border-red-500/40 bg-red-500/10 text-red-200',
  ready: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
};

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function LoadingBar() {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
      <div className="mi-account-loader h-full w-1/3 rounded-full bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400" />
      <style jsx>{`
        .mi-account-loader {
          animation: mi-account-slide 1.1s ease-in-out infinite;
        }

        @keyframes mi-account-slide {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(320%);
          }
        }
      `}</style>
    </div>
  );
}

export default function MIAccountsAdminPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [report, setReport] = useState<AccountReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | AccountStatus>('all');
  const [query, setQuery] = useState('');

  const filteredAccounts = useMemo(() => {
    return (report?.accounts || []).filter((account) => {
      const statusMatch = filter === 'all' || account.status === filter;
      const queryMatch = !query.trim() ||
        account.email.includes(query.toLowerCase().trim()) ||
        account.sources.join(' ').toLowerCase().includes(query.toLowerCase().trim());
      return statusMatch && queryMatch;
    });
  }, [filter, query, report]);

  useEffect(() => {
    let cancelled = false;

    async function verifyStoredPassword() {
      const storedPassword = sessionStorage.getItem('adminPassword');
      if (!storedPassword) {
        if (!cancelled) setChecking(false);
        return;
      }

      try {
        const response = await fetch('/api/admin/verify-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: storedPassword }),
        });
        const data = await response.json();

        if (cancelled) return;

        if (data.valid || data.success) {
          setAuthenticated(true);
          setPassword(storedPassword);
        } else {
          sessionStorage.removeItem('adminAuth');
          sessionStorage.removeItem('adminPassword');
        }
      } catch {
        sessionStorage.removeItem('adminAuth');
        sessionStorage.removeItem('adminPassword');
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    verifyStoredPassword();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadReport(adminPassword: string) {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/admin/mi-account-setup?password=${encodeURIComponent(adminPassword)}&limit=1000`, {
        cache: 'no-store',
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Could not load MI account status');
        setReport(null);
        return;
      }

      setReport(data as AccountReport);
    } catch {
      setError('Could not load MI account status');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');

    try {
      const response = await fetch('/api/admin/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();

      if (!data.valid && !data.success) {
        setAuthError('Invalid admin password');
        return;
      }

      sessionStorage.setItem('adminAuth', 'true');
      sessionStorage.setItem('adminPassword', password);
      setAuthenticated(true);
      await loadReport(password);
    } catch {
      setAuthError('Could not verify password. Try again.');
    }
  }

  useEffect(() => {
    if (!authenticated || !password || report) return;
    loadReport(password);
  }, [authenticated, password, report]);

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <section className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Checking access</p>
          <h1 className="mt-3 text-3xl font-bold">MI Accounts</h1>
          <div className="mt-8">
            <LoadingBar />
          </div>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <section className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Private workspace</p>
          <h1 className="mt-3 text-3xl font-bold">MI Account Status</h1>
          <p className="mt-3 text-slate-400">Review entitlement, login identity, profile setup, and setup-email state.</p>
          <form className="mt-8 space-y-4" onSubmit={handleLogin}>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Admin password"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 pr-24 text-white outline-none transition focus:border-emerald-400"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-3 py-1.5 text-sm font-semibold text-emerald-300 transition hover:bg-slate-800"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {authError ? <p className="text-sm text-red-300">{authError}</p> : null}
            <button type="submit" className="w-full rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400">
              Open Account Status
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-lg bg-emerald-500 px-3 py-2 text-lg font-black text-slate-950">MI</span>
              <span className="rounded-full border border-blue-400/40 bg-blue-400/10 px-3 py-1 text-sm font-semibold text-blue-200">
                Account Ops
              </span>
            </div>
            <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">MI Account Status</h1>
            <p className="mt-3 max-w-3xl text-lg text-slate-300">
              Entitlement, Supabase Auth identity, profile setup, notification settings, and setup-email state in one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/launch-command-center" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500">
              Command Center
            </Link>
            <Link href="/admin/dashboard" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500">
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => loadReport(password)}
              className="rounded-lg border border-emerald-500/50 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/10"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {loading ? (
          <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
            <LoadingBar />
            <p className="mt-3 text-sm text-slate-400">Loading account status...</p>
          </section>
        ) : error ? (
          <section className="rounded-lg border border-red-500/40 bg-red-500/10 p-6 text-red-100">{error}</section>
        ) : report ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
                <p className="text-sm text-slate-400">Entitled Users</p>
                <p className="mt-2 text-4xl font-bold text-white">{report.summary.entitledCandidates.toLocaleString()}</p>
                <p className="mt-1 text-sm text-slate-500">{report.summary.internalUsers.toLocaleString()} internal</p>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-5">
                <p className="text-sm text-amber-100/80">Needs Account Setup</p>
                <p className="mt-2 text-4xl font-bold text-amber-200">{report.summary.needsSetup.toLocaleString()}</p>
                <p className="mt-1 text-sm text-amber-100/70">{report.summary.setupEmailsSent.toLocaleString()} setup/onboarding emails sent</p>
              </div>
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-5">
                <p className="text-sm text-blue-100/80">Needs Profile</p>
                <p className="mt-2 text-4xl font-bold text-blue-200">{report.summary.needsProfile.toLocaleString()}</p>
                <p className="mt-1 text-sm text-blue-100/70">{report.summary.existingAuthAccounts.toLocaleString()} have auth accounts</p>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5">
                <p className="text-sm text-emerald-100/80">Ready</p>
                <p className="mt-2 text-4xl font-bold text-emerald-200">{report.summary.ready.toLocaleString()}</p>
                <p className="mt-1 text-sm text-emerald-100/70">{report.summary.needsAttention.toLocaleString()} need review</p>
              </div>
            </section>

            {report.warnings.length > 0 ? (
              <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                Data notes: {report.warnings.slice(0, 4).join(' | ')}
              </section>
            ) : null}

            <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Account Queue</p>
                  <h2 className="mt-2 text-2xl font-bold">Who needs action</h2>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search email or source"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white outline-none focus:border-emerald-400 sm:w-72"
                  />
                  <select
                    value={filter}
                    onChange={(event) => setFilter(event.target.value as 'all' | AccountStatus)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white outline-none focus:border-emerald-400"
                  >
                    <option value="all">All statuses</option>
                    <option value="needs_setup">Needs setup</option>
                    <option value="needs_profile">Needs profile</option>
                    <option value="needs_attention">Needs attention</option>
                    <option value="ready">Ready</option>
                  </select>
                </div>
              </div>

              <div className="mt-6 overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
                  <thead className="bg-slate-950 text-xs uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Auth</th>
                      <th className="px-4 py-3">Profile</th>
                      <th className="px-4 py-3">Setup Email</th>
                      <th className="px-4 py-3 min-w-[260px]">Next Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredAccounts.map((account) => (
                      <tr key={account.email} className="bg-slate-900/80 align-top">
                        <td className="px-4 py-4">
                          <p className="font-semibold text-white">{account.email}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {account.isInternal ? (
                              <span className="rounded-full border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-200">internal</span>
                            ) : null}
                            {account.sources.slice(0, 2).map((source) => (
                              <span key={source} className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">{source}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses[account.status]}`}>
                            {statusLabels[account.status]}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-slate-300">
                          <p>{account.auth.hasAccount ? 'Account exists' : 'No auth account'}</p>
                          <p className="mt-1 text-xs text-slate-500">Last login: {formatDate(account.auth.lastSignInAt)}</p>
                          <p className="mt-1 text-xs text-slate-500">Confirmed: {formatDate(account.auth.emailConfirmedAt)}</p>
                        </td>
                        <td className="px-4 py-4 text-slate-300">
                          <p>{account.settings.briefingsEnabled ? 'Briefings on' : 'Briefings off'}</p>
                          <p className="mt-1 text-xs text-slate-500">{account.settings.hasProfileSignals ? 'Profile signals present' : 'No NAICS/keyword/agency signals'}</p>
                          <p className="mt-1 text-xs text-slate-500">{account.profile.accessBriefings ? 'Profile entitlement on' : 'Profile entitlement missing'}</p>
                        </td>
                        <td className="px-4 py-4 text-slate-300">
                          <p>{account.setupEmail.sent ? account.setupEmail.type || 'sent' : 'Not sent'}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatDate(account.setupEmail.sentAt)}</p>
                          <p className="mt-1 text-xs text-slate-500">{account.setupEmail.status || ''}</p>
                        </td>
                        <td className="px-4 py-4 text-slate-300 min-w-[260px]">
                          <p className="min-w-[240px] whitespace-normal leading-relaxed">{account.recommendedAction}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <section className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-slate-400">
            Account status will load after admin authentication.
          </section>
        )}
      </div>
    </main>
  );
}

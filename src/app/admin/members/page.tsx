'use client';

/**
 * Members admin — self-serve Pro/Team access management for the team.
 *
 * Any logged-in staff member (govcongiants.com / getmindy.ai / internal
 * allowlist) can look up a user, then grant or revoke Pro or Team access — no
 * shared admin password, no SQL. Auth piggybacks on the caller's existing /app
 * session token (mi_beta_auth_token in localStorage), sent via getMIApiHeaders.
 * The server re-verifies the token and the staff role on every call.
 */

import { useCallback, useEffect, useState } from 'react';
import { getMIApiHeaders } from '@/components/app/authHeaders';

type Tier = 'free' | 'pro' | 'team';
type GrantTier = 'pro' | 'team';

interface MemberStatus {
  email: string;
  found: boolean;
  accessBriefings: boolean;
  accessTeam: boolean;
  tier: Tier;
}

interface LogEntry {
  target_email: string;
  actor_email: string;
  action: 'grant' | 'revoke';
  tier: GrantTier;
  sent_welcome: boolean;
  created_at: string;
}

const tierBadge: Record<Tier, { label: string; cls: string }> = {
  free: { label: 'Free', cls: 'bg-gray-100 text-gray-600' },
  pro: { label: 'Pro', cls: 'bg-emerald-100 text-emerald-700' },
  team: { label: 'Team', cls: 'bg-indigo-100 text-indigo-700' },
};

export default function AdminMembersPage() {
  const [callerEmail, setCallerEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [email, setEmail] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [sendWelcome, setSendWelcome] = useState(true);

  const [status, setStatus] = useState<MemberStatus | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [log, setLog] = useState<LogEntry[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCallerEmail(localStorage.getItem('mi_beta_email'));
    }
    setAuthChecked(true);
  }, []);

  const authHeaders = useCallback(
    (json = false) => getMIApiHeaders(callerEmail, json ? { 'Content-Type': 'application/json' } : undefined),
    [callerEmail],
  );

  const loadLog = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/members?log=1', { headers: authHeaders() });
      if (!res.ok) return;
      const d = await res.json();
      setLog(d.log || []);
    } catch { /* ignore */ }
  }, [authHeaders]);

  useEffect(() => { if (callerEmail) loadLog(); }, [callerEmail, loadLog]);

  const lookup = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const target = email.trim();
    if (!target) return;
    setLookupLoading(true);
    setMessage(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/members?email=${encodeURIComponent(target)}`, { headers: authHeaders() });
      const d = await res.json();
      if (res.ok && d.success) {
        setStatus(d.status);
      } else if (res.status === 401 || res.status === 403) {
        setMessage({ kind: 'err', text: d.error || 'Not authorized. Sign in with a team account at /app.' });
      } else {
        setMessage({ kind: 'err', text: d.error || 'Lookup failed' });
      }
    } catch {
      setMessage({ kind: 'err', text: 'Something went wrong' });
    } finally {
      setLookupLoading(false);
    }
  }, [email, authHeaders]);

  const apply = useCallback(async (tier: GrantTier, action: 'grant' | 'revoke') => {
    const target = email.trim();
    if (!target) return;
    setActionLoading(`${action}:${tier}`);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/members', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ email: target, tier, action, sendWelcome, customerName: customerName.trim() || undefined }),
      });
      const d = await res.json();
      if (res.ok && d.success) {
        setStatus(d.status);
        setMessage({ kind: 'ok', text: d.message });
        loadLog();
      } else {
        setMessage({ kind: 'err', text: d.error || d.message || 'Action failed' });
      }
    } catch {
      setMessage({ kind: 'err', text: 'Something went wrong' });
    } finally {
      setActionLoading(null);
    }
  }, [email, sendWelcome, customerName, authHeaders, loadLog]);

  // Not signed in → tell them to log into /app first (that's where the session token lives).
  if (authChecked && !callerEmail) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-xl shadow p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900">Members Admin</h1>
          <p className="mt-3 text-sm text-gray-600">
            Sign in with your team account first, then come back here.
          </p>
          <a href="/app" className="mt-5 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
            Go to sign in →
          </a>
        </div>
      </div>
    );
  }

  const busy = (k: string) => actionLoading === k;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Members — Grant Pro / Team Access</h1>
          <p className="mt-1 text-sm text-gray-500">
            Signed in as <span className="font-medium text-gray-700">{callerEmail}</span>. Grants apply instantly; the user sees the change on their next sign-in or refresh.
          </p>
        </div>

        {/* Lookup */}
        <div className="bg-white rounded-xl shadow p-6">
          <form onSubmit={lookup} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">User email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={lookupLoading || !email.trim()}
              className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-40"
            >
              {lookupLoading ? 'Looking up…' : 'Look up'}
            </button>
          </form>

          {/* Status + actions */}
          {status && (
            <div className="mt-6 border-t border-gray-100 pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{status.email}</p>
                  <p className="text-xs text-gray-500">
                    {status.found ? 'Profile exists' : 'No profile yet — granting creates one'}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tierBadge[status.tier].cls}`}>
                  {tierBadge[status.tier].label}
                </span>
              </div>

              <div className="mt-4 grid gap-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Name (optional, for welcome email)</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={sendWelcome} onChange={(e) => setSendWelcome(e.target.checked)} className="rounded border-gray-300" />
                  Send welcome email on grant
                </label>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {/* Pro */}
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold text-gray-700 mb-2">Pro {status.accessBriefings && <span className="text-emerald-600">· active</span>}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => apply('pro', 'grant')}
                      disabled={!!actionLoading || status.accessBriefings}
                      className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                    >
                      {busy('grant:pro') ? '…' : 'Grant'}
                    </button>
                    <button
                      onClick={() => apply('pro', 'revoke')}
                      disabled={!!actionLoading || !status.accessBriefings}
                      className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                    >
                      {busy('revoke:pro') ? '…' : 'Revoke'}
                    </button>
                  </div>
                </div>
                {/* Team */}
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold text-gray-700 mb-2">Team {status.accessTeam && <span className="text-indigo-600">· active</span>}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => apply('team', 'grant')}
                      disabled={!!actionLoading || status.accessTeam}
                      className="flex-1 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
                    >
                      {busy('grant:team') ? '…' : 'Grant'}
                    </button>
                    <button
                      onClick={() => apply('team', 'revoke')}
                      disabled={!!actionLoading || !status.accessTeam}
                      className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                    >
                      {busy('revoke:team') ? '…' : 'Revoke'}
                    </button>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-gray-400">Team includes all Pro features and provisions a shared workspace. Revoking Team leaves any Pro access intact.</p>
            </div>
          )}

          {message && (
            <div className={`mt-5 rounded-lg p-3 text-sm ${message.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
              {message.text}
            </div>
          )}
        </div>

        {/* Audit log */}
        <div className="mt-6 bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900">Recent activity</h2>
            <button onClick={loadLog} className="text-xs text-indigo-600 hover:text-indigo-500">Refresh</button>
          </div>
          {log.length === 0 ? (
            <p className="text-sm text-gray-400">No grants recorded yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {log.map((e, i) => (
                <li key={i} className="py-2 text-sm flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className={`font-semibold ${e.action === 'grant' ? 'text-emerald-700' : 'text-red-600'}`}>{e.action}</span>
                    {' '}<span className="font-medium text-indigo-700">{e.tier}</span>
                    {' → '}<span className="text-gray-700">{e.target_email}</span>
                    {e.sent_welcome && <span className="ml-1 text-[11px] text-gray-400">(emailed)</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-400">
                    {e.actor_email} · {new Date(e.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

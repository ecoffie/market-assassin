'use client';

/**
 * Member Access — grant / revoke Pro or Team access without SQL or Stripe.
 *
 * Shared between two surfaces:
 *   - The Command Center (dark dashboard) passes `adminPassword` — calls are
 *     authorized by the admin password the operator already entered.
 *   - The standalone /admin/members page passes `callerEmail` — calls are
 *     authorized by the staff session token (getMIApiHeaders).
 *
 * Styling matches the Command Center's slate `<section>` cards so it drops in
 * inline with the other dashboard panels.
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
  free: { label: 'Free', cls: 'bg-slate-700/60 text-slate-300' },
  pro: { label: 'Pro', cls: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' },
  team: { label: 'Team', cls: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30' },
};

interface Props {
  /** Command Center path: admin password authorizes the calls. */
  adminPassword?: string;
  /** Standalone page path: staff session token authorizes the calls. */
  callerEmail?: string | null;
}

export default function MemberAccessSection({ adminPassword, callerEmail }: Props) {
  const [email, setEmail] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [sendWelcome, setSendWelcome] = useState(true);

  const [status, setStatus] = useState<MemberStatus | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  // Build request headers / query for whichever auth path we're on.
  const authHeaders = useCallback(
    (json = false): HeadersInit => {
      const base: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
      if (adminPassword) {
        base['x-admin-password'] = adminPassword;
        return base;
      }
      return getMIApiHeaders(callerEmail ?? null, json ? { 'Content-Type': 'application/json' } : undefined);
    },
    [adminPassword, callerEmail],
  );

  const withPassword = useCallback(
    (url: string) => (adminPassword ? `${url}${url.includes('?') ? '&' : '?'}password=${encodeURIComponent(adminPassword)}` : url),
    [adminPassword],
  );

  const ready = !!adminPassword || !!callerEmail;

  const loadLog = useCallback(async () => {
    if (!ready) return;
    try {
      const res = await fetch(withPassword('/api/admin/members?log=1'), { headers: authHeaders() });
      if (!res.ok) return;
      const d = await res.json();
      setLog(d.log || []);
    } catch {
      /* ignore */
    }
  }, [ready, authHeaders, withPassword]);

  useEffect(() => {
    if (ready) loadLog();
  }, [ready, loadLog]);

  const lookup = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const target = email.trim();
      if (!target) return;
      setLookupLoading(true);
      setMessage(null);
      setStatus(null);
      try {
        const res = await fetch(withPassword(`/api/admin/members?email=${encodeURIComponent(target)}`), {
          headers: authHeaders(),
        });
        const d = await res.json();
        if (res.ok && d.success) {
          setStatus(d.status);
        } else if (res.status === 401 || res.status === 403) {
          setMessage({ kind: 'err', text: d.error || 'Not authorized.' });
        } else {
          setMessage({ kind: 'err', text: d.error || 'Lookup failed' });
        }
      } catch {
        setMessage({ kind: 'err', text: 'Something went wrong' });
      } finally {
        setLookupLoading(false);
      }
    },
    [email, authHeaders, withPassword],
  );

  const apply = useCallback(
    async (tier: GrantTier, action: 'grant' | 'revoke') => {
      const target = email.trim();
      if (!target) return;
      setActionLoading(`${action}:${tier}`);
      setMessage(null);
      try {
        const res = await fetch('/api/admin/members', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            email: target,
            tier,
            action,
            sendWelcome,
            customerName: customerName.trim() || undefined,
            ...(adminPassword ? { password: adminPassword } : {}),
          }),
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
    },
    [email, sendWelcome, customerName, adminPassword, authHeaders, loadLog],
  );

  const busy = (k: string) => actionLoading === k;
  const inputCls =
    'w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-900/20 via-slate-900 to-slate-900 p-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Member Access</p>
        <h2 className="text-3xl font-bold">Grant Pro / Team access</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Look up any user, then grant or revoke access — no SQL, no Stripe. Behaves identically to a real purchase
          (access flags, KV gate, team workspace, optional welcome email). Every change is audited below.
        </p>
      </div>

      {/* Lookup */}
      <form onSubmit={lookup} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">User email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className={inputCls}
          />
        </div>
        <button
          type="submit"
          disabled={lookupLoading || !email.trim()}
          className="rounded-lg bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-white disabled:opacity-40"
        >
          {lookupLoading ? 'Looking up…' : 'Look up'}
        </button>
      </form>

      {/* Status + actions */}
      {status && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/50 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-100">{status.email}</p>
              <p className="text-xs text-slate-500">
                {status.found ? 'Profile exists' : 'No profile yet — granting creates one'}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tierBadge[status.tier].cls}`}>
              {tierBadge[status.tier].label}
            </span>
          </div>

          <div className="mt-4 grid gap-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Name (optional, for welcome email)
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Jane Doe"
              className={inputCls}
            />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={sendWelcome}
                onChange={(e) => setSendWelcome(e.target.checked)}
                className="rounded border-slate-600 bg-slate-900"
              />
              Send welcome email on grant
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Pro */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-300">
                Pro {status.accessBriefings && <span className="text-emerald-400">· active</span>}
              </p>
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
                  className="flex-1 rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                >
                  {busy('revoke:pro') ? '…' : 'Revoke'}
                </button>
              </div>
            </div>
            {/* Team */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-300">
                Team {status.accessTeam && <span className="text-indigo-400">· active</span>}
              </p>
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
                  className="flex-1 rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                >
                  {busy('revoke:team') ? '…' : 'Revoke'}
                </button>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Team includes all Pro features and provisions a shared workspace. Revoking Team leaves any Pro access intact.
          </p>
        </div>
      )}

      {message && (
        <div
          className={`mt-5 rounded-lg p-3 text-sm ${
            message.kind === 'ok'
              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border border-red-500/30 bg-red-500/10 text-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Audit log */}
      <div className="mt-6 border-t border-slate-800 pt-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200">Recent activity</h3>
          <button onClick={loadLog} className="text-xs text-emerald-400 hover:text-emerald-300">
            Refresh
          </button>
        </div>
        {log.length === 0 ? (
          <p className="text-sm text-slate-500">No grants recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {log.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className={`font-semibold ${e.action === 'grant' ? 'text-emerald-300' : 'text-red-300'}`}>
                    {e.action}
                  </span>{' '}
                  <span className="font-medium text-indigo-300">{e.tier}</span>
                  {' → '}
                  <span className="text-slate-200">{e.target_email}</span>
                  {e.sent_welcome && <span className="ml-1 text-[11px] text-slate-500">(emailed)</span>}
                </span>
                <span className="shrink-0 text-[11px] text-slate-500">
                  {e.actor_email} · {new Date(e.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

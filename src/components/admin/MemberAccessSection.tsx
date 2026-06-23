'use client';

/**
 * Member Access — verify-before-grant Pro / Team management.
 *
 * Built for OFF-LINK purchases (manual sales, invoices, wires, bootcamp, comps,
 * bundles): the operator looks a person up, sees their CURRENT access next to
 * their REAL Stripe record + a reconciliation verdict, and only then grants —
 * capturing a source + note so every manual grant is traceable. Mirrors the old
 * per-product Access Control page, retargeted to Mindy's Free / Pro / Team tiers.
 *
 * Two surfaces, one component:
 *   - Command Center (dark dashboard) passes `adminPassword` (admin-password auth).
 *   - Standalone /admin/members passes `callerEmail` (staff session-token auth).
 * `fullMode` shows the full member table (tabs + counts + list); without it the
 * Command Center gets a compact grant box + recent activity.
 */

import { useCallback, useEffect, useState } from 'react';
import { getMIApiHeaders } from '@/components/app/authHeaders';

type Tier = 'free' | 'pro' | 'team';
type GrantTier = 'pro' | 'team';
type GrantSource = 'stripe' | 'invoice' | 'wire' | 'bootcamp' | 'comp' | 'bundle' | 'other';

interface MemberStatus {
  email: string;
  found: boolean;
  accessBriefings: boolean;
  accessTeam: boolean;
  tier: Tier;
}
interface StripeVerification {
  found: boolean;
  totalPaid?: number;
  activeSubscriptions?: number;
  hasRefunds?: boolean;
  error?: string;
}
interface Verdict {
  level: 'ok' | 'warn' | 'block' | 'info';
  headline: string;
  detail: string;
  requiresReason: boolean;
}
interface SpecialAccount {
  isSpecial: boolean;
  kind: 'comp' | 'advocate' | 'partner' | null;
  label: string | null;
  name: string | null;
}
interface MemberRow {
  email: string;
  name: string | null;
  tier: Tier;
  created_at: string | null;
  accessSource: string | null;
}
interface TierCounts { all: number; pro: number; team: number; free: number }
interface LogEntry {
  target_email: string;
  actor_email: string;
  action: 'grant' | 'revoke';
  tier: GrantTier;
  sent_welcome: boolean;
  created_at: string;
  grant_source?: string | null;
  note?: string | null;
}

const tierBadge: Record<Tier, { label: string; cls: string }> = {
  free: { label: 'Free', cls: 'bg-slate-700/60 text-slate-300' },
  pro: { label: 'Pro', cls: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' },
  team: { label: 'Team', cls: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30' },
};

const verdictStyle: Record<Verdict['level'], { ring: string; text: string; icon: string }> = {
  ok: { ring: 'border-emerald-500/40 bg-emerald-500/10', text: 'text-emerald-200', icon: '✅' },
  warn: { ring: 'border-amber-500/40 bg-amber-500/10', text: 'text-amber-200', icon: '⚠️' },
  block: { ring: 'border-red-500/40 bg-red-500/10', text: 'text-red-200', icon: '🚫' },
  info: { ring: 'border-slate-600 bg-slate-700/20', text: 'text-slate-300', icon: 'ℹ️' },
};

const SOURCES: { value: GrantSource; label: string }[] = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'wire', label: 'Wire / ACH' },
  { value: 'bootcamp', label: 'Bootcamp / in-person' },
  { value: 'comp', label: 'Comp / advocate' },
  { value: 'bundle', label: 'Bundle' },
  { value: 'other', label: 'Other' },
];

interface Props {
  adminPassword?: string;
  callerEmail?: string | null;
  /** Show the full member table (tabs + counts + list). Off = compact CC view. */
  fullMode?: boolean;
}

export default function MemberAccessSection({ adminPassword, callerEmail, fullMode = false }: Props) {
  const [email, setEmail] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [sendWelcome, setSendWelcome] = useState(true);
  const [grantSource, setGrantSource] = useState<GrantSource | ''>('');
  const [note, setNote] = useState('');

  const [status, setStatus] = useState<MemberStatus | null>(null);
  const [stripe, setStripe] = useState<StripeVerification | null>(null);
  const [special, setSpecial] = useState<SpecialAccount | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  // Table state (fullMode)
  const [tab, setTab] = useState<'all' | 'pro' | 'team' | 'free'>('pro');
  const [counts, setCounts] = useState<TierCounts | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const authHeaders = useCallback(
    (json = false): HeadersInit => {
      if (adminPassword) {
        const h: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
        h['x-admin-password'] = adminPassword;
        return h;
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
    } catch { /* ignore */ }
  }, [ready, authHeaders, withPassword]);

  const loadList = useCallback(async (which: 'all' | 'pro' | 'team' | 'free', q = '') => {
    if (!ready || !fullMode) return;
    setListLoading(true);
    try {
      const url = withPassword(`/api/admin/members?list=1&tier=${which}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) return;
      const d = await res.json();
      setMembers(d.members || []);
      if (d.counts) setCounts(d.counts);
    } catch { /* ignore */ } finally { setListLoading(false); }
  }, [ready, fullMode, authHeaders, withPassword]);

  useEffect(() => { if (ready) loadLog(); }, [ready, loadLog]);
  useEffect(() => { if (ready && fullMode) loadList(tab); }, [ready, fullMode, tab, loadList]);

  const lookup = useCallback(async (override?: string) => {
    const target = (override ?? email).trim();
    if (!target) return;
    if (override) setEmail(override);
    setLookupLoading(true);
    setMessage(null);
    setStatus(null); setStripe(null); setVerdict(null); setSpecial(null);
    setGrantSource(''); setNote('');
    try {
      const res = await fetch(withPassword(`/api/admin/members?email=${encodeURIComponent(target)}`), { headers: authHeaders() });
      const d = await res.json();
      if (res.ok && d.success) {
        setStatus(d.status); setStripe(d.stripe || null); setVerdict(d.verdict || null);
        setSpecial(d.special || null);
        // Known comp/advocate/partner → pre-fill the source as comp and note the
        // class, so the operator doesn't have to classify a known account.
        if (d.special?.isSpecial) {
          setGrantSource('comp');
          setNote(d.special.label || '');
        }
      } else if (res.status === 401 || res.status === 403) {
        setMessage({ kind: 'err', text: d.error || 'Not authorized.' });
      } else {
        setMessage({ kind: 'err', text: d.error || 'Lookup failed' });
      }
    } catch {
      setMessage({ kind: 'err', text: 'Something went wrong' });
    } finally { setLookupLoading(false); }
  }, [email, authHeaders, withPassword]);

  const apply = useCallback(async (tier: GrantTier, action: 'grant' | 'revoke') => {
    const target = email.trim();
    if (!target) return;
    // Verify gate: a grant the verdict flags as needing a reason (off-link /
    // no-Stripe / refund) must pick a source first.
    if (action === 'grant' && verdict?.requiresReason && !grantSource) {
      setMessage({ kind: 'err', text: 'Pick how this purchase was verified (source) before granting — Stripe shows no clean payment.' });
      return;
    }
    setActionLoading(`${action}:${tier}`);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/members', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          email: target, tier, action, sendWelcome,
          customerName: customerName.trim() || undefined,
          grantSource: grantSource || undefined,
          note: note.trim() || undefined,
          ...(adminPassword ? { password: adminPassword } : {}),
        }),
      });
      const d = await res.json();
      if (res.ok && d.success) {
        setStatus(d.status);
        setMessage({ kind: 'ok', text: d.message });
        loadLog();
        if (fullMode) loadList(tab);
      } else {
        setMessage({ kind: 'err', text: d.error || d.message || 'Action failed' });
      }
    } catch {
      setMessage({ kind: 'err', text: 'Something went wrong' });
    } finally { setActionLoading(null); }
  }, [email, verdict, grantSource, note, sendWelcome, customerName, adminPassword, authHeaders, loadLog, fullMode, loadList, tab]);

  const busy = (k: string) => actionLoading === k;
  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-900/20 via-slate-900 to-slate-900 p-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Member Access</p>
        <h2 className="text-3xl font-bold">Grant Pro / Team — verified</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          For purchases made outside the checkout link. Look someone up to see their current access next to their
          real Stripe record, then grant with a verified source. Behaves like a real purchase (access flags, KV gate,
          team workspace, welcome email) and every change is audited.
        </p>
      </div>

      {/* Tier tabs + member table (full mode only) */}
      {fullMode && (
        <div className="mt-6">
          <div className="flex flex-wrap gap-2">
            {(['all', 'pro', 'team', 'free'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t ? 'bg-emerald-600 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {t === 'all' ? 'All' : t === 'pro' ? 'Pro' : t === 'team' ? 'Team' : 'Free'}
                {counts && <span className="ml-1.5 text-xs opacity-70">{counts[t].toLocaleString()}</span>}
              </button>
            ))}
            <button onClick={() => loadList(tab)} className="ml-auto rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800">
              Refresh
            </button>
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Tier</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Source</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Created</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {listLoading ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
                ) : members.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No members in this tier.</td></tr>
                ) : members.map((m) => (
                  <tr key={m.email} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-200">{m.email}</div>
                      {m.name && <div className="text-xs text-slate-500">{m.name}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tierBadge[m.tier].cls}`}>{tierBadge[m.tier].label}</span>
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-slate-500 sm:table-cell">{m.accessSource || '—'}</td>
                    <td className="hidden px-4 py-2.5 text-xs text-slate-500 md:table-cell">{m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => lookup(m.email)} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-emerald-300 hover:bg-slate-800">
                        Manage →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">Showing up to 100 per tier. Use look-up below for a specific email.</p>
        </div>
      )}

      {/* Lookup */}
      <form onSubmit={(e) => { e.preventDefault(); lookup(); }} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Look up a user</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className={inputCls} />
        </div>
        <button type="submit" disabled={lookupLoading || !email.trim()} className="rounded-lg bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-white disabled:opacity-40">
          {lookupLoading ? 'Verifying…' : 'Look up & verify'}
        </button>
      </form>

      {/* Verification + actions */}
      {status && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/50 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-100">{status.email}</p>
              <p className="text-xs text-slate-500">{status.found ? 'Profile exists' : 'No profile yet — granting creates one'}</p>
            </div>
            <div className="flex items-center gap-2">
              {special?.isSpecial && (
                <span className="rounded-full border border-violet-500/40 bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-200" title="Complimentary Pro — excluded from campaigns + revenue metrics">
                  {special.kind === 'advocate' ? '★ ' : special.kind === 'partner' ? '🤝 ' : '🎁 '}{special.label}
                </span>
              )}
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tierBadge[status.tier].cls}`}>{tierBadge[status.tier].label}</span>
            </div>
          </div>

          {/* Stripe verification + verdict — the proof of purchase */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stripe record</p>
              {stripe?.found ? (
                <div className="mt-1.5 text-sm text-slate-300">
                  <div>${(stripe.totalPaid || 0).toLocaleString()} paid · {stripe.activeSubscriptions || 0} active sub{(stripe.activeSubscriptions || 0) === 1 ? '' : 's'}</div>
                  {stripe.hasRefunds && <div className="mt-0.5 text-xs text-red-300">⚠️ has refund(s)</div>}
                </div>
              ) : (
                <div className="mt-1.5 text-sm text-slate-400">{stripe?.error ? `Unavailable: ${stripe.error}` : 'No Stripe customer found'}</div>
              )}
            </div>
            {verdict && (
              <div className={`rounded-lg border p-3 ${verdictStyle[verdict.level].ring}`}>
                <p className={`text-sm font-semibold ${verdictStyle[verdict.level].text}`}>{verdictStyle[verdict.level].icon} {verdict.headline}</p>
                <p className="mt-1 text-xs text-slate-400">{verdict.detail}</p>
              </div>
            )}
          </div>

          {/* Verified-source capture (required when the verdict says so) */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                How was this verified?{verdict?.requiresReason && <span className="text-amber-400"> *</span>}
              </label>
              <select value={grantSource} onChange={(e) => setGrantSource(e.target.value as GrantSource | '')} className={inputCls}>
                <option value="">{stripe?.found ? 'Stripe (auto)' : 'Select source…'}</option>
                {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Note (invoice #, ref)</label>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. invoice 1042, paid by wire 6/20" className={inputCls} />
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">Name (optional, for welcome email)</label>
            <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Jane Doe" className={inputCls} />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={sendWelcome} onChange={(e) => setSendWelcome(e.target.checked)} className="rounded border-slate-600 bg-slate-900" />
              Email them a welcome message when I grant access
            </label>
          </div>

          {/* Grant / revoke */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-300">Pro {status.accessBriefings && <span className="text-emerald-400">· active</span>}</p>
              <div className="flex gap-2">
                <button onClick={() => apply('pro', 'grant')} disabled={!!actionLoading || status.accessBriefings} className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">{busy('grant:pro') ? '…' : 'Grant'}</button>
                <button onClick={() => apply('pro', 'revoke')} disabled={!!actionLoading || !status.accessBriefings} className="flex-1 rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40">{busy('revoke:pro') ? '…' : 'Revoke'}</button>
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-300">Team {status.accessTeam && <span className="text-indigo-400">· active</span>}</p>
              <div className="flex gap-2">
                <button onClick={() => apply('team', 'grant')} disabled={!!actionLoading || status.accessTeam} className="flex-1 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40">{busy('grant:team') ? '…' : 'Grant'}</button>
                <button onClick={() => apply('team', 'revoke')} disabled={!!actionLoading || !status.accessTeam} className="flex-1 rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40">{busy('revoke:team') ? '…' : 'Revoke'}</button>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Team includes all Pro features and provisions a shared workspace. Revoking Team leaves any Pro access intact.</p>
        </div>
      )}

      {message && (
        <div className={`mt-5 rounded-lg p-3 text-sm ${message.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-red-500/30 bg-red-500/10 text-red-200'}`}>
          {message.text}
        </div>
      )}

      {/* Audit log */}
      <div className="mt-6 border-t border-slate-800 pt-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200">Recent activity</h3>
          <button onClick={loadLog} className="text-xs text-emerald-400 hover:text-emerald-300">Refresh</button>
        </div>
        {log.length === 0 ? (
          <p className="text-sm text-slate-500">No grants recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {log.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className={`font-semibold ${e.action === 'grant' ? 'text-emerald-300' : 'text-red-300'}`}>{e.action}</span>{' '}
                  <span className="font-medium text-indigo-300">{e.tier}</span>{' → '}
                  <span className="text-slate-200">{e.target_email}</span>
                  {e.grant_source && <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{e.grant_source}</span>}
                  {e.note && <span className="ml-1 text-[11px] text-slate-500">“{e.note}”</span>}
                  {e.sent_welcome && <span className="ml-1 text-[11px] text-slate-500">(emailed)</span>}
                </span>
                <span className="shrink-0 text-[11px] text-slate-500">{e.actor_email} · {new Date(e.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

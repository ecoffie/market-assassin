'use client';

/**
 * /mcp/account → Team: pooled team credits (tasks/PRD-pooled-team-credits.md).
 *
 * Shows every team the signed-in person belongs to: the shared pool balance and monthly
 * allowance, seats used, and — for the team owner — each member's 30-day usage, pending
 * invites, and invite / remove controls. An invite link (?invite=<token>) lands here and
 * is accepted only when the signed-in address matches the invited one (server-enforced).
 */
import { useCallback, useEffect, useState } from 'react';
import { getMIApiHeaders } from '@/components/app/authHeaders';

interface TeamMember { email: string; role: string; credits30d: number | null; calls30d: number | null }
interface Team {
  orgId: string; name: string; role: string; isOwner: boolean; seatLimit: number;
  seats: { active: number; pending: number; used: number };
  poolBalance: number | null; monthlyCredits: number;
  members: TeamMember[]; pendingInvites: { email: string; expiresAt: string }[];
}

const nf = (n: number) => n.toLocaleString();

async function post(body: Record<string, unknown>) {
  const headers = getMIApiHeaders();
  headers.set('Content-Type', 'application/json');
  const res = await fetch('/api/mcp/team', { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  return { ok: res.ok && j?.success, error: j?.error as string | undefined, data: j };
}

export function TeamSection({ email }: { email: string | null }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invite, setInvite] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/team', { headers: getMIApiHeaders() });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) { setTeams(j.teams ?? []); setLoadError(null); }
      else setLoadError(j?.error || 'Could not load your team.');
    } catch {
      setLoadError('Could not load your team.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('invite');
    if (t) setPendingToken(t);
  }, []);

  async function accept() {
    if (!pendingToken) return;
    setBusy('accept');
    const r = await post({ action: 'accept', token: pendingToken });
    setBusy(null);
    if (r.ok) {
      setMsg({ kind: 'ok', text: `You joined ${r.data.orgName}. Your usage now draws from the team's shared credits.` });
      setPendingToken(null);
      try { const u = new URL(window.location.href); u.searchParams.delete('invite'); window.history.replaceState(null, '', u.toString()); } catch { /* ignore */ }
      void load();
    } else setMsg({ kind: 'err', text: r.error || 'Could not accept the invite.' });
  }

  async function sendInvite(orgId: string) {
    const to = (invite[orgId] || '').trim();
    if (!to) return;
    setBusy(`invite:${orgId}`);
    const r = await post({ action: 'invite', orgId, email: to });
    setBusy(null);
    if (r.ok) {
      setMsg({ kind: 'ok', text: `Invite sent to ${to}.` });
      setInvite((s) => ({ ...s, [orgId]: '' }));
      void load();
    } else setMsg({ kind: 'err', text: r.error || 'Could not send the invite.' });
  }

  async function remove(orgId: string, who: string) {
    if (!window.confirm(`Remove ${who} from this team? Their future usage will no longer draw from the team's credits.`)) return;
    setBusy(`remove:${who}`);
    const r = await post({ action: 'remove', orgId, email: who });
    setBusy(null);
    if (r.ok) { setMsg({ kind: 'ok', text: `${who} was removed.` }); void load(); }
    else setMsg({ kind: 'err', text: r.error || 'Could not remove that member.' });
  }

  return (
    <div className="space-y-6">
      {pendingToken && (
        <div className="rounded-2xl border border-violet-400/30 bg-violet-400/[0.06] p-6">
          <div className="text-[15px] font-semibold text-violet-100">You have a team invite</div>
          <p className="mt-1 text-[13px] text-slate-400">
            Accept to join the team as a named user{email ? <> (signed in as <span className="text-slate-200">{email}</span>)</> : null}.
            The invite only works for the address it was sent to.
          </p>
          <button
            type="button" onClick={accept} disabled={busy === 'accept'}
            className="mt-4 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
          >
            {busy === 'accept' ? 'Joining…' : 'Accept invite'}
          </button>
        </div>
      )}

      {msg && (
        <div className={`rounded-lg px-4 py-2 text-[13px] ${msg.kind === 'ok' ? 'bg-emerald-400/10 text-emerald-200' : 'bg-rose-400/10 text-rose-200'}`}>
          {msg.text}
        </div>
      )}

      {loadError && <div className="text-[13px] text-rose-300">{loadError}</div>}
      {!teams && !loadError && <div className="text-[13px] text-slate-500">Loading…</div>}

      {teams && teams.length === 0 && !pendingToken && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-[13px] text-slate-400">
          You are not on a team. Multi-seat subscriptions share one pool of credits across named users;
          the subscription owner invites members from here.
        </div>
      )}

      {teams?.map((t) => (
        <div key={t.orgId} className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[15px] font-semibold text-slate-100">{t.name}</div>
            <div className="text-[12px] uppercase tracking-wide text-slate-500">{t.isOwner ? 'Owner' : 'Member'}</div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-[#0a0f1e] p-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Shared credits</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-300">
                {t.poolBalance === null ? 'Not set up yet' : nf(t.poolBalance)}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#0a0f1e] p-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Monthly allowance</div>
              <div className="mt-1 text-2xl font-semibold text-slate-100">{nf(t.monthlyCredits)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#0a0f1e] p-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Seats used</div>
              <div className="mt-1 text-2xl font-semibold text-slate-100">{t.seats.used} / {t.seatLimit}</div>
              {t.seats.pending > 0 && <div className="text-[11px] text-slate-500">{t.seats.pending} invite{t.seats.pending === 1 ? '' : 's'} pending</div>}
            </div>
          </div>

          <table className="mt-5 w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="py-2">Member</th><th className="py-2 text-right">Credits (30d)</th><th className="py-2 text-right">Calls (30d)</th>{t.isOwner && <th />}</tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {t.members.map((m) => (
                <tr key={m.email}>
                  <td className="py-2 text-slate-200">{m.email}{m.role === 'team_owner' ? <span className="ml-2 text-[11px] text-slate-500">owner</span> : null}</td>
                  <td className="py-2 text-right text-slate-300">{m.credits30d === null ? 'unknown' : nf(m.credits30d)}</td>
                  <td className="py-2 text-right text-slate-300">{m.calls30d === null ? 'unknown' : nf(m.calls30d)}</td>
                  {t.isOwner && (
                    <td className="py-2 text-right">
                      {m.role !== 'team_owner' && (
                        <button type="button" onClick={() => remove(t.orgId, m.email)} disabled={busy === `remove:${m.email}`}
                          className="text-[12px] text-rose-300 hover:text-rose-200 disabled:opacity-50">Remove</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {t.isOwner && t.pendingInvites.map((i) => (
                <tr key={`inv:${i.email}`}>
                  <td className="py-2 text-slate-400">{i.email} <span className="ml-2 text-[11px] text-slate-500">invited · expires {new Date(i.expiresAt).toLocaleDateString()}</span></td>
                  <td /><td />
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => remove(t.orgId, i.email)} disabled={busy === `remove:${i.email}`}
                      className="text-[12px] text-rose-300 hover:text-rose-200 disabled:opacity-50">Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {t.isOwner && (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <input
                type="email" placeholder="name@company.com" value={invite[t.orgId] ?? ''}
                onChange={(e) => setInvite((s) => ({ ...s, [t.orgId]: e.target.value }))}
                disabled={t.seats.used >= t.seatLimit}
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0a0f1e] px-3 py-2 text-[13px] text-slate-200 disabled:opacity-50"
              />
              <button type="button" onClick={() => sendInvite(t.orgId)}
                disabled={busy === `invite:${t.orgId}` || t.seats.used >= t.seatLimit || !(invite[t.orgId] || '').trim()}
                className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-[#062a1e] hover:bg-emerald-400 disabled:opacity-50">
                {t.seats.used >= t.seatLimit ? 'All seats in use' : busy === `invite:${t.orgId}` ? 'Sending…' : 'Invite member'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

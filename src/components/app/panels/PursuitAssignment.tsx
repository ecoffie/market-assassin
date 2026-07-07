'use client';

/**
 * Owner + collaborators assignment for a pursuit (Deal Flow Board, Phase 2).
 *
 * Replaces the old free-text owner_email box with a real teammate picker fed from the
 * workspace member list (/api/app/workspace → members), plus multi-select
 * collaborators. Solo users (workspace of one) still see themselves and it degrades to
 * a plain owner select — no team required to use it.
 *
 * Controlled component: parent owns owner/collaborators state and passes setters, so
 * the drawer's single Save writes them alongside the rest of the edit.
 */
import { useEffect, useState } from 'react';

interface Member {
  user_email: string;
  role?: string;
  status?: string;
}

interface PursuitAssignmentProps {
  email: string;
  authHeaders: (init?: HeadersInit) => HeadersInit;
  owner: string;
  collaborators: string[];
  onOwnerChange: (email: string) => void;
  onCollaboratorsChange: (emails: string[]) => void;
}

export default function PursuitAssignment({
  email, authHeaders, owner, collaborators, onOwnerChange, onCollaboratorsChange,
}: PursuitAssignmentProps) {
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/app/workspace?email=${encodeURIComponent(email)}`, { headers: authHeaders() });
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.success !== false) {
          const list: Member[] = (data?.members || [])
            .filter((m: Member) => m.status !== 'invited' || true) // include invited (they can be assigned ahead of accept)
            .map((m: Member) => ({ user_email: (m.user_email || '').toLowerCase(), role: m.role, status: m.status }))
            .filter((m: Member) => m.user_email);
          // Always include the current user + current owner even if the member fetch is thin.
          const emails = new Set(list.map((m) => m.user_email));
          if (!emails.has(email.toLowerCase())) list.unshift({ user_email: email.toLowerCase(), role: 'member' });
          if (owner && !emails.has(owner.toLowerCase())) list.push({ user_email: owner.toLowerCase() });
          setMembers(list);
        }
      } catch { /* non-fatal — falls back to a solo owner select */ }
    })();
    return () => { cancelled = true; };
  }, [email, authHeaders, owner]);

  const isTeam = members.length > 1;
  const label = (e: string) => e.split('@')[0];

  const toggleCollaborator = (memberEmail: string) => {
    const e = memberEmail.toLowerCase();
    const exists = collaborators.some((c) => c.toLowerCase() === e);
    onCollaboratorsChange(
      exists ? collaborators.filter((c) => c.toLowerCase() !== e) : [...collaborators, e],
    );
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[11px] font-medium text-slate-400 mb-1">Owner</label>
        <select
          value={owner || email}
          onChange={(e) => onOwnerChange(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none"
        >
          {members.map((m) => (
            <option key={m.user_email} value={m.user_email}>
              {label(m.user_email)}{m.user_email === email.toLowerCase() ? ' (you)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Collaborators only make sense with a real team. Hidden for solo workspaces. */}
      {isTeam && (
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">
            Collaborators {collaborators.length > 0 && <span className="text-slate-600">({collaborators.length})</span>}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {members
              .filter((m) => m.user_email !== (owner || email).toLowerCase())
              .map((m) => {
                const active = collaborators.some((c) => c.toLowerCase() === m.user_email);
                return (
                  <button
                    key={m.user_email}
                    type="button"
                    onClick={() => toggleCollaborator(m.user_email)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {active ? '✓ ' : '+ '}{label(m.user_email)}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

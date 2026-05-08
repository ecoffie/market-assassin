'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface TeamPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface TeamMember {
  id: string;
  user_email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'active' | 'invited';
  invited_by?: string;
  invited_at?: string;
  accepted_at?: string;
}

interface ActivityItem {
  id: string;
  actor_email: string;
  action: string;
  summary: string;
  created_at: string;
}

interface Reminder {
  id: string;
  title: string;
  agency?: string;
  owner_email?: string;
  next_action?: string;
  next_action_date?: string;
  isOverdue: boolean;
  daysUntilDue: number;
}

export default function TeamPanel({ email, tier }: TeamPanelProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [workspaceName, setWorkspaceName] = useState('Workspace');
  const [currentRole, setCurrentRole] = useState('member');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/mi-beta/workspace?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to load team workspace');
        return;
      }

      setMembers(data.members || []);
      setActivity(data.activity || []);
      setReminders(data.reminders || []);
      setWorkspaceName(data.workspace?.name || 'Workspace');
      setCurrentRole(data.currentMember?.role || 'member');
    } catch (err) {
      console.error('Failed to load workspace:', err);
      setError('Failed to load team workspace');
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const inviteMember = async () => {
    if (!email || !inviteEmail.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/mi-beta/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          invited_email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Failed to invite teammate');
      } else {
        setInviteEmail('');
        await loadWorkspace();
      }
    } catch (err) {
      console.error('Failed to invite teammate:', err);
      setError('Failed to invite teammate');
    } finally {
      setSaving(false);
    }
  };

  const canInvite = ['owner', 'admin'].includes(currentRole);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-56" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <div key={i} className="h-24 bg-slate-800 rounded-xl" />)}
          </div>
          <div className="h-72 bg-slate-800 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Team Access</h1>
          <p className="text-slate-400 mt-1">{workspaceName} shared workspace</p>
        </div>
        <span className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300">
          {tier === 'team' || tier === 'enterprise' ? 'Team-ready' : 'Beta team preview'}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Seats" value={members.length} />
        <StatCard label="Open Reminders" value={reminders.length} />
        <StatCard label="Your Role" value={currentRole} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-white">Team Members</h2>
              <p className="text-xs text-slate-500 mt-1">Owner, admin, member, and viewer roles</p>
            </div>
          </div>

          <div className="divide-y divide-slate-800">
            {members.map(member => (
              <div key={member.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-white truncate">{member.user_email}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {member.status === 'invited'
                      ? `Invited${member.invited_by ? ` by ${member.invited_by}` : ''}`
                      : `Active${member.accepted_at ? ` since ${formatDate(member.accepted_at)}` : ''}`}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-1 rounded bg-slate-800 text-xs text-slate-300 capitalize">{member.role}</span>
                  <span className={`px-2 py-1 rounded text-xs ${member.status === 'active' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                    {member.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="font-semibold text-white mb-4">Invite Seat</h2>
            <div className="space-y-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={!canInvite}
                placeholder="teammate@company.com"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 disabled:opacity-50 outline-none focus:border-blue-500"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                disabled={!canInvite}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white disabled:opacity-50 outline-none focus:border-blue-500"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                onClick={inviteMember}
                disabled={!canInvite || saving || !inviteEmail.trim()}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
              >
                {saving ? 'Inviting...' : 'Invite Teammate'}
              </button>
              {!canInvite && <p className="text-xs text-slate-500">Only owners and admins can invite teammates.</p>}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="font-semibold text-white mb-4">Due Soon</h2>
            <div className="space-y-3">
              {reminders.slice(0, 5).map(reminder => (
                <div key={reminder.id} className="rounded-lg bg-slate-800/60 p-3">
                  <div className="text-sm font-medium text-white line-clamp-2">{reminder.next_action || reminder.title}</div>
                  <div className={`text-xs mt-1 ${reminder.isOverdue ? 'text-red-300' : 'text-amber-300'}`}>
                    {reminder.isOverdue ? 'Overdue' : `Due in ${reminder.daysUntilDue} days`}
                    {reminder.owner_email ? ` • ${reminder.owner_email}` : ''}
                  </div>
                </div>
              ))}
              {reminders.length === 0 && <p className="text-sm text-slate-500">No next actions due this week.</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 className="font-semibold text-white mb-4">Team Activity</h2>
        <div className="space-y-3">
          {activity.map(item => (
            <div key={item.id} className="flex items-start gap-3">
              <div className="mt-1 h-2 w-2 rounded-full bg-blue-400" />
              <div>
                <div className="text-sm text-slate-200">{item.summary}</div>
                <div className="text-xs text-slate-500">{item.actor_email} • {formatDate(item.created_at)}</div>
              </div>
            </div>
          ))}
          {activity.length === 0 && <p className="text-sm text-slate-500">No team activity yet.</p>}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="text-2xl font-bold text-white capitalize">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return 'unknown';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

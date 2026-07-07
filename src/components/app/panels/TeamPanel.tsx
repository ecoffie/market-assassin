'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { authedFetch } from '../authHeaders';

interface TeamPanelProps {
  email: string | null;
  tier: AppTier;
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

interface WorkspaceSettings {
  company_name?: string;
  default_naics_codes?: string[];
  default_agencies?: string[];
}

const TEAM_SEAT_LIMIT = 5;

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
  const [showSettings, setShowSettings] = useState(false);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings>({});
  const [settingsForm, setSettingsForm] = useState<WorkspaceSettings>({});

  const loadWorkspace = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError(null);

    try {
      const res = await authedFetch(`/api/app/workspace?email=${encodeURIComponent(email)}`, email);
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
      // Workspace-level defaults (shared by all members), from the dedicated
      // mi_beta_workspace_settings record — NOT the admin's personal settings.
      if (data.workspaceSettings) {
        const settings: WorkspaceSettings = {
          company_name: data.workspaceSettings.company_name,
          default_naics_codes: data.workspaceSettings.naics_codes,
          default_agencies: data.workspaceSettings.target_agencies,
        };
        setWorkspaceSettings(settings);
        setSettingsForm(settings);
      }
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
      const res = await authedFetch('/api/app/workspace', email, {
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

  const seatsUsed = members.filter(member => member.status === 'active' || member.status === 'invited').length;
  const hasSeatCapacity = seatsUsed < TEAM_SEAT_LIMIT || tier === 'enterprise';
  const canInvite = ['owner', 'admin'].includes(currentRole) && hasSeatCapacity;
  const canEditSettings = ['owner', 'admin'].includes(currentRole);
  const canManageMembers = ['owner', 'admin'].includes(currentRole);

  const changeRole = async (memberId: string, role: string) => {
    if (!email) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch('/api/app/workspace', email, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action: 'set_role', member_id: memberId, role }),
      });
      const data = await res.json();
      if (!data.success) setError(data.error || 'Failed to change role');
      else await loadWorkspace();
    } catch {
      setError('Failed to change role');
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (member: TeamMember) => {
    if (!email) return;
    const verb = member.status === 'invited' ? 'revoke this invite' : 'remove this member';
    if (!window.confirm(`Are you sure you want to ${verb}? (${member.user_email})`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch(
        `/api/app/workspace?email=${encodeURIComponent(email)}&member_id=${encodeURIComponent(member.id)}`,
        email,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!data.success) setError(data.error || 'Failed to remove member');
      else await loadWorkspace();
    } catch {
      setError('Failed to remove member');
    } finally {
      setSaving(false);
    }
  };

  const saveWorkspaceSettings = async () => {
    if (!email) return;
    setSaving(true);
    setError(null);

    try {
      const res = await authedFetch('/api/app/workspace', email, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          action: 'workspace_defaults',
          company_name: settingsForm.company_name,
          naics_codes: settingsForm.default_naics_codes,
          target_agencies: settingsForm.default_agencies,
        }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Failed to save settings');
      } else {
        setWorkspaceSettings(settingsForm);
        setShowSettings(false);
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

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
          {tier === 'team' || tier === 'enterprise' ? 'Team Plan' : 'Team Preview'}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Seats" value={tier === 'enterprise' ? `${seatsUsed}` : `${seatsUsed}/${TEAM_SEAT_LIMIT}`} />
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
                  {/* Owner/admin can change a non-owner member's role inline.
                      The owner row + your own row stay read-only badges. */}
                  {canManageMembers && member.role !== 'owner' && member.user_email !== email ? (
                    <select
                      value={member.role}
                      onChange={(e) => changeRole(member.id, e.target.value)}
                      disabled={saving}
                      className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300 capitalize outline-none focus:border-blue-500 disabled:opacity-50"
                      aria-label={`Role for ${member.user_email}`}
                    >
                      {/* Only the owner can grant admin (API enforces this too) */}
                      {currentRole === 'owner' && <option value="admin">Admin</option>}
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span className="px-2 py-1 rounded bg-slate-800 text-xs text-slate-300 capitalize">{member.role}</span>
                  )}
                  <span className={`px-2 py-1 rounded text-xs ${member.status === 'active' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                    {member.status}
                  </span>
                  {canManageMembers && member.role !== 'owner' && member.user_email !== email && (
                    <button
                      onClick={() => removeMember(member)}
                      disabled={saving}
                      title={member.status === 'invited' ? 'Revoke invite' : 'Remove member'}
                      aria-label={member.status === 'invited' ? 'Revoke invite' : 'Remove member'}
                      className="p-1 rounded text-slate-500 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                    >
                      ✕
                    </button>
                  )}
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
              {!['owner', 'admin'].includes(currentRole) && <p className="text-xs text-slate-500">Only owners and admins can invite teammates.</p>}
              {['owner', 'admin'].includes(currentRole) && !hasSeatCapacity && (
                <p className="text-xs text-amber-300">Mindy Team includes {TEAM_SEAT_LIMIT} seats. Upgrade to Enterprise for more users.</p>
              )}
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

      {/* Workspace Settings - Admin/Owner only */}
      {canEditSettings && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-800/50 transition-colors"
          >
            <div>
              <h2 className="font-semibold text-white">Workspace Settings</h2>
              <p className="text-xs text-slate-500 mt-1">
                {workspaceSettings.company_name || workspaceName} • Manage team defaults
              </p>
            </div>
            <svg
              className={`w-5 h-5 text-slate-400 transition-transform ${showSettings ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showSettings && (
            <div className="px-5 pb-5 space-y-4 border-t border-slate-800">
              <div className="pt-4">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Company Name
                </label>
                <input
                  type="text"
                  value={settingsForm.company_name || ''}
                  onChange={(e) => setSettingsForm({ ...settingsForm, company_name: e.target.value })}
                  placeholder={workspaceName}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Default NAICS Codes (comma-separated)
                </label>
                <input
                  type="text"
                  value={(settingsForm.default_naics_codes || []).join(', ')}
                  onChange={(e) => setSettingsForm({
                    ...settingsForm,
                    default_naics_codes: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder="541512, 541611, 541330"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 outline-none focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1">Applied to new team members by default</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Target Agencies (comma-separated)
                </label>
                <input
                  type="text"
                  value={(settingsForm.default_agencies || []).join(', ')}
                  onChange={(e) => setSettingsForm({
                    ...settingsForm,
                    default_agencies: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder="DOD, VA, HHS"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setSettingsForm(workspaceSettings);
                    setShowSettings(false);
                  }}
                  className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveWorkspaceSettings}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
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

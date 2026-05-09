'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';
import { getMIApiHeaders } from '../authHeaders';

interface DashboardPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface Briefing {
  briefing_date: string;
  generated_at: string;
  items_count?: number;
  content?: {
    headline?: string;
    summary?: string;
    opportunities?: Array<{
      title: string;
      agency?: string;
      value?: string;
      deadline?: string;
    }>;
  };
}

interface BriefingStats {
  daily: { date: string; headline: string; itemCount: number } | null;
  weekly: { date: string; headline: string } | null;
  pursuit: { date: string; targetCount: number } | null;
}

interface WorkspaceSummary {
  members: Array<{ id: string; user_email: string; role: string; status: string }>;
  settings?: {
    onboarding_completed?: boolean;
    company_name?: string;
    display_name?: string;
    naics_codes?: string[];
    target_agencies?: string[];
  } | null;
  activity: Array<{ id: string; summary: string; actor_email: string; created_at: string }>;
  reminders: Array<{
    id: string;
    title: string;
    next_action?: string;
    next_action_date?: string;
    owner_email?: string;
    isOverdue: boolean;
    daysUntilDue: number;
  }>;
}

export default function DashboardPanel({ email, tier }: DashboardPanelProps) {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [stats, setStats] = useState<BriefingStats>({ daily: null, weekly: null, pursuit: null });
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBriefing, setSelectedBriefing] = useState<Briefing | null>(null);
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

  const loadWorkspace = useCallback(async () => {
    if (!email) return;
    try {
      const res = await fetch(`/api/mi-beta/workspace?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setWorkspace({
          members: data.members || [],
          settings: data.settings,
          activity: data.activity || [],
          reminders: data.reminders || [],
        });
      }
    } catch (err) {
      console.error('Failed to load workspace summary:', err);
    }
  }, [email, getAuthHeaders]);

  const loadBriefings = useCallback(async () => {
    if (!email) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/briefings/latest?email=${encodeURIComponent(email)}&days=7`);
      const data = await res.json();

      if (data.success) {
        if (data.briefings) {
          setBriefings(data.briefings);

          // Extract stats from latest briefings
          const latest = data.briefings[0];
          if (latest) {
            setStats({
              daily: {
                date: latest.briefing_date,
                headline: latest.content?.headline || 'Your daily intelligence briefing',
                itemCount: latest.items_count || latest.content?.opportunities?.length || 0,
              },
              weekly: data.briefings.length > 1 ? {
                date: data.briefings[1]?.briefing_date || '',
                headline: 'Weekly market analysis',
              } : null,
              pursuit: null,
            });
            setSelectedBriefing(latest);
          }
        } else if (data.briefing) {
          // Single briefing response
          const briefing = {
            briefing_date: data.briefing_date,
            generated_at: data.generated_at,
            content: data.briefing,
          };
          setBriefings([briefing]);
          setSelectedBriefing(briefing);
          setStats({
            daily: {
              date: data.briefing_date,
              headline: data.briefing?.headline || 'Your daily intelligence briefing',
              itemCount: data.briefing?.opportunities?.length || 0,
            },
            weekly: null,
            pursuit: null,
          });
        }
      } else if (data.error === 'No briefing access') {
        setError('Upgrade to Pro to access AI briefings');
      } else {
        setError(data.message || 'No briefings available yet');
      }
    } catch (err) {
      console.error('Failed to load briefings:', err);
      setError('Failed to load briefings');
    } finally {
      setIsLoading(false);
    }
  }, [email]);

  useEffect(() => {
    if (email && tier !== 'free') {
      loadBriefings();
      loadWorkspace();
    } else {
      if (email) loadWorkspace();
      setIsLoading(false);
    }
  }, [email, tier, loadBriefings, loadWorkspace]);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  if (tier === 'free') {
    return (
      <div className="p-6">
        <div className="bg-gradient-to-br from-purple-900/30 to-slate-900 border border-purple-500/30 rounded-xl p-8 text-center">
          <div className="text-4xl mb-4">📊</div>
          <h2 className="text-2xl font-bold text-white mb-3">AI Briefings</h2>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            Get personalized daily intelligence, weekly deep dives, and pursuit-specific
            briefings powered by AI analysis of your target market.
          </p>
          <a
            href="/market-intelligence"
            className="inline-block px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors"
          >
            Upgrade to Pro - $149/mo
          </a>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-800 rounded w-48" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 bg-slate-800 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Briefings</h1>
          <p className="text-slate-400 mt-1">Your personalized market intelligence</p>
        </div>
        <button
          onClick={loadBriefings}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
        >
          🔄 Refresh
        </button>
      </div>

      {workspace && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="font-semibold text-white">Unified Workspace</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Team, profile, security, ownership, and reminders are now connected.
                </p>
              </div>
              <span className={`px-2 py-1 rounded text-xs ${workspace.settings?.onboarding_completed ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                {workspace.settings?.onboarding_completed ? 'Ready' : 'Onboarding'}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <DashboardStat label="Seats" value={workspace.members.length} />
              <DashboardStat label="Due Soon" value={workspace.reminders.length} />
              <DashboardStat label="NAICS" value={workspace.settings?.naics_codes?.length || 0} />
              <DashboardStat label="Agencies" value={workspace.settings?.target_agencies?.length || 0} />
            </div>

            {!workspace.settings?.onboarding_completed && (
              <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
                <div className="font-medium text-amber-200">Finish onboarding</div>
                <p className="text-sm text-amber-100/80 mt-1">
                  Add company profile, NAICS, target agencies, and confirm 2FA in Unified Settings.
                </p>
              </div>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="font-semibold text-white mb-4">Next Actions</h2>
            <div className="space-y-3">
              {workspace.reminders.slice(0, 4).map(reminder => (
                <div key={reminder.id} className="rounded-lg bg-slate-800/60 p-3">
                  <div className="text-sm text-white line-clamp-2">{reminder.next_action || reminder.title}</div>
                  <div className={`text-xs mt-1 ${reminder.isOverdue ? 'text-red-300' : 'text-amber-300'}`}>
                    {reminder.isOverdue ? 'Overdue' : `Due in ${reminder.daysUntilDue} days`}
                    {reminder.owner_email ? ` • ${reminder.owner_email}` : ''}
                  </div>
                </div>
              ))}
              {workspace.reminders.length === 0 && <p className="text-sm text-slate-500">No pursuit reminders due this week.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-amber-400">
          {error}
        </div>
      )}

      {/* Briefing Type Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Daily Brief */}
        <div
          className={`bg-slate-900 border rounded-xl p-6 transition-colors cursor-pointer ${
            stats.daily ? 'border-slate-800 hover:border-emerald-500/50' : 'border-slate-800/50 opacity-60'
          }`}
          onClick={() => stats.daily && briefings[0] && setSelectedBriefing(briefings[0])}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <span className="text-xl">📋</span>
            </div>
            <div>
              <h3 className="font-semibold text-white">Daily Brief</h3>
              <p className="text-xs text-slate-500">{stats.daily ? formatDate(stats.daily.date) : 'Not available'}</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-4">{stats.daily?.headline || 'Daily intelligence briefing'}</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-400">{stats.daily?.itemCount || 0} items</span>
            <span className="text-xs text-slate-500">View →</span>
          </div>
        </div>

        {/* Weekly Deep Dive */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-purple-500/50 transition-colors cursor-pointer">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <span className="text-xl">📊</span>
            </div>
            <div>
              <h3 className="font-semibold text-white">Weekly Deep Dive</h3>
              <p className="text-xs text-slate-500">{stats.weekly ? formatDate(stats.weekly.date) : 'Fridays'}</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-4">Strategic market analysis and trends</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-purple-400">Strategic analysis</span>
            <span className="text-xs text-slate-500">View →</span>
          </div>
        </div>

        {/* Pursuit Brief */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-blue-500/50 transition-colors cursor-pointer">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <span className="text-xl">🎯</span>
            </div>
            <div>
              <h3 className="font-semibold text-white">Pursuit Brief</h3>
              <p className="text-xs text-slate-500">Saturdays</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-4">Top opportunities to pursue this week</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-400">{stats.pursuit?.targetCount || 3} targets</span>
            <span className="text-xs text-slate-500">View →</span>
          </div>
        </div>
      </div>

      {/* Recent Briefings Timeline */}
      {briefings.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="font-semibold text-white mb-4">Recent Briefings</h3>
          <div className="space-y-3">
            {briefings.slice(0, 5).map((briefing, idx) => (
              <div
                key={briefing.briefing_date}
                onClick={() => setSelectedBriefing(briefing)}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedBriefing?.briefing_date === briefing.briefing_date
                    ? 'bg-emerald-500/10 border border-emerald-500/30'
                    : 'bg-slate-800/50 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${idx === 0 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <div>
                    <div className="text-sm text-white">{formatDate(briefing.briefing_date)}</div>
                    <div className="text-xs text-slate-500">
                      {briefing.items_count || briefing.content?.opportunities?.length || 0} opportunities
                    </div>
                  </div>
                </div>
                <span className="text-xs text-slate-500">→</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected Briefing Preview */}
      {selectedBriefing?.content && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">
              Briefing - {formatDate(selectedBriefing.briefing_date)}
            </h3>
            <span className="text-xs text-slate-500">
              Generated {new Date(selectedBriefing.generated_at).toLocaleTimeString()}
            </span>
          </div>

          {selectedBriefing.content.headline && (
            <p className="text-slate-300 mb-4">{selectedBriefing.content.headline}</p>
          )}

          {selectedBriefing.content.summary && (
            <p className="text-slate-400 text-sm mb-4">{selectedBriefing.content.summary}</p>
          )}

          {selectedBriefing.content.opportunities && selectedBriefing.content.opportunities.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-slate-400">Top Opportunities</h4>
              {selectedBriefing.content.opportunities.slice(0, 5).map((opp, idx) => (
                <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
                  <div className="text-sm text-white">{opp.title}</div>
                  <div className="flex gap-3 text-xs text-slate-500 mt-1">
                    {opp.agency && <span>{opp.agency}</span>}
                    {opp.value && <span className="text-emerald-400">{opp.value}</span>}
                    {opp.deadline && <span>Due: {opp.deadline}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && briefings.length === 0 && !error && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-4">📬</div>
          <h3 className="text-lg font-medium text-white mb-2">No Briefings Yet</h3>
          <p className="text-slate-400 text-sm">
            Briefings are generated daily at 7 AM. Check back tomorrow for your first briefing!
          </p>
        </div>
      )}
    </div>
  );
}

function DashboardStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-slate-800/60 p-3">
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

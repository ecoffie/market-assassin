'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface PipelinePanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface PipelineOpportunity {
  id: string;
  notice_id?: string;
  title: string;
  agency?: string;
  value_estimate?: string;
  naics_code?: string;
  set_aside?: string;
  response_deadline?: string;
  stage: 'tracking' | 'pursuing' | 'bidding' | 'submitted' | 'won' | 'lost' | 'archived';
  win_probability?: number;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
  next_action?: string;
  next_action_date?: string;
  external_url?: string;
  created_at?: string;
}

const STAGES = [
  { id: 'tracking', label: 'Tracking', color: 'bg-slate-500', icon: '👁️' },
  { id: 'pursuing', label: 'Pursuing', color: 'bg-blue-500', icon: '🎯' },
  { id: 'bidding', label: 'Bidding', color: 'bg-amber-500', icon: '📝' },
  { id: 'submitted', label: 'Submitted', color: 'bg-purple-500', icon: '📤' },
  { id: 'won', label: 'Won', color: 'bg-emerald-500', icon: '🏆' },
  { id: 'lost', label: 'Lost', color: 'bg-red-500', icon: '❌' },
] as const;

export default function PipelinePanel({ email, tier }: PipelinePanelProps) {
  const [opportunities, setOpportunities] = useState<PipelineOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [stats, setStats] = useState<Record<string, number>>({});

  const loadPipeline = useCallback(async () => {
    if (!email) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/pipeline?email=${encodeURIComponent(email)}&stats=true`);
      const data = await res.json();

      if (data.error) {
        if (data.error.includes('42P01')) {
          // Table doesn't exist yet
          setOpportunities([]);
          setStats({});
        } else {
          setError(data.error);
        }
      } else {
        setOpportunities(data.opportunities || []);
        setStats(data.stats || {});
      }
    } catch (err) {
      console.error('Failed to load pipeline:', err);
      setError('Failed to load pipeline');
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    loadPipeline();
  }, [loadPipeline]);

  const getOpportunitiesByStage = (stage: string) => {
    return opportunities.filter(opp => opp.stage === stage);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'No deadline';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'critical': return 'text-red-400 bg-red-500/20';
      case 'high': return 'text-amber-400 bg-amber-500/20';
      case 'medium': return 'text-blue-400 bg-blue-500/20';
      default: return 'text-slate-400 bg-slate-500/20';
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-48" />
          <div className="grid grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-64 bg-slate-800 rounded-xl" />
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
          <h1 className="text-2xl font-bold text-white">Pipeline Tracker</h1>
          <p className="text-slate-400 mt-1">
            {opportunities.length} opportunities in pipeline
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode('board')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === 'board' ? 'bg-slate-700 text-white' : 'text-slate-400'
              }`}
            >
              Board
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === 'list' ? 'bg-slate-700 text-white' : 'text-slate-400'
              }`}
            >
              List
            </button>
          </div>
          <button
            onClick={loadPipeline}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Stats Bar */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {STAGES.slice(0, 4).map(stage => (
          <div
            key={stage.id}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg shrink-0"
          >
            <span>{stage.icon}</span>
            <span className="text-slate-400 text-sm">{stage.label}:</span>
            <span className="text-white font-semibold">{stats[stage.id] || getOpportunitiesByStage(stage.id).length}</span>
          </div>
        ))}
      </div>

      {/* Board View */}
      {viewMode === 'board' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {STAGES.map(stage => (
            <div key={stage.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className={`px-4 py-3 ${stage.color} bg-opacity-20 border-b border-slate-800`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{stage.icon} {stage.label}</span>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded-full text-slate-400">
                    {getOpportunitiesByStage(stage.id).length}
                  </span>
                </div>
              </div>
              <div className="p-2 space-y-2 max-h-[400px] overflow-y-auto">
                {getOpportunitiesByStage(stage.id).map(opp => (
                  <div
                    key={opp.id}
                    className="p-3 bg-slate-800/50 hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                  >
                    <div className="text-sm text-white font-medium line-clamp-2 mb-2">
                      {opp.title}
                    </div>
                    {opp.agency && (
                      <div className="text-xs text-slate-500 mb-1">{opp.agency}</div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">{formatDate(opp.response_deadline)}</span>
                      {opp.priority && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${getPriorityColor(opp.priority)}`}>
                          {opp.priority}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {getOpportunitiesByStage(stage.id).length === 0 && (
                  <div className="text-center py-4 text-slate-600 text-xs">
                    No opportunities
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && opportunities.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Opportunity</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Agency</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Stage</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Deadline</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Priority</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map(opp => (
                  <tr key={opp.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="text-sm text-white">{opp.title}</div>
                      {opp.value_estimate && (
                        <div className="text-xs text-emerald-400">{opp.value_estimate}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">{opp.agency || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded ${
                        STAGES.find(s => s.id === opp.stage)?.color || 'bg-slate-500'
                      } bg-opacity-20 text-white`}>
                        {opp.stage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">{formatDate(opp.response_deadline)}</td>
                    <td className="px-4 py-3">
                      {opp.priority && (
                        <span className={`text-xs px-2 py-1 rounded ${getPriorityColor(opp.priority)}`}>
                          {opp.priority}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && opportunities.length === 0 && !error && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <div className="text-5xl mb-4">📈</div>
          <h3 className="text-xl font-semibold text-white mb-2">Start Your Pipeline</h3>
          <p className="text-slate-400 mb-4 max-w-md mx-auto">
            Add opportunities from your alerts to track them through your pursuit process.
            Click &quot;Add to Pipeline&quot; on any opportunity to get started.
          </p>
          <a
            href="/bd-assist"
            target="_blank"
            className="inline-block px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Open Full BD Assist →
          </a>
        </div>
      )}
    </div>
  );
}

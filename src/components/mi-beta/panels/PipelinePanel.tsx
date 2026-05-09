'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';
import { getMIApiHeaders } from '../authHeaders';

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
  teaming_partners?: string[];
  external_url?: string;
  owner_email?: string;
  created_at?: string;
}

type PipelineStage = PipelineOpportunity['stage'];
type PipelinePriority = NonNullable<PipelineOpportunity['priority']>;

interface TeamingPartner {
  id: string;
  partner_name: string;
  partner_type?: 'prime' | 'sub' | 'jv' | 'mentor';
  contact_name?: string;
  contact_email?: string;
  outreach_status?: 'none' | 'contacted' | 'responded' | 'meeting' | 'partnered';
}

const STAGES = [
  { id: 'tracking', label: 'Tracking', color: 'bg-slate-500', icon: '👁️' },
  { id: 'pursuing', label: 'Pursuing', color: 'bg-blue-500', icon: '🎯' },
  { id: 'bidding', label: 'Bidding', color: 'bg-amber-500', icon: '📝' },
  { id: 'submitted', label: 'Submitted', color: 'bg-purple-500', icon: '📤' },
  { id: 'won', label: 'Won', color: 'bg-emerald-500', icon: '🏆' },
  { id: 'lost', label: 'Lost', color: 'bg-red-500', icon: '❌' },
] as const;

const PRIORITIES: Array<{ id: PipelinePriority; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'critical', label: 'Critical' },
];

export default function PipelinePanel({ email }: PipelinePanelProps) {
  const [opportunities, setOpportunities] = useState<PipelineOpportunity[]>([]);
  const [partners, setPartners] = useState<TeamingPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [stats, setStats] = useState<Record<string, number>>({});
  const [selectedOpportunity, setSelectedOpportunity] = useState<PipelineOpportunity | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

  const loadPipeline = useCallback(async () => {
    if (!email) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/pipeline?email=${encodeURIComponent(email)}&stats=true`, {
        headers: getAuthHeaders(),
      });
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
        setStats(data.stats?.byStage || data.stats || {});
      }
    } catch (err) {
      console.error('Failed to load pipeline:', err);
      setError('Failed to load pipeline');
    } finally {
      setLoading(false);
    }
  }, [email, getAuthHeaders]);

  useEffect(() => {
    loadPipeline();
  }, [loadPipeline]);

  const loadPartners = useCallback(async () => {
    if (!email) return;

    try {
      const res = await fetch(`/api/teaming?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!data.error) {
        setPartners(data.partners || []);
      }
    } catch (err) {
      console.error('Failed to load partners:', err);
    }
  }, [email, getAuthHeaders]);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  const getOpportunitiesByStage = (stage: string) => {
    return opportunities.filter(opp => opp.stage === stage);
  };

  const openOpportunity = (opportunity: PipelineOpportunity) => {
    setError(null);
    setNotice(null);
    setSelectedOpportunity(opportunity);
  };

  const updateOpportunity = async (updates: Partial<PipelineOpportunity>) => {
    if (!email || !selectedOpportunity) return;

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch('/api/pipeline', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: selectedOpportunity.id,
          user_email: email,
          ...updates,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to update pipeline item');
        return;
      }

      const updatedOpportunity = data.opportunity as PipelineOpportunity;
      setOpportunities(prev => prev.map(opp => (
        opp.id === updatedOpportunity.id ? updatedOpportunity : opp
      )));
      setSelectedOpportunity(updatedOpportunity);
      setNotice('Pipeline item updated.');
      loadPipeline();
    } catch (err) {
      console.error('Failed to update opportunity:', err);
      setError('Failed to update pipeline item');
    } finally {
      setIsSaving(false);
    }
  };

  const removeOpportunity = async () => {
    if (!email || !selectedOpportunity) return;
    if (!confirm('Remove this opportunity from your pipeline?')) return;

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch('/api/pipeline', {
        method: 'DELETE',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: selectedOpportunity.id,
          user_email: email,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to remove pipeline item');
        return;
      }

      setOpportunities(prev => prev.filter(opp => opp.id !== selectedOpportunity.id));
      setSelectedOpportunity(null);
      setNotice('Removed from pipeline.');
      loadPipeline();
    } catch (err) {
      console.error('Failed to remove opportunity:', err);
      setError('Failed to remove pipeline item');
    } finally {
      setIsSaving(false);
    }
  };

  const createPartner = async (partnerName: string) => {
    if (!email) return null;
    const normalizedName = partnerName.trim();
    if (!normalizedName) return null;

    try {
      const res = await fetch('/api/teaming', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          user_email: email,
          partner_name: normalizedName,
          partner_type: 'sub',
          outreach_status: 'none',
          source: 'pipeline_quick_create',
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const created = data.partner as TeamingPartner;
        setPartners(prev => [...prev, created].sort((a, b) => a.partner_name.localeCompare(b.partner_name)));
        return created;
      }

      if (res.status === 409) {
        const existing = partners.find(partner => partner.partner_name.toLowerCase() === normalizedName.toLowerCase());
        return existing || null;
      }

      setError(data.error || 'Failed to create teaming partner');
      return null;
    } catch (err) {
      console.error('Failed to create partner:', err);
      setError('Failed to create teaming partner');
      return null;
    }
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

      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-emerald-300 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-200 hover:text-white"
            aria-label="Dismiss notice"
          >
            X
          </button>
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
                    role="button"
                    tabIndex={0}
                    onClick={() => openOpportunity(opp)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openOpportunity(opp);
                      }
                    }}
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
                    {opp.next_action && (
                      <div className="mt-2 text-xs text-slate-400 line-clamp-1">
                        Next: {opp.next_action}
                      </div>
                    )}
                    {opp.owner_email && (
                      <div className="mt-1 text-[10px] text-slate-500">
                        Owner: {opp.owner_email}
                      </div>
                    )}
                    {opp.teaming_partners && opp.teaming_partners.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {opp.teaming_partners.slice(0, 2).map(partner => (
                          <span key={partner} className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-300 rounded">
                            {partner}
                          </span>
                        ))}
                        {opp.teaming_partners.length > 2 && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded">
                            +{opp.teaming_partners.length - 2}
                          </span>
                        )}
                      </div>
                    )}
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
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Owner</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Priority</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map(opp => (
                  <tr
                    key={opp.id}
                    onClick={() => openOpportunity(opp)}
                    className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm text-white">{opp.title}</div>
                      {opp.value_estimate && (
                        <div className="text-xs text-emerald-400">{opp.value_estimate}</div>
                      )}
                      {opp.next_action && (
                        <div className="text-xs text-slate-500 mt-1">Next: {opp.next_action}</div>
                      )}
                      {opp.teaming_partners && opp.teaming_partners.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {opp.teaming_partners.slice(0, 3).map(partner => (
                            <span key={partner} className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-300 rounded">
                              {partner}
                            </span>
                          ))}
                          {opp.teaming_partners.length > 3 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded">
                              +{opp.teaming_partners.length - 3}
                            </span>
                          )}
                        </div>
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
                    <td className="px-4 py-3 text-sm text-slate-400">{opp.owner_email || '-'}</td>
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

      {selectedOpportunity && (
        <PipelineEditDrawer
          opportunity={selectedOpportunity}
          savedPartners={partners}
          isSaving={isSaving}
          onClose={() => setSelectedOpportunity(null)}
          onSave={updateOpportunity}
          onRemove={removeOpportunity}
          onCreatePartner={createPartner}
        />
      )}
    </div>
  );
}

interface PipelineEditDrawerProps {
  opportunity: PipelineOpportunity;
  savedPartners: TeamingPartner[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (updates: Partial<PipelineOpportunity>) => void;
  onRemove: () => void;
  onCreatePartner: (partnerName: string) => Promise<TeamingPartner | null>;
}

function toDateInputValue(dateStr?: string) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function PipelineEditDrawer({
  opportunity,
  savedPartners,
  isSaving,
  onClose,
  onSave,
  onRemove,
  onCreatePartner,
}: PipelineEditDrawerProps) {
  const [stage, setStage] = useState<PipelineStage>(opportunity.stage);
  const [priority, setPriority] = useState<PipelinePriority>(opportunity.priority || 'medium');
  const [winProbability, setWinProbability] = useState(opportunity.win_probability?.toString() || '');
  const [nextAction, setNextAction] = useState(opportunity.next_action || '');
  const [nextActionDate, setNextActionDate] = useState(toDateInputValue(opportunity.next_action_date));
  const [ownerEmail, setOwnerEmail] = useState(opportunity.owner_email || '');
  const [notes, setNotes] = useState(opportunity.notes || '');
  const [partners, setPartners] = useState((opportunity.teaming_partners || []).join(', '));
  const [quickPartnerName, setQuickPartnerName] = useState('');
  const [isCreatingPartner, setIsCreatingPartner] = useState(false);

  const selectedPartnerNames = partners
    .split(',')
    .map(partner => partner.trim())
    .filter(Boolean);

  const togglePartner = (partnerName: string) => {
    const exists = selectedPartnerNames.some(name => name.toLowerCase() === partnerName.toLowerCase());
    const next = exists
      ? selectedPartnerNames.filter(name => name.toLowerCase() !== partnerName.toLowerCase())
      : [...selectedPartnerNames, partnerName];
    setPartners(next.join(', '));
  };

  const addQuickPartner = async () => {
    if (!quickPartnerName.trim()) return;
    setIsCreatingPartner(true);
    try {
      const created = await onCreatePartner(quickPartnerName);
      if (created) {
        const exists = selectedPartnerNames.some(name => name.toLowerCase() === created.partner_name.toLowerCase());
        if (!exists) {
          setPartners([...selectedPartnerNames, created.partner_name].join(', '));
        }
        setQuickPartnerName('');
      }
    } finally {
      setIsCreatingPartner(false);
    }
  };

  const submitUpdates = () => {
    const parsedProbability = winProbability.trim() ? Number(winProbability) : null;
    const partnerList = partners
      .split(',')
      .map(partner => partner.trim())
      .filter(Boolean);

    onSave({
      stage,
      priority,
      win_probability: typeof parsedProbability === 'number' && !Number.isNaN(parsedProbability)
        ? Math.min(100, Math.max(0, parsedProbability))
        : undefined,
      next_action: nextAction.trim() || undefined,
      next_action_date: nextActionDate || undefined,
      owner_email: ownerEmail.trim() || undefined,
      notes: notes.trim() || undefined,
      teaming_partners: partnerList,
    });
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 h-full w-full max-w-xl bg-slate-950 border-l border-slate-800 z-50 overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-slate-950/95 backdrop-blur border-b border-slate-800 p-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider">Pipeline Pursuit</p>
            <h2 className="text-lg font-semibold text-white mt-1 line-clamp-2">{opportunity.title}</h2>
            <p className="text-sm text-slate-500 mt-1">{opportunity.agency || 'Unknown Agency'}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Close pipeline editor"
          >
            X
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-500">Response Due</div>
              <div className="text-white font-medium mt-1">
                {opportunity.response_deadline ? new Date(opportunity.response_deadline).toLocaleDateString() : 'No deadline'}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-500">NAICS</div>
              <div className="text-white font-medium mt-1">{opportunity.naics_code || '-'}</div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-slate-300">Stage</span>
              <select
                value={stage}
                onChange={(event) => setStage(event.target.value as PipelineStage)}
                className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white focus:border-blue-500 outline-none"
              >
                {STAGES.map(item => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-slate-300">Priority</span>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as PipelinePriority)}
                className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white focus:border-blue-500 outline-none"
              >
                {PRIORITIES.map(item => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-slate-300">Win Probability</span>
              <input
                type="number"
                min="0"
                max="100"
                value={winProbability}
                onChange={(event) => setWinProbability(event.target.value)}
                placeholder="0-100"
                className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
              />
            </label>

            <label className="block">
              <span className="text-sm text-slate-300">Next Action Date</span>
              <input
                type="date"
                value={nextActionDate}
                onChange={(event) => setNextActionDate(event.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white focus:border-blue-500 outline-none"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm text-slate-300">Owner</span>
            <input
              type="email"
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
              placeholder="owner@company.com"
              className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
            />
          </label>

          <label className="block">
            <span className="text-sm text-slate-300">Next Action</span>
            <input
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="Call CO, qualify set-aside, identify teaming partner..."
              className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
            />
          </label>

          <div className="space-y-3">
            <div>
              <span className="text-sm text-slate-300">Teaming Partners</span>
              <p className="text-xs text-slate-500 mt-0.5">Attach saved CRM partners to this pursuit.</p>
            </div>

            {savedPartners.length > 0 ? (
              <div className="grid sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                {savedPartners.map(partner => {
                  const checked = selectedPartnerNames.some(name => name.toLowerCase() === partner.partner_name.toLowerCase());
                  return (
                    <label
                      key={partner.id}
                      className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                        checked
                          ? 'bg-blue-500/10 border-blue-500/40'
                          : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePartner(partner.partner_name)}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm text-white">{partner.partner_name}</span>
                        <span className="block text-xs text-slate-500">
                          {[partner.partner_type, partner.contact_name].filter(Boolean).join(' • ') || 'Saved partner'}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-500">
                No saved teaming partners yet.
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={quickPartnerName}
                onChange={(event) => setQuickPartnerName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addQuickPartner();
                  }
                }}
                placeholder="Quick-add partner company"
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
              />
              <button
                type="button"
                onClick={addQuickPartner}
                disabled={isCreatingPartner || !quickPartnerName.trim()}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg transition-colors"
              >
                {isCreatingPartner ? 'Adding...' : 'Add'}
              </button>
            </div>

            {selectedPartnerNames.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedPartnerNames.map(partner => (
                  <button
                    key={partner}
                    type="button"
                    onClick={() => togglePartner(partner)}
                    className="text-xs px-2 py-1 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 rounded"
                    title="Remove partner"
                  >
                    {partner} X
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-sm text-slate-300">Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={6}
              placeholder="Capture strategy, customer fit, requirements, blockers..."
              className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none resize-none"
            />
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={submitUpdates}
              disabled={isSaving}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium rounded-lg transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
            {opportunity.external_url && (
              <a
                href={opportunity.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-center font-medium rounded-lg transition-colors"
              >
                Open SAM.gov
              </a>
            )}
            <button
              onClick={onRemove}
              disabled={isSaving}
              className="px-4 py-3 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 text-red-300 border border-red-500/30 rounded-lg transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

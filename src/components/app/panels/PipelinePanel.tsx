'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AppTier, AppPanel } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import { useAppTracker } from '../track';
import { useToast } from '../Toast';

interface PipelinePanelProps {
  email: string | null;
  tier: AppTier;
  /** Hand-off to other panels. Used by the 'Draft Proposal' button on
   *  each pursuit to jump to Proposal Assist with the pursuit pre-loaded.
   *  Set by /app/page.tsx via handlePanelChange. */
  onPanelChange?: (panel: AppPanel, context?: Record<string, unknown>) => void;
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
  stage: 'tracking' | 'pursuing' | 'bidding' | 'submitted' | 'no_bid' | 'won' | 'lost' | 'archived';
  is_archived?: boolean;
  win_probability?: number;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
  next_action?: string;
  next_action_date?: string;
  teaming_partners?: string[];
  external_url?: string;
  owner_email?: string;
  created_at?: string;
  // Doc auto-ingest status (Pursuit Document Pipeline v1, 2026-05-25).
  // Set by fetchPursuitDocs background job after pursuit save.
  docs_status?: 'pending' | 'fetching' | 'ready' | 'none' | 'failed';
  docs_count?: number;
  docs_fetched_at?: string;
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

// Active stages shown on Board view (where BD spends 95% of time)
const ACTIVE_STAGES = [
  { id: 'tracking', label: 'Tracking', color: 'bg-slate-500', icon: '👁️' },
  { id: 'pursuing', label: 'Pursuing', color: 'bg-blue-500', icon: '🎯' },
  { id: 'bidding', label: 'Bidding', color: 'bg-amber-500', icon: '📝' },
  { id: 'submitted', label: 'Submitted', color: 'bg-purple-500', icon: '📤' },
] as const;

// Completed / terminal stages. no_bid lives here because once a user
// decides to pass, the opp leaves their active pipeline view but the
// record is preserved for "why did we say no" lookback. Won/Lost are
// the post-submission outcomes.
const COMPLETED_STAGES = [
  { id: 'no_bid', label: 'No-Bid', color: 'bg-gray-500', icon: '🚫' },
  { id: 'won', label: 'Won', color: 'bg-emerald-500', icon: '🏆' },
  { id: 'lost', label: 'Lost', color: 'bg-red-500', icon: '❌' },
] as const;

// All stages combined (for dropdowns and list view)
const STAGES = [...ACTIVE_STAGES, ...COMPLETED_STAGES] as const;

const PRIORITIES: Array<{ id: PipelinePriority; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'critical', label: 'Critical' },
];

export default function PipelinePanel({ email, tier, onPanelChange }: PipelinePanelProps) {
  // Owner column only matters when multiple teammates share pursuits.
  // Solo users (free/pro) always see their own email on every row —
  // that's just visual noise. Show only on team/enterprise tiers.
  const showOwnerColumn = tier === 'team' || tier === 'enterprise';
  const [opportunities, setOpportunities] = useState<PipelineOpportunity[]>([]);
  const [partners, setPartners] = useState<TeamingPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'board' | 'list'>('list');
  // Archived rows are hidden by default — they live in the DB for audit
  // history but pollute the active view. Toggle on the list view to see
  // them when the user wants to dig out an old opp.
  const [showArchived, setShowArchived] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false); // Toggle for Won/Lost in list view
  const [sortField, setSortField] = useState<'deadline' | 'value' | 'stage' | 'priority' | 'title'>('deadline');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [stats, setStats] = useState<Record<string, number>>({});
  const [selectedOpportunity, setSelectedOpportunity] = useState<PipelineOpportunity | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);
  const track = useAppTracker(email);
  const { showToast } = useToast();

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

  // Fire page_view once per email-resolution. /app's sidebar already
  // emits page_view on panel-switch, but this gives us a per-panel
  // breadcrumb visible to the Pipeline-specific queries the Launch
  // Command Center will run.
  useEffect(() => {
    if (!email) return;
    track('page_view', 'pipeline');
  }, [email, track]);

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
    // Always exclude archived from board view. Board is the
    // operating surface — archived means "out of mind", so they
    // shouldn't clutter it.
    return opportunities.filter(opp => opp.stage === stage && !opp.is_archived);
  };

  // Derived list for the table view, respecting the showArchived toggle.
  const visibleOpportunities = showArchived
    ? opportunities
    : opportunities.filter(opp => !opp.is_archived);

  // Parse value estimate to number for sorting (e.g., "$3.5M" -> 3500000)
  const parseValue = (val?: string): number => {
    if (!val) return 0;
    const cleaned = val.replace(/[^0-9.BMK]/gi, '');
    const num = parseFloat(cleaned) || 0;
    if (val.toUpperCase().includes('B')) return num * 1_000_000_000;
    if (val.toUpperCase().includes('M')) return num * 1_000_000;
    if (val.toUpperCase().includes('K')) return num * 1_000;
    return num;
  };

  // Get days until deadline (negative = overdue)
  const getDaysUntilDeadline = (deadline?: string): number => {
    if (!deadline) return 999999; // No deadline = sort to end
    return Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  // Get urgency badge for list view
  const getUrgencyBadge = (deadline?: string) => {
    if (!deadline) return null;
    const days = getDaysUntilDeadline(deadline);
    if (days < 0) return { label: 'OVERDUE', color: 'bg-red-500 text-white' };
    if (days <= 3) return { label: `${days}d`, color: 'bg-red-500 text-white' };
    if (days <= 7) return { label: `${days}d`, color: 'bg-amber-500 text-white' };
    if (days <= 14) return { label: `${days}d`, color: 'bg-yellow-500/20 text-yellow-300' };
    return null;
  };

  // Priority order for sorting
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const stageOrder: Record<string, number> = { tracking: 0, pursuing: 1, bidding: 2, submitted: 3, won: 4, lost: 5 };

  // Filter opportunities: active only, or include completed. Archived
  // rows are always excluded unless the user explicitly toggles
  // showArchived on — they live in DB for audit but should not be
  // visible by default on either board or list view.
  const nonArchivedOpps = showArchived ? opportunities : opportunities.filter(opp => !opp.is_archived);
  const activeOpportunities = nonArchivedOpps.filter(opp => !['won', 'lost', 'no_bid'].includes(opp.stage));
  const completedOpportunities = nonArchivedOpps.filter(opp => ['won', 'lost', 'no_bid'].includes(opp.stage));
  const filteredOpportunities = showCompleted ? nonArchivedOpps : activeOpportunities;

  // Sorted opportunities for list view
  const sortedOpportunities = [...filteredOpportunities].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case 'deadline':
        comparison = getDaysUntilDeadline(a.response_deadline) - getDaysUntilDeadline(b.response_deadline);
        break;
      case 'value':
        comparison = parseValue(b.value_estimate) - parseValue(a.value_estimate); // Higher value first
        break;
      case 'stage':
        comparison = stageOrder[a.stage] - stageOrder[b.stage];
        break;
      case 'priority':
        comparison = (priorityOrder[a.priority || 'medium']) - (priorityOrder[b.priority || 'medium']);
        break;
      case 'title':
        comparison = (a.title || '').localeCompare(b.title || '');
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortHeader = ({ field, children }: { field: typeof sortField; children: React.ReactNode }) => (
    <th
      onClick={() => handleSort(field)}
      className="text-left px-4 py-3 text-xs text-slate-500 font-medium cursor-pointer hover:text-slate-300 transition-colors select-none"
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <span className="text-blue-400">{sortDirection === 'asc' ? '↑' : '↓'}</span>
        )}
      </div>
    </th>
  );

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
      track('tool_use', 'pipeline', {
        action: 'update_opportunity',
        opportunity_id: selectedOpportunity.id,
        // Record which fields changed (keys only, not values) so we
        // can see what people actually edit without storing PII.
        updated_fields: Object.keys(updates),
      });
      loadPipeline();
    } catch (err) {
      console.error('Failed to update opportunity:', err);
      setError('Failed to update pipeline item');
    } finally {
      setIsSaving(false);
    }
  };

  const moveOpportunityToStage = async (opportunity: PipelineOpportunity, nextStage: PipelineStage) => {
    if (!email || opportunity.stage === nextStage) return;

    const previousStage = opportunity.stage;
    const nextStageLabel = STAGES.find(stage => stage.id === nextStage)?.label || nextStage;

    setError(null);
    setNotice(null);
    setOpportunities(prev => prev.map(opp => (
      opp.id === opportunity.id ? { ...opp, stage: nextStage } : opp
    )));

    try {
      const res = await fetch('/api/pipeline', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: opportunity.id,
          user_email: email,
          stage: nextStage,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setOpportunities(prev => prev.map(opp => (
          opp.id === opportunity.id ? { ...opp, stage: previousStage } : opp
        )));
        setError(data.error || 'Failed to move pipeline item');
        return;
      }

      const updatedOpportunity = data.opportunity as PipelineOpportunity;
      setOpportunities(prev => prev.map(opp => (
        opp.id === updatedOpportunity.id ? updatedOpportunity : opp
      )));
      // Highest-intent signal in the product. Capture from/to so the
      // Launch Command Center can see funnel progression
      // (tracking→pursuing = qualifying, submitted→won = closing).
      track('tool_use', 'pipeline', {
        action: 'move_stage',
        opportunity_id: opportunity.id,
        from_stage: previousStage,
        to_stage: nextStage,
        next_stage_label: nextStageLabel,
      });
      if (selectedOpportunity?.id === updatedOpportunity.id) {
        setSelectedOpportunity(updatedOpportunity);
      }
      setNotice(`Moved to ${nextStageLabel}.`);
      loadPipeline();
    } catch (err) {
      console.error('Failed to move opportunity:', err);
      setOpportunities(prev => prev.map(opp => (
        opp.id === opportunity.id ? { ...opp, stage: previousStage } : opp
      )));
      setError('Failed to move pipeline item');
    }
  };

  // Archive an opportunity. Soft-delete: sets is_archived=true so the
  // row stays in DB (for history/audit) but disappears from active
  // views. List view "Show archived" toggle (showArchived state below)
  // is the only way to bring it back into view. Includes Undo so a
  // misclick is a 5-second recoverable mistake, not a lost row.
  const archiveOpportunity = async (opportunity: PipelineOpportunity) => {
    if (!email) return;

    const previousArchived = opportunity.is_archived || false;
    // Optimistic: drop from the visible list immediately.
    setOpportunities(prev => prev.map(opp => (
      opp.id === opportunity.id ? { ...opp, is_archived: true } : opp
    )));

    try {
      const res = await fetch('/api/pipeline', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: opportunity.id,
          user_email: email,
          is_archived: true,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setOpportunities(prev => prev.map(opp => (
          opp.id === opportunity.id ? { ...opp, is_archived: previousArchived } : opp
        )));
        showToast({
          message: data?.error || 'Could not archive',
          variant: 'error',
        });
        return;
      }

      track('tool_use', 'pipeline', {
        action: 'archive',
        opportunity_id: opportunity.id,
        from_stage: opportunity.stage,
      });
      showToast({
        message: 'Archived',
        variant: 'info',
        action: {
          label: 'Undo',
          onClick: () => {
            setOpportunities(prev => prev.map(opp => (
              opp.id === opportunity.id ? { ...opp, is_archived: false } : opp
            )));
            fetch('/api/pipeline', {
              method: 'PATCH',
              headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({
                id: opportunity.id,
                user_email: email,
                is_archived: false,
              }),
            }).catch((err) => console.warn('[PipelinePanel] Undo archive failed:', err));
          },
        },
      });
    } catch (err) {
      console.error('Failed to archive opportunity:', err);
      setOpportunities(prev => prev.map(opp => (
        opp.id === opportunity.id ? { ...opp, is_archived: previousArchived } : opp
      )));
      showToast({ message: 'Network error — archive not saved', variant: 'error' });
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
      track('tool_use', 'pipeline', {
        action: 'delete_opportunity',
        opportunity_id: selectedOpportunity.id,
        // The stage at delete-time tells us where in the funnel
        // people abandon. A drop from "pursuing" is more meaningful
        // than a drop from "tracking".
        from_stage: selectedOpportunity.stage,
      });
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

  // Urgency computation
  const urgentOpportunities = opportunities.filter(opp => {
    if (!opp.response_deadline) return false;
    const daysUntil = Math.ceil((new Date(opp.response_deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return daysUntil <= 7 && daysUntil > 0;
  });

  const overdueOpportunities = opportunities.filter(opp => {
    if (!opp.response_deadline) return false;
    return new Date(opp.response_deadline) < new Date();
  });

  return (
    <div className="p-6 space-y-6">
      {/* Compact Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-2xl font-bold text-white">My Pursuits</h1>
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-300">
              {opportunities.length} tracked
            </span>
            {urgentOpportunities.length > 0 && (
              <span className="rounded bg-amber-500/20 px-2 py-1 text-sm text-amber-300">
                ⚡ {urgentOpportunities.length} due soon
              </span>
            )}
            {overdueOpportunities.length > 0 && (
              <span className="rounded bg-red-500/20 px-2 py-1 text-sm text-red-300">
                🔥 {overdueOpportunities.length} overdue
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
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
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm rounded-lg transition-colors"
          >
            ↻
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

      {/* Stats Bar - Only active stages + completed toggle */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {ACTIVE_STAGES.map(stage => (
          <div
            key={stage.id}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg shrink-0"
          >
            <span>{stage.icon}</span>
            <span className="text-slate-400 text-sm">{stage.label}:</span>
            <span className="text-white font-semibold">{stats[stage.id] || getOpportunitiesByStage(stage.id).length}</span>
          </div>
        ))}
        {/* Completed toggle (Won + Lost + No-Bid) */}
        {completedOpportunities.length > 0 && (
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg shrink-0 transition-colors ${
              showCompleted
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <span>🏁</span>
            <span className="text-sm">Completed:</span>
            <span className="font-semibold">{completedOpportunities.length}</span>
            {showCompleted && <span className="text-xs ml-1">✓</span>}
          </button>
        )}
        {/* Archived toggle. Only shows the chip when there's actually
            something archived — keeps the filter bar from being
            cluttered for new users with empty pipelines. */}
        {opportunities.some(opp => opp.is_archived) && (
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg shrink-0 transition-colors ${
              showArchived
                ? 'bg-slate-700/40 border-slate-500 text-slate-200'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <span>🗄</span>
            <span className="text-sm">Archived:</span>
            <span className="font-semibold">{opportunities.filter(opp => opp.is_archived).length}</span>
            {showArchived && <span className="text-xs ml-1">✓</span>}
          </button>
        )}
      </div>

      {/* Board View - Only 4 active stages for wider columns */}
      {viewMode === 'board' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {ACTIVE_STAGES.map(stage => (
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
                    {opp.value_estimate && (
                      <div className="mb-2 text-xs font-medium text-emerald-400">{opp.value_estimate}</div>
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
                    <div className="mt-3 text-xs font-medium text-blue-300">
                      Open details
                    </div>
                    {onPanelChange && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onPanelChange('proposals', { pursuit_id: opp.id });
                        }}
                        className="mt-2 w-full rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
                        title={
                          opp.docs_status === 'ready'
                            ? `${opp.docs_count || 0} doc(s) ready — open Proposal Assist`
                            : opp.docs_status === 'fetching'
                              ? 'SAM docs still downloading — Proposal Assist will load what is ready'
                              : opp.docs_status === 'none'
                                ? 'No SAM attachments — Proposal Assist will still draft from the notice metadata'
                                : 'Open Proposal Assist for this pursuit'
                        }
                      >
                        Draft Proposal →
                        {opp.docs_status === 'ready' && (opp.docs_count || 0) > 0 && (
                          <span className="ml-1 text-[10px] font-normal text-emerald-200">
                            {opp.docs_count} {opp.docs_count === 1 ? 'doc' : 'docs'}
                          </span>
                        )}
                        {opp.docs_status === 'fetching' && (
                          <span className="ml-1 text-[10px] font-normal text-emerald-200 animate-pulse">
                            fetching…
                          </span>
                        )}
                      </button>
                    )}
                    <label
                      className="mt-3 block"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className="sr-only">Move pursuit stage</span>
                      <select
                        value={opp.stage}
                        onChange={(event) => {
                          event.stopPropagation();
                          moveOpportunityToStage(opp, event.target.value as PipelineStage);
                        }}
                        className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none transition-colors hover:border-slate-500 focus:border-blue-500"
                      >
                        {STAGES.map(item => (
                          <option key={item.id} value={item.id}>Move to {item.label}</option>
                        ))}
                      </select>
                    </label>
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

      {/* List View - Improved Table */}
      {viewMode === 'list' && opportunities.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50">
                  <SortHeader field="title">Opportunity</SortHeader>
                  {showOwnerColumn && (
                    <th className="text-center px-2 py-3 text-xs text-slate-500 font-medium w-16">Owner</th>
                  )}
                  <SortHeader field="value">Value</SortHeader>
                  <SortHeader field="stage">Stage</SortHeader>
                  <SortHeader field="deadline">Deadline</SortHeader>
                  <SortHeader field="priority">Priority</SortHeader>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Next Action</th>
                  <th className="text-right px-2 py-3 text-xs text-slate-500 font-medium w-12">{/* Archive */}</th>
                </tr>
              </thead>
              <tbody>
                {sortedOpportunities.map(opp => {
                  const urgency = getUrgencyBadge(opp.response_deadline);
                  const stageInfo = STAGES.find(s => s.id === opp.stage);
                  return (
                    <tr
                      key={opp.id}
                      onClick={() => openOpportunity(opp)}
                      className={`border-b border-slate-800/50 hover:bg-slate-800/50 cursor-pointer transition-colors ${
                        urgency?.label === 'OVERDUE' ? 'bg-red-500/5' : ''
                      }`}
                    >
                      {/* Opportunity Title + Agency. Wider + 2-line
                          wrap so users can actually read the pursuit
                          name (was truncating at 1 line / 300px). */}
                      <td className="px-4 py-3 max-w-[420px]">
                        <div className="text-sm text-white font-medium line-clamp-2" title={opp.title}>{opp.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{opp.agency || 'Unknown Agency'}</div>
                        {opp.teaming_partners && opp.teaming_partners.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
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
                      </td>

                      {/* Owner — team/enterprise only. Solo users see
                          their own email on every row (visual noise),
                          so the column is hidden for free/pro tiers. */}
                      {showOwnerColumn && (
                        <td className="px-2 py-3 text-center">
                          {opp.owner_email ? (
                            <span
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-[10px] font-semibold uppercase text-slate-200"
                              title={opp.owner_email}
                            >
                              {opp.owner_email.slice(0, 2)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-600" title="Unassigned">—</span>
                          )}
                        </td>
                      )}

                      {/* Value — capped + truncated. Some rows have
                          deadline countdowns or Mindy notes stuffed
                          into value_estimate upstream (DATA BUG to
                          fix separately); cap stops them from
                          blowing out the column width. */}
                      <td className="px-4 py-3 max-w-[140px]">
                        {opp.value_estimate ? (
                          <span
                            className="text-sm font-semibold text-emerald-400 line-clamp-1 block"
                            title={opp.value_estimate}
                          >
                            {opp.value_estimate}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">-</span>
                        )}
                      </td>

                      {/* Stage Dropdown */}
                      <td className="px-4 py-3">
                        <div
                          className="inline-block"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <select
                            value={opp.stage}
                            onChange={(event) => {
                              event.stopPropagation();
                              moveOpportunityToStage(opp, event.target.value as PipelineStage);
                            }}
                            className={`rounded-lg border border-slate-700 ${stageInfo?.color || 'bg-slate-800'} bg-opacity-20 px-3 py-1.5 text-xs text-white font-medium outline-none transition-colors hover:border-slate-500 focus:border-blue-500 cursor-pointer`}
                          >
                            {STAGES.map(item => (
                              <option key={item.id} value={item.id}>{item.icon} {item.label}</option>
                            ))}
                          </select>
                        </div>
                      </td>

                      {/* Deadline with Urgency Badge */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-300">{formatDate(opp.response_deadline)}</span>
                          {urgency && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${urgency.color}`}>
                              {urgency.label}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Priority */}
                      <td className="px-4 py-3">
                        {opp.priority ? (
                          <span className={`text-xs px-2 py-1 rounded font-medium ${getPriorityColor(opp.priority)}`}>
                            {opp.priority.charAt(0).toUpperCase() + opp.priority.slice(1)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">-</span>
                        )}
                      </td>

                      {/* Next Action */}
                      <td className="px-4 py-3 max-w-[200px]">
                        {opp.next_action ? (
                          <div>
                            <div className="text-xs text-slate-300 line-clamp-1">{opp.next_action}</div>
                            {opp.next_action_date && (
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                Due: {formatDate(opp.next_action_date)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-600">-</span>
                        )}
                      </td>

                      {/* Archive button column. Separate from the stage
                          dropdown because Archive is an orthogonal
                          action — a row in any stage (including Won)
                          can be archived once you're done with it.
                          stopPropagation so the row's onClick doesn't
                          fire and open the detail drawer. */}
                      <td className="px-2 py-3 w-12 text-right">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            archiveOpportunity(opp);
                          }}
                          title="Archive (hide from active view)"
                          className="text-slate-500 hover:text-slate-200 text-xs px-2 py-1 rounded hover:bg-slate-800 transition-colors"
                        >
                          {opp.is_archived ? '↩' : '🗄'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && opportunities.length === 0 && !error && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">📈</div>
            <h3 className="text-xl font-semibold text-white mb-2">Start Your Pipeline</h3>
            <p className="text-slate-400 max-w-lg mx-auto">
              Track opportunities through your pursuit process. Add from Market Research, alerts, or forecasts.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 max-w-2xl mx-auto">
            <div className="bg-slate-800/50 rounded-lg p-4">
              <div className="text-lg mb-2">📊</div>
              <h4 className="text-sm font-medium text-white mb-1">Market Research</h4>
              <p className="text-xs text-slate-500">Click &quot;Track in Pipeline&quot; on any forecast opportunity</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4">
              <div className="text-lg mb-2">🔔</div>
              <h4 className="text-sm font-medium text-white mb-1">Daily Alerts</h4>
              <p className="text-xs text-slate-500">Track opportunities from your personalized alerts</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4">
              <div className="text-lg mb-2">🔮</div>
              <h4 className="text-sm font-medium text-white mb-1">Forecasts</h4>
              <p className="text-xs text-slate-500">Add upcoming procurements to track early</p>
            </div>
          </div>
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

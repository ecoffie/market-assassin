'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mic } from 'lucide-react';
import type { AppTier, AppPanel } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import { useAppTracker } from '../track';
import { useToast } from '../Toast';
import { getNaics } from '@/lib/codes/lookup';
import VoiceCaptureModal from '../voice/VoiceCaptureModal';

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
  // SAM notice type (Solicitation / Sources Sought / Combined / etc.),
  // enriched server-side from sam_opportunities by notice_id. Lets the
  // list filter/group by solicitation type.
  notice_type?: string | null;
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
  // Draft auto-archive signal (set client-side by the loader from
  // user_generated_archive matches). Lets the card show "Continue
  // Draft → ✓ N sections" instead of "Draft Proposal →" when drafts
  // exist. Per Eric (2026-05-27): "how do we know which ones have
  // [drafts]".
  has_drafts?: boolean;
  draft_count?: number;
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
  // Filter by SAM notice type (Solicitation / Sources Sought / etc.).
  // 'all' = no filter. Lets the user categorize pursuits by sol type.
  const [noticeTypeFilter, setNoticeTypeFilter] = useState<string>('all');
  const [voiceOpen, setVoiceOpen] = useState(false);          // Voice capture modal (#119)
  const [sortField, setSortField] = useState<'deadline' | 'value' | 'stage' | 'priority' | 'title'>('deadline');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
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
        } else {
          setError(data.error);
        }
      } else {
        const opps: PipelineOpportunity[] = data.opportunities || [];
        // Annotate has_drafts + draft_count from the library auto-archive.
        // Per Eric (2026-05-27): "how do we know which ones have [drafts]".
        // We match library entries to pursuits by title containment since
        // we don't have a pursuit_id foreign-key on library rows yet.
        try {
          const libRes = await fetch(`/api/app/library?email=${encodeURIComponent(email)}&type=proposal_section`, {
            headers: getAuthHeaders(),
          });
          const libData = libRes.ok ? await libRes.json() : null;
          if (libData?.success && Array.isArray(libData.entries)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const entries: any[] = libData.entries;
            const countsByTitle = new Map<string, number>();
            for (const e of entries) {
              const titleHaystack = (e.title || '').toLowerCase();
              countsByTitle.set(titleHaystack, (countsByTitle.get(titleHaystack) || 0) + 1);
            }
            // For each opp, count library entries whose title CONTAINS the
            // pursuit's title (library titles look like "Past Performance —
            // Z--DK - SHADEHILL GATEHOUSE ROOFING")
            for (const opp of opps) {
              const oppKey = (opp.title || '').toLowerCase().slice(0, 40);
              if (!oppKey) continue;
              let cnt = 0;
              for (const [libTitle, c] of countsByTitle) {
                if (libTitle.includes(oppKey)) cnt += c;
              }
              if (cnt > 0) {
                opp.has_drafts = true;
                opp.draft_count = cnt;
              }
            }
          }
        } catch { /* non-fatal — cards just won't show drafted badge */ }
        setOpportunities(opps);
        // (Per-stage counts are derived client-side from `opportunities`
        // so the stat strip and board columns can't diverge — see the
        // stat strip render. The server stats.byStage counted archived
        // rows and is no longer used.)
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
  const stageScoped = showCompleted ? nonArchivedOpps : activeOpportunities;

  // Notice-type categorization. Bucket the free-text sam notice_type
  // into clean labels so the filter dropdown is short + the badge is
  // consistent. Pursuits with no known type bucket as "Other".
  const noticeBucket = (nt?: string | null): string => {
    if (!nt) return 'Other';
    const t = nt.toLowerCase();
    if (t.includes('sources sought')) return 'Sources Sought';
    if (t.includes('combined')) return 'Combined';
    if (t.includes('presol') || t.includes('pre-sol') || t.includes('pre sol')) return 'Pre-Solicitation';
    if (t.includes('rfq') || t.includes('quot')) return 'RFQ';
    if (t.includes('rfi') || t.includes('information')) return 'RFI';
    if (t.includes('award')) return 'Award';
    if (t.includes('special')) return 'Special Notice';
    if (t.includes('solicitation') || t.includes('rfp')) return 'Solicitation';
    return 'Other';
  };
  // Distinct notice-type buckets present in the user's pursuits, for the
  // filter dropdown (only show types they actually have).
  const availableNoticeTypes = [...new Set(stageScoped.map(o => noticeBucket(o.notice_type)))].sort();

  const filteredOpportunities = noticeTypeFilter === 'all'
    ? stageScoped
    : stageScoped.filter(o => noticeBucket(o.notice_type) === noticeTypeFilter);

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

  // Urgency computation. Only ACTIVE pursuits can be urgent/overdue — a
  // won / lost / no-bid / archived pursuit is done, so a past deadline on
  // it isn't something the user is "late" on. (Previously these counted
  // every stage, so the header showed e.g. "7 overdue" that were all
  // completed pursuits with past deadlines.)
  const isActivePursuit = (opp: PipelineOpportunity): boolean =>
    !opp.is_archived && !['won', 'lost', 'no_bid'].includes(opp.stage);

  const urgentOpportunities = opportunities.filter(opp => {
    if (!isActivePursuit(opp) || !opp.response_deadline) return false;
    const daysUntil = Math.ceil((new Date(opp.response_deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return daysUntil <= 7 && daysUntil > 0;
  });

  const overdueOpportunities = opportunities.filter(opp => {
    if (!isActivePursuit(opp) || !opp.response_deadline) return false;
    return new Date(opp.response_deadline) < new Date();
  });

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6 overflow-x-hidden">
      {/* Compact Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-2xl font-bold text-white">My Pursuits</h1>
          <div className="flex items-center gap-2">
            {/* "Tracking" = active pursuits the user is working now, NOT
                lifetime history. Completed (won/lost/no-bid) and archived
                pursuits are shown as a separate, muted count so the
                headline number reflects the actual live workload. */}
            <span className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-300">
              {activeOpportunities.length} active
            </span>
            {completedOpportunities.length > 0 && (
              <span className="rounded bg-slate-800/60 px-2 py-1 text-sm text-slate-500">
                {completedOpportunities.length} completed
              </span>
            )}
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
            onClick={() => setVoiceOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors font-medium"
            title="Voice capture — talk, Mindy turns it into a pursuit"
          >
            <Mic className="w-4 h-4" strokeWidth={1.75} />
            Add by voice
          </button>
          <button
            onClick={loadPipeline}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm rounded-lg transition-colors"
          >
            ↻
          </button>
        </div>
      </div>

      {email && (
        <VoiceCaptureModal
          email={email}
          isOpen={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          onSaved={() => {
            showToast({ message: 'Pursuit added from voice capture', variant: 'success' });
            loadPipeline();
          }}
        />
      )}

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

      {/* Stats Bar - Only active stages + completed toggle.
          Negative mx on mobile so the row can horizontal-scroll
          edge-to-edge without leaving the first pill clipped behind
          the panel's p-3 left padding. */}
      <div className="flex gap-2 md:gap-4 overflow-x-auto pb-2 -mx-3 md:mx-0 px-3 md:px-0">
        {ACTIVE_STAGES.map(stage => (
          <div
            key={stage.id}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg shrink-0"
          >
            <span>{stage.icon}</span>
            <span className="text-slate-400 text-sm">{stage.label}:</span>
            {/* Use the SAME archive-aware client count as the board
                columns. The server stats.byStage counts archived rows
                too, so an archived 'tracking' pursuit showed Tracking: 1
                in the strip while the column correctly showed 0. */}
            <span className="text-white font-semibold">{getOpportunitiesByStage(stage.id).length}</span>
          </div>
        ))}
        {/* Notice-type filter — categorize pursuits by solicitation type.
            Only shown when the pursuits span more than one type. */}
        {availableNoticeTypes.length > 1 && (
          <select
            value={noticeTypeFilter}
            onChange={(e) => setNoticeTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-900 text-sm text-slate-300 shrink-0 outline-none focus:border-purple-500"
            title="Filter by solicitation type"
          >
            <option value="all">All types</option>
            {availableNoticeTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
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

      {/* Board View - Only 4 active stages for wider columns.
          Mobile: stack columns vertically (1 column) so cards stay
          readable. Tablet: 2 columns. Desktop: 4 columns side-by-side.
          The mobile cramming-2-columns-into-360px was unreadable. */}
      {viewMode === 'board' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
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
                    {/* Draft Proposal — only shown for pursuing/bidding/submitted
                        stages. Per Eric (2026-05-27): "if we are tracking do
                        we need to draft?" — tracking is "watching", drafting
                        comes after the decision to pursue. Won/lost/no_bid
                        also hide it (work is done).
                        Per Eric (2026-05-31): hide entirely when the SAM
                        notice has no attachments AND the user hasn't manually
                        uploaded a draft yet. Drafting from metadata alone
                        produces generic content that confused users into
                        thinking the tool was broken. We replace it with an
                        explicit "Upload an RFP" link so the next action is
                        clear. */}
                    {onPanelChange && ['pursuing', 'bidding', 'submitted'].includes(opp.stage) && (() => {
                      // "No docs" = explicit 'none'/'failed' OR no status at
                      // all (pursuits saved before the doc pipeline, or whose
                      // fetch never ran) OR a zero count. The old check only
                      // matched the literal 'none', so legacy/undefined-status
                      // pursuits wrongly showed "Draft Proposal" despite having
                      // nothing to draft from.
                      const hasDocs = (opp.docs_count || 0) > 0
                        || opp.docs_status === 'ready'
                        || opp.docs_status === 'fetching'
                        || opp.docs_status === 'pending';
                      const noAttachmentsAndNoDraft = !hasDocs && !opp.has_drafts;
                      if (noAttachmentsAndNoDraft) {
                        return (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onPanelChange('proposals', { pursuit_id: opp.id });
                            }}
                            className="mt-2 w-full rounded-md border border-amber-700/60 bg-amber-950/30 px-2 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-900/40"
                            title="No SAM attachments — open Proposal Assist to upload an RFP manually"
                          >
                            Upload an RFP →
                          </button>
                        );
                      }
                      return (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onPanelChange('proposals', { pursuit_id: opp.id });
                          }}
                          className="mt-2 w-full rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
                          title={
                            opp.has_drafts
                              ? `Has prior drafts — open Proposal Assist to continue`
                              : opp.docs_status === 'ready'
                                ? `${opp.docs_count || 0} doc(s) ready — open Proposal Assist`
                                : opp.docs_status === 'fetching'
                                  ? 'SAM docs still downloading — Proposal Assist will load what is ready'
                                  : 'Open Proposal Assist for this pursuit'
                          }
                        >
                          {opp.has_drafts ? 'Continue Draft →' : 'Draft Proposal →'}
                          {opp.has_drafts && (
                            <span className="ml-1 text-[10px] font-normal text-emerald-200">
                              ✓ {opp.draft_count} {opp.draft_count === 1 ? 'section' : 'sections'}
                            </span>
                          )}
                          {!opp.has_drafts && opp.docs_status === 'ready' && (opp.docs_count || 0) > 0 && (
                            <span className="ml-1 text-[10px] font-normal text-emerald-200">
                              {opp.docs_count} {opp.docs_count === 1 ? 'doc' : 'docs'}
                            </span>
                          )}
                          {!opp.has_drafts && opp.docs_status === 'fetching' && (
                            <span className="ml-1 text-[10px] font-normal text-emerald-200 animate-pulse">
                              fetching…
                            </span>
                          )}
                        </button>
                      );
                    })()}
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
                  <th className="text-center px-2 py-3 text-xs text-slate-500 font-medium w-24">Actions</th>
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
                        <div className="flex items-center gap-2 mt-0.5">
                          {opp.notice_type && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300 shrink-0" title={opp.notice_type}>
                              {noticeBucket(opp.notice_type)}
                            </span>
                          )}
                          <span className="text-xs text-slate-500 line-clamp-1">{opp.agency || 'Unknown Agency'}</span>
                        </div>
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
                      <td className="px-2 py-3 w-24 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Draft Proposal — same action as on the
                              Board view cards. Opens Proposal Assist
                              with this pursuit's docs auto-loaded. */}
                          {onPanelChange && (() => {
                            // Same "no docs" logic as the Board card — treat
                            // missing/undefined status as no docs, not just
                            // the literal 'none'.
                            const hasDocs = (opp.docs_count || 0) > 0
                              || opp.docs_status === 'ready'
                              || opp.docs_status === 'fetching'
                              || opp.docs_status === 'pending';
                            const noAttachmentsAndNoDraft = !hasDocs && !opp.has_drafts;
                            if (noAttachmentsAndNoDraft) {
                              return (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onPanelChange('proposals', { pursuit_id: opp.id });
                                  }}
                                  title="No SAM attachments — open Proposal Assist to upload an RFP"
                                  className="rounded border border-amber-700/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 hover:bg-amber-900/50"
                                >
                                  📎
                                </button>
                              );
                            }
                            return (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onPanelChange('proposals', { pursuit_id: opp.id });
                                }}
                                title={
                                  opp.docs_status === 'ready'
                                    ? `Draft Proposal — ${opp.docs_count || 0} doc(s) ready`
                                    : opp.docs_status === 'fetching'
                                      ? 'Draft Proposal — SAM docs still downloading'
                                      : 'Draft Proposal'
                                }
                                className="rounded bg-emerald-600/80 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-500"
                              >
                                📝
                              </button>
                            );
                          })()}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              archiveOpportunity(opp);
                            }}
                            title="Archive (hide from active view)"
                            className="text-slate-500 hover:text-slate-200 text-xs px-1.5 py-0.5 rounded hover:bg-slate-800 transition-colors"
                          >
                            {opp.is_archived ? '↩' : '🗄'}
                          </button>
                        </div>
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
          email={email || ''}
          authHeaders={getAuthHeaders}
          onClose={() => setSelectedOpportunity(null)}
          onSave={updateOpportunity}
          onRemove={removeOpportunity}
          onCreatePartner={createPartner}
          onDocsUpdated={loadPipeline}
        />
      )}
    </div>
  );
}

interface PipelineEditDrawerProps {
  opportunity: PipelineOpportunity;
  savedPartners: TeamingPartner[];
  isSaving: boolean;
  email: string;
  authHeaders: (init?: HeadersInit) => HeadersInit;
  onClose: () => void;
  onSave: (updates: Partial<PipelineOpportunity>) => void;
  onRemove: () => void;
  onCreatePartner: (partnerName: string) => Promise<TeamingPartner | null>;
  /** Called after a docs re-fetch so the parent can refresh the row. */
  onDocsUpdated: () => void;
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
  email,
  authHeaders,
  onClose,
  onSave,
  onRemove,
  onCreatePartner,
  onDocsUpdated,
}: PipelineEditDrawerProps) {
  // Load the actual document list for this pursuit so the drawer can
  // show the files (name + size + SAM link), not just a count. Fetched
  // when the drawer opens; re-fetched after a retry.
  const [docList, setDocList] = useState<Array<{
    id: string; filename: string; sam_url: string | null; size_bytes: number | null;
    char_count: number | null; extraction_error: string | null;
  }>>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const loadDocList = useCallback(async () => {
    if (!email || !opportunity.id) return;
    setDocsLoading(true);
    try {
      const res = await fetch(
        `/api/app/proposal/pursuit-docs?email=${encodeURIComponent(email)}&pipeline_id=${encodeURIComponent(opportunity.id)}`,
        { headers: authHeaders() },
      );
      const data = await res.json().catch(() => null);
      if (data?.success) setDocList(data.documents || []);
    } catch { /* non-fatal */ } finally {
      setDocsLoading(false);
    }
  }, [email, opportunity.id, authHeaders]);
  useEffect(() => { loadDocList(); }, [loadDocList]);

  // Full SAM solicitation description — lazy-loaded on demand (it can be
  // long). Public endpoint, no auth. Shown in the drawer because this is
  // where the user actually works the pursuit.
  const [fullDescription, setFullDescription] = useState<string | null>(null);
  const [descLoading, setDescLoading] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);
  const loadFullDescription = useCallback(async () => {
    if (!opportunity.notice_id || fullDescription || descLoading) return;
    setDescLoading(true);
    setDescError(null);
    try {
      const res = await fetch(`/api/sam-description?noticeId=${encodeURIComponent(opportunity.notice_id)}`);
      const data = await res.json().catch(() => null);
      if (data?.success && data.description) setFullDescription(data.description);
      else setDescError('Full description not available for this notice.');
    } catch {
      setDescError('Could not load the description.');
    } finally {
      setDescLoading(false);
    }
  }, [opportunity.notice_id, fullDescription, descLoading]);

  // Docs re-fetch recovery. Pursuits can get stuck at docs_status
  // 'fetching' if the one-time cold fetch was orphaned. This re-runs it
  // and refreshes the file list.
  const [refetching, setRefetching] = useState(false);
  const [refetchMsg, setRefetchMsg] = useState<string | null>(null);
  const retryDocsFetch = useCallback(async () => {
    if (!email || !opportunity.id || refetching) return;
    setRefetching(true);
    setRefetchMsg(null);
    try {
      const res = await fetch(
        `/api/app/proposal/pursuit-docs?email=${encodeURIComponent(email)}&pipeline_id=${encodeURIComponent(opportunity.id)}`,
        { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }) },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setRefetchMsg(data?.error || 'Re-fetch failed.');
      } else {
        const st = data.docs_status;
        setRefetchMsg(st === 'ready' ? 'Documents loaded.' : st === 'none' ? 'SAM has no attachments for this notice.' : 'Done.');
        onDocsUpdated();
        loadDocList();  // refresh the file list now that docs may exist
      }
    } catch {
      setRefetchMsg('Network error.');
    } finally {
      setRefetching(false);
    }
  }, [email, opportunity.id, refetching, authHeaders, onDocsUpdated, loadDocList]);

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
          {/* Source & Documents — lets the user verify on SAM.gov and see
              whether RFP docs are attached BEFORE entering the proposal
              wizard. Previously the drawer showed neither, so users
              walked into "no attachments" blind. */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">Source</div>
              {(() => {
                const samUrl = opportunity.external_url
                  || (opportunity.notice_id ? `https://sam.gov/opp/${opportunity.notice_id}/view` : null);
                return samUrl ? (
                  <a
                    href={samUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 underline"
                  >
                    Verify on SAM.gov ↗
                  </a>
                ) : (
                  <span className="text-xs text-slate-600">No SAM link</span>
                );
              })()}
            </div>
            {opportunity.notice_id && (
              <div className="text-[11px] font-mono text-slate-500 break-all">
                Notice: {opportunity.notice_id}
              </div>
            )}
            {/* Doc-attached status + recovery. A 'Retry' link re-runs the
                (dedup-backed) fetch — used when a pursuit got stuck at
                'fetching' or 'failed'. */}
            {(() => {
              const count = opportunity.docs_count || 0;
              const status = opportunity.docs_status;
              const canRetry = !!opportunity.notice_id;
              const RetryLink = canRetry ? (
                <button
                  type="button"
                  onClick={retryDocsFetch}
                  disabled={refetching}
                  className="ml-2 underline text-blue-400 hover:text-blue-300 disabled:opacity-50"
                >
                  {refetching ? 'fetching…' : 'Retry'}
                </button>
              ) : null;

              let body: React.ReactNode;
              if (count > 0) {
                body = <span className="text-emerald-300">📎 {count} document{count === 1 ? '' : 's'} attached — ready to draft</span>;
              } else if (status === 'fetching' || status === 'pending') {
                body = <span className="text-amber-300">⏳ Fetching documents from SAM…{RetryLink}</span>;
              } else if (status === 'failed') {
                body = <span className="text-red-300">⚠ Document fetch failed.{RetryLink}</span>;
              } else {
                body = (
                  <span className="text-slate-400">
                    📭 No documents attached — the wizard works from metadata only.{RetryLink}
                  </span>
                );
              }
              return (
                <div className="text-xs">
                  {body}
                  {refetchMsg && <div className="mt-1 text-[11px] text-slate-500">{refetchMsg}</div>}
                </div>
              );
            })()}

            {/* The actual files. Each row: filename + size, link to view
                on SAM. This is what users expect to "see the documents". */}
            {docList.length > 0 && (
              <ul className="mt-2 space-y-1.5 border-t border-slate-800 pt-2">
                {docList.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="shrink-0">📄</span>
                      <span className="truncate text-slate-200" title={d.filename}>{d.filename}</span>
                      {d.extraction_error && (
                        <span className="shrink-0 text-amber-400" title={d.extraction_error}>⚠</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 shrink-0 text-slate-500">
                      {typeof d.size_bytes === 'number' && d.size_bytes > 0 && (
                        <span>{(d.size_bytes / 1024).toFixed(0)} KB</span>
                      )}
                      {d.sam_url && (
                        <a
                          href={d.sam_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 underline"
                        >
                          view ↗
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {docsLoading && docList.length === 0 && (
              <div className="mt-2 text-[11px] text-slate-600">Loading documents…</div>
            )}

            {/* Full SAM solicitation text — lazy-loaded on demand since
                it can be long. This is the working surface, so the full
                description belongs here. */}
            {opportunity.notice_id && (
              <div className="mt-2 border-t border-slate-800 pt-2">
                {!fullDescription && !descLoading && (
                  <button
                    type="button"
                    onClick={loadFullDescription}
                    className="text-xs text-blue-400 hover:text-blue-300 underline"
                  >
                    Read full solicitation
                  </button>
                )}
                {descLoading && <div className="text-[11px] text-slate-600">Loading description…</div>}
                {descError && <div className="text-[11px] text-amber-400">{descError}</div>}
                {fullDescription && (
                  <div className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                    {fullDescription}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-500">Response Due</div>
              <div className="text-white font-medium mt-1">
                {opportunity.response_deadline ? new Date(opportunity.response_deadline).toLocaleDateString() : 'No deadline'}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-500">NAICS</div>
              {(() => {
                if (!opportunity.naics_code) return <div className="text-white font-medium mt-1">-</div>;
                const naicsEntry = getNaics(opportunity.naics_code);
                return (
                  <div className="mt-1">
                    <div className="text-white font-medium font-mono text-sm">{opportunity.naics_code}</div>
                    {naicsEntry && (
                      <div className="text-xs text-slate-400 mt-0.5" title={naicsEntry.title}>
                        {naicsEntry.title}
                      </div>
                    )}
                  </div>
                );
              })()}
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

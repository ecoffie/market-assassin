'use client';

import { useState, useEffect } from 'react';
import PipelineCard from './PipelineCard';
import PipelineModal, { PipelineFormData } from './PipelineModal';

export interface PipelineBoardProps {
  email: string;
}

interface PipelineOpportunity {
  id: string;
  title: string;
  agency?: string;
  value_estimate?: string;
  response_deadline?: string;
  stage: string;
  priority?: string;
  win_probability?: number;
  notice_id?: string;
  source?: string;
  naics_code?: string;
  set_aside?: string;
  notes?: string;
  external_url?: string;
  teaming_partners?: string[] | string;
  owner_email?: string;
  next_action?: string;
  next_action_date?: string;
  workspace_id?: string;
}

// The pursuit lifecycle. `tracking` is the giant WATCHLIST (94% of rows) — it
// gets its own searchable rail, not a Kanban column. The rest are the ACTIVE
// funnel lanes. `no_bid` is included on purpose: the old board omitted it, so
// its 65 real rows rendered in NO column and were invisible. `dot` is a hex for
// the colored stage dot; lane accents use the same hue via inline style.
const STAGES = [
  { key: 'tracking', label: 'Tracking', dot: '#64788c' },
  { key: 'pursuing', label: 'Pursuing', dot: '#3b82f6' },
  { key: 'bidding', label: 'Bidding', dot: '#d4a11a' },
  { key: 'submitted', label: 'Submitted', dot: '#8b5cf6' },
  { key: 'won', label: 'Won', dot: '#10b981' },
  { key: 'no_bid', label: 'No-bid', dot: '#8b6a4a' },
  { key: 'lost', label: 'Lost', dot: '#ef4444' },
] as const;

// The active funnel lanes shown as columns (everything except the tracking
// watchlist, which lives in its own rail).
const ACTIVE_STAGES = STAGES.filter((s) => s.key !== 'tracking');

export default function PipelineBoard({ email }: PipelineBoardProps) {
  const [opportunities, setOpportunities] = useState<PipelineOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PipelineOpportunity | null>(null);
  const [watchQuery, setWatchQuery] = useState('');

  // Load pipeline data
  const loadPipeline = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/pipeline?email=${encodeURIComponent(email)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load pipeline');
      }

      setOpportunities(data.opportunities || []);
    } catch (err) {
      console.error('Failed to load pipeline:', err);
      setError(err instanceof Error ? err.message : 'Failed to load pipeline');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (email) {
      loadPipeline();
    }
  }, [email]);

  // Handle stage change
  const handleStageChange = async (id: string, newStage: string) => {
    try {
      const response = await fetch('/api/pipeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          user_email: email,
          stage: newStage
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update stage');
      }

      // Update local state
      setOpportunities(prev =>
        prev.map(opp =>
          opp.id === id ? { ...opp, stage: newStage } : opp
        )
      );
    } catch (err) {
      console.error('Failed to update stage:', err);
      alert(err instanceof Error ? err.message : 'Failed to update stage');
    }
  };

  // Handle edit
  const handleEdit = (id: string) => {
    const item = opportunities.find(opp => opp.id === id);
    if (item) {
      setEditingItem(item);
      setIsModalOpen(true);
    }
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    try {
      const response = await fetch('/api/pipeline', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          user_email: email
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete');
      }

      // Update local state
      setOpportunities(prev => prev.filter(opp => opp.id !== id));
    } catch (err) {
      console.error('Failed to delete:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  // Handle save (add or update)
  const handleSave = async (formData: PipelineFormData) => {
    const isEditing = !!editingItem;

    try {
      const response = await fetch('/api/pipeline', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEditing ? { id: editingItem.id } : {}),
          user_email: email,
          ...formData
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save');
      }

      // Reload pipeline to get fresh data
      await loadPipeline();

      setIsModalOpen(false);
      setEditingItem(null);
    } catch (err) {
      console.error('Failed to save:', err);
      throw err; // Re-throw so modal can show error
    }
  };

  // Group opportunities by stage. Any row whose stage isn't one of ours (legacy /
  // unknown) falls into the tracking watchlist rather than vanishing.
  const known = new Set<string>(STAGES.map((s) => s.key));
  const groupedByStage = STAGES.reduce((acc, stage) => {
    acc[stage.key] =
      stage.key === 'tracking'
        ? opportunities.filter((opp) => opp.stage === 'tracking' || !known.has(opp.stage))
        : opportunities.filter((opp) => opp.stage === stage.key);
    return acc;
  }, {} as Record<string, PipelineOpportunity[]>);

  const watchlist = groupedByStage['tracking'] || [];
  const filteredWatchlist = watchQuery.trim()
    ? watchlist.filter((o) => {
        const q = watchQuery.toLowerCase();
        return (
          (o.title || '').toLowerCase().includes(q) ||
          (o.agency || '').toLowerCase().includes(q)
        );
      })
    : watchlist;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
          <p className="text-muted">Loading your pursuits…</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
        <div className="text-red-400 font-semibold mb-2">Failed to load your pursuits</div>
        <p className="text-red-300/80 text-sm mb-4">{error}</p>
        <button
          onClick={loadPipeline}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  const totalOpps = opportunities.length;
  const activeOpps = opportunities.filter(o => !['won', 'lost'].includes(o.stage)).length;

  return (
    <div className="bg-surface rounded-xl border border-hairline shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 p-5 border-b border-hairline">
        <div>
          <h2 className="text-xl font-bold text-white">My Pursuits</h2>
          <p className="text-sm text-muted mt-0.5">
            <span className="text-white font-semibold">{totalOpps.toLocaleString()}</span>{' '}
            {totalOpps === 1 ? 'pursuit' : 'pursuits'}
            {activeOpps > 0 && <> · <span className="text-white font-semibold">{activeOpps.toLocaleString()}</span> active</>}
            {watchlist.length > 0 && <> · <span className="text-white font-semibold">{watchlist.length.toLocaleString()}</span> watching</>}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingItem(null);
            setIsModalOpen(true);
          }}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm"
        >
          <span className="text-lg leading-none">＋</span>
          Add pursuit
        </button>
      </div>

      {totalOpps === 0 ? (
        // Empty State
        <div className="text-center py-16 px-6">
          <div className="w-16 h-16 bg-input rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">No pursuits yet</h3>
          <p className="text-muted mb-6 max-w-md mx-auto">
            Track opportunities from the map, then work them here — from watching through to a win.
          </p>
          <button
            onClick={() => { setEditingItem(null); setIsModalOpen(true); }}
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold transition-colors"
          >
            Add your first pursuit
          </button>
        </div>
      ) : (
        <>
          {/* Funnel overview strip */}
          <div className="flex gap-2 px-5 pt-4 pb-1 overflow-x-auto">
            {STAGES.map((stage) => {
              const n = (groupedByStage[stage.key] || []).length;
              return (
                <div key={stage.key} className="flex-1 min-w-[92px] border border-hairline rounded-lg bg-ground px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-faint">
                    <span className="w-2 h-2 rounded-full" style={{ background: stage.dot }} />
                    {stage.key === 'tracking' ? 'Watching' : stage.label}
                  </div>
                  <div className="text-xl font-extrabold text-white mt-1">{n.toLocaleString()}</div>
                </div>
              );
            })}
          </div>

          {/* Rail (watchlist) + active funnel */}
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] border-t border-hairline mt-3">
            {/* WATCHLIST RAIL */}
            <div className="border-b lg:border-b-0 lg:border-r border-hairline bg-ground">
              <div className="flex items-center justify-between px-4 pt-3 pb-2 text-[11px] font-bold uppercase tracking-wide text-faint">
                <span>Watchlist · {watchlist.length.toLocaleString()}</span>
              </div>
              {watchlist.length > 8 && (
                <input
                  value={watchQuery}
                  onChange={(e) => setWatchQuery(e.target.value)}
                  placeholder="Search your tracked pursuits…"
                  className="mx-4 mb-2 w-[calc(100%-2rem)] bg-surface border border-hairline rounded-lg px-3 py-2 text-xs text-ink-soft placeholder-faint focus:border-emerald-500/60 outline-none"
                />
              )}
              <div className="max-h-[520px] overflow-y-auto">
                {filteredWatchlist.length === 0 ? (
                  <div className="text-center py-8 text-faint text-xs">
                    {watchQuery ? 'No matches in your watchlist.' : 'Nothing tracked yet.'}
                  </div>
                ) : (
                  filteredWatchlist.slice(0, 200).map((opp) => (
                    <button
                      key={opp.id}
                      onClick={() => handleEdit(opp.id)}
                      className="w-full text-left flex gap-2.5 items-start px-4 py-2.5 border-t border-hairline/60 hover:bg-surface transition-colors"
                    >
                      <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-none" style={{ background: '#64788c' }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-ink-soft leading-snug line-clamp-2">{opp.title}</span>
                        <span className="block text-[10.5px] text-faint mt-0.5 line-clamp-1">
                          {[opp.agency, opp.value_estimate].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {(opp.priority === 'critical' || opp.priority === 'high') && (
                        <span className={`self-center text-[8.5px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${opp.priority === 'critical' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
                          {opp.priority.toUpperCase()}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
              {filteredWatchlist.length > 200 && (
                <div className="px-4 py-2 text-[10.5px] text-faint text-center">Showing 200 of {filteredWatchlist.length.toLocaleString()} — search to narrow.</div>
              )}
            </div>

            {/* ACTIVE FUNNEL LANES */}
            <div className="p-3 overflow-x-auto">
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${ACTIVE_STAGES.length}, minmax(180px, 1fr))`, minWidth: `${ACTIVE_STAGES.length * 190}px` }}>
                {ACTIVE_STAGES.map((stage) => {
                  const stageOpps = groupedByStage[stage.key] || [];
                  return (
                    <div key={stage.key} className="flex flex-col">
                      <div className="flex items-center gap-1.5 px-1 pt-1 pb-2 text-[11px] font-bold uppercase tracking-wide text-muted">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: stage.dot }} />
                        {stage.label}
                        <span className="ml-auto text-[10px] text-faint bg-ground border border-hairline px-1.5 py-0.5 rounded-full">{stageOpps.length}</span>
                      </div>
                      <div className="flex-1 bg-ground border border-hairline rounded-lg p-2 space-y-2 min-h-[210px] max-h-[560px] overflow-y-auto">
                        {stageOpps.length === 0 ? (
                          <div className="text-center py-8 text-faint text-[11px]">
                            {stage.key === 'no_bid' ? 'Pursuits you passed on.' : 'No items'}
                          </div>
                        ) : (
                          stageOpps.map((opp) => (
                            <PipelineCard
                              key={opp.id}
                              item={opp}
                              accent={stage.dot}
                              currentUserEmail={email}
                              onStageChange={handleStageChange}
                              onEdit={handleEdit}
                              onDelete={handleDelete}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal */}
      <PipelineModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingItem(null);
        }}
        onSave={handleSave}
        initialData={editingItem ? {
          id: editingItem.id,
          title: editingItem.title,
          agency: editingItem.agency,
          value_estimate: editingItem.value_estimate,
          naics_code: editingItem.naics_code,
          set_aside: editingItem.set_aside,
          response_deadline: editingItem.response_deadline,
          priority: editingItem.priority as any,
          win_probability: editingItem.win_probability,
          notes: editingItem.notes,
          source: editingItem.source,
          external_url: editingItem.external_url,
          teaming_partners: Array.isArray(editingItem.teaming_partners)
            ? editingItem.teaming_partners.join(', ')
            : editingItem.teaming_partners,
          stage: editingItem.stage
        } : null}
        email={email}
      />
    </div>
  );
}

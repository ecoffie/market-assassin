'use client';

import { useState } from 'react';

export interface PipelineCardProps {
  item: {
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
    owner_email?: string;
    next_action?: string;
    next_action_date?: string;
  };
  currentUserEmail?: string;
  /** Hex accent for the card's left border (the lane's stage color). */
  accent?: string;
  onStageChange: (id: string, newStage: string) => void;
  onEdit: (id: string) => void;
  onDelete?: (id: string) => void;
}

const STAGES = ['tracking', 'pursuing', 'bidding', 'submitted', 'won', 'no_bid', 'lost'];

export default function PipelineCard({ item, accent, currentUserEmail, onStageChange, onEdit, onDelete }: PipelineCardProps) {
  const isTeamItem = item.owner_email && item.owner_email !== currentUserEmail;
  const [showActions, setShowActions] = useState(false);

  // Calculate urgency based on deadline. Returns a dark-theme pill spec, or null
  // when there's no deadline (most rows) — the card then simply omits it.
  const getUrgency = () => {
    if (!item.response_deadline) return null;

    const deadline = new Date(item.response_deadline);
    const now = new Date();
    const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) return { label: 'OVERDUE', color: 'bg-red-600 text-white', highlight: true };
    if (daysUntil <= 3) return { label: `${daysUntil}d left`, color: 'bg-red-500 text-white', highlight: true };
    if (daysUntil <= 7) return { label: `${daysUntil} days`, color: 'bg-orange-500/90 text-white' };
    if (daysUntil <= 14) return { label: `${daysUntil} days`, color: 'bg-amber-500/90 text-slate-900' };
    return { label: `${daysUntil} days`, color: 'bg-input text-muted' };
  };

  const urgency = getUrgency();
  const currentStageIndex = STAGES.indexOf(item.stage);
  const canMoveForward = currentStageIndex < STAGES.length - 1 && !['won', 'no_bid', 'lost'].includes(item.stage);
  const canMoveBack = currentStageIndex > 0 && !['won', 'no_bid', 'lost'].includes(item.stage);

  // Priority pill (dark). Only 'critical'/'high' are loud; medium/low stay quiet
  // so a wall of MED badges doesn't shout (94% of rows are medium).
  const priorityPill: Record<string, string> = {
    critical: 'bg-red-500/15 text-red-400',
    high: 'bg-amber-500/15 text-amber-400',
    medium: 'bg-input text-faint',
    low: 'bg-input text-faint',
  };

  return (
    <div
      className={`bg-surface rounded-lg p-3 border border-hairline border-l-[3px] shadow-sm hover:border-slate-500/60 transition-all cursor-pointer ${
        urgency?.highlight ? 'ring-1 ring-red-500/40' : ''
      }`}
      style={{ borderLeftColor: accent || '#64788c' }}
      onClick={() => onEdit(item.id)}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Header with Priority Badge */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold text-ink-soft text-xs leading-snug line-clamp-2 flex-1">
          {item.title}
        </h3>
        {item.priority && (
          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${priorityPill[item.priority] || priorityPill.medium}`}>
            {item.priority.toUpperCase()}
          </span>
        )}
      </div>

      {/* Agency */}
      {item.agency && (
        <p className="text-[10.5px] text-faint mt-1 line-clamp-1">{item.agency}</p>
      )}

      {/* Value + deadline row (both optional — omitted when null, no empty "$—") */}
      {(item.value_estimate || (item.response_deadline && urgency)) && (
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {item.value_estimate && (
            <span className="text-xs font-extrabold text-emerald-400">{item.value_estimate}</span>
          )}
          {item.response_deadline && urgency && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${urgency.color}`}>
              {urgency.highlight && '🔥 '}{urgency.label}
            </span>
          )}
        </div>
      )}

      {/* Win Probability (only when a real value) */}
      {item.win_probability !== undefined && item.win_probability > 0 && (
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 bg-input rounded-full h-1.5 overflow-hidden">
            <div className="bg-emerald-500 h-full" style={{ width: `${item.win_probability}%` }} />
          </div>
          <span className="text-[10px] text-faint font-medium">{item.win_probability}%</span>
        </div>
      )}

      {/* Next Action */}
      {item.next_action && (
        <div className="text-[10px] text-emerald-400 font-semibold mt-2 flex items-center gap-1">
          <span>→</span>
          <span className="line-clamp-1">{item.next_action.replace(/_/g, ' ')}</span>
        </div>
      )}

      {/* Owner (for team items) */}
      {isTeamItem && item.owner_email && (
        <div className="mt-2">
          <span className="text-[9px] bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded">
            👤 {item.owner_email.split('@')[0]}
          </span>
        </div>
      )}

      {/* Stage Navigation (show on hover) */}
      {showActions && (canMoveBack || canMoveForward || onDelete) && (
        <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-hairline" onClick={(e) => e.stopPropagation()}>
          {canMoveBack && (
            <button
              onClick={(e) => { e.stopPropagation(); onStageChange(item.id, STAGES[currentStageIndex - 1]); }}
              className="flex-1 px-2 py-1 bg-input hover:bg-surface-2 text-muted text-[10px] rounded font-medium transition-colors"
              title={`Move to ${STAGES[currentStageIndex - 1]}`}
            >
              ← Prev
            </button>
          )}
          {canMoveForward && (
            <button
              onClick={(e) => { e.stopPropagation(); onStageChange(item.id, STAGES[currentStageIndex + 1]); }}
              className="flex-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] rounded font-medium transition-colors"
              title={`Move to ${STAGES[currentStageIndex + 1]}`}
            >
              Next →
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm('Remove this pursuit from your list?')) onDelete(item.id);
              }}
              className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] rounded font-medium transition-colors"
              title="Delete"
            >
              🗑
            </button>
          )}
        </div>
      )}
    </div>
  );
}

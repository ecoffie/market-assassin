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
  };
  onStageChange: (id: string, newStage: string) => void;
  onEdit: (id: string) => void;
  onDelete?: (id: string) => void;
}

const STAGES = ['tracking', 'pursuing', 'bidding', 'submitted', 'won', 'lost'];

export default function PipelineCard({ item, onStageChange, onEdit, onDelete }: PipelineCardProps) {
  const [showActions, setShowActions] = useState(false);

  // Calculate urgency based on deadline
  const getUrgency = () => {
    if (!item.response_deadline) return null;

    const deadline = new Date(item.response_deadline);
    const now = new Date();
    const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) return { label: 'OVERDUE', color: 'bg-red-600', textColor: 'text-white' };
    if (daysUntil <= 3) return { label: `${daysUntil} DAYS LEFT`, color: 'bg-red-500', textColor: 'text-white', highlight: true };
    if (daysUntil <= 7) return { label: `${daysUntil} days`, color: 'bg-orange-500', textColor: 'text-white' };
    if (daysUntil <= 14) return { label: `${daysUntil} days`, color: 'bg-yellow-500', textColor: 'text-gray-900' };
    return { label: `${daysUntil} days`, color: 'bg-gray-200', textColor: 'text-gray-700' };
  };

  const urgency = getUrgency();
  const currentStageIndex = STAGES.indexOf(item.stage);
  const canMoveForward = currentStageIndex < STAGES.length - 1 && !['won', 'lost'].includes(item.stage);
  const canMoveBack = currentStageIndex > 0 && !['won', 'lost'].includes(item.stage);

  // Priority colors
  const priorityColors: Record<string, string> = {
    critical: 'bg-red-100 text-red-800 border-red-300',
    high: 'bg-red-50 text-red-700 border-red-200',
    medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    low: 'bg-gray-50 text-gray-600 border-gray-200'
  };

  const priorityColor = priorityColors[item.priority || 'medium'];

  return (
    <div
      className={`bg-white border-2 rounded-lg p-4 shadow-sm hover:shadow-md transition-all cursor-pointer ${
        urgency?.highlight ? 'border-red-500 bg-red-50' : 'border-gray-200'
      }`}
      onClick={() => onEdit(item.id)}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Header with Priority Badge */}
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-2 flex-1">
          {item.title}
        </h3>
        {item.priority && (
          <span className={`text-xs px-2 py-0.5 rounded border ml-2 whitespace-nowrap ${priorityColor}`}>
            {item.priority.toUpperCase()}
          </span>
        )}
      </div>

      {/* Agency */}
      {item.agency && (
        <p className="text-xs text-gray-600 mb-2 line-clamp-1">
          {item.agency}
        </p>
      )}

      {/* Value Estimate */}
      {item.value_estimate && (
        <p className="text-sm font-bold text-blue-600 mb-2">
          {item.value_estimate}
        </p>
      )}

      {/* Deadline with Urgency */}
      {item.response_deadline && urgency && (
        <div className="mb-2">
          <span className={`text-xs px-2 py-1 rounded ${urgency.color} ${urgency.textColor} font-semibold`}>
            {urgency.highlight && '🔥 '}
            {urgency.label}
          </span>
        </div>
      )}

      {/* Win Probability */}
      {item.win_probability !== undefined && item.win_probability > 0 && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-green-500 h-full transition-all"
                style={{ width: `${item.win_probability}%` }}
              />
            </div>
            <span className="text-xs text-gray-600 font-medium">{item.win_probability}%</span>
          </div>
        </div>
      )}

      {/* Source Badge */}
      {item.source && item.source !== 'manual' && (
        <div className="text-xs text-gray-500 mb-2">
          <span className="bg-gray-100 px-2 py-0.5 rounded">
            {item.source === 'sam.gov' ? 'SAM.gov' : item.source}
          </span>
        </div>
      )}

      {/* Stage Navigation (show on hover) */}
      {showActions && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200" onClick={(e) => e.stopPropagation()}>
          {canMoveBack && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStageChange(item.id, STAGES[currentStageIndex - 1]);
              }}
              className="flex-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded font-medium transition-colors"
              title={`Move to ${STAGES[currentStageIndex - 1]}`}
            >
              ← Prev
            </button>
          )}
          {canMoveForward && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStageChange(item.id, STAGES[currentStageIndex + 1]);
              }}
              className="flex-1 px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded font-medium transition-colors"
              title={`Move to ${STAGES[currentStageIndex + 1]}`}
            >
              Next →
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm('Remove this opportunity from your pipeline?')) {
                  onDelete(item.id);
                }
              }}
              className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 text-xs rounded font-medium transition-colors"
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

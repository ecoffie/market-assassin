'use client';

import { useState } from 'react';

interface SaveToPipelineButtonProps {
  opportunity: {
    title: string;
    noticeId?: string;
    solicitationNumber?: string;
    agency?: string;
    naicsCode?: string;
    setAside?: string;
    deadline?: string;
    samLink?: string;
    valueEstimate?: string;
    source?: string;
  };
  email: string;
  variant?: 'default' | 'small';
}

export function SaveToPipelineButton({
  opportunity,
  email,
  variant = 'default',
}: SaveToPipelineButtonProps) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'exists' | 'error'>('idle');
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [nextActionStatus, setNextActionStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  const trackNextAction = (nextAction: string) => {
    if (!email || !email.includes('@')) return;

    fetch('/api/mi-beta/engagement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        eventType: 'tool_use',
        eventSource: 'market_intelligence',
        metadata: {
          action: 'pipeline_next_action',
          nextAction,
          panel: 'pipeline',
          area: 'pipeline',
          noticeId: opportunity.noticeId || opportunity.solicitationNumber,
          title: opportunity.title,
          agency: opportunity.agency,
        },
      }),
      keepalive: true,
    }).catch(() => {});
  };

  const handleSave = async () => {
    if (status === 'saving' || status === 'saved' || status === 'exists') return;

    setStatus('saving');

    try {
      const response = await fetch('/api/actions/add-to-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          notice_id: opportunity.noticeId || opportunity.solicitationNumber,
          title: opportunity.title,
          agency: opportunity.agency,
          naics: opportunity.naicsCode,
          setAside: opportunity.setAside,
          deadline: opportunity.deadline,
          value: opportunity.valueEstimate,
          externalUrl: opportunity.samLink,
          source: opportunity.source || 'briefings_dashboard',
          stage: 'tracking',
        }),
      });

      const data = await response.json();

      if (data.success) {
        setPipelineId(data.pipelineId || null);
        setStatus('saved');
      } else if (data.error === 'Already in pipeline') {
        setPipelineId(data.pipelineId || null);
        setStatus('exists');
      } else {
        console.error('Save to pipeline error:', data.error);
        setStatus('error');
        // Reset after 2 seconds
        setTimeout(() => setStatus('idle'), 2000);
      }
    } catch (err) {
      console.error('Save to pipeline error:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  const handleNextAction = async (
    nextAction: string,
    options: { stage?: 'tracking' | 'pursuing'; notes?: string } = {}
  ) => {
    if (!pipelineId || nextActionStatus === 'saving') return;

    setSelectedAction(nextAction);
    setNextActionStatus('saving');

    try {
      const response = await fetch('/api/actions/add-to-pipeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          pipelineId,
          nextAction,
          stage: options.stage,
          notes: options.notes,
        }),
      });
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Could not save next action');
      }

      trackNextAction(nextAction);
      setNextActionStatus('saved');
    } catch (err) {
      console.error('Next action error:', err);
      setNextActionStatus('error');
    }
  };

  const baseClasses = variant === 'small'
    ? 'text-xs px-2 py-1 rounded-md font-medium transition-colors flex items-center gap-1'
    : 'text-sm px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5';

  if (status === 'saved') {
    return (
      <div className="relative">
        <span className={`${baseClasses} bg-green-500/20 text-green-400 cursor-default`}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Saved
        </span>
        {pipelineId && nextActionStatus !== 'saved' && (
          <NextActionPrompt
            status={nextActionStatus}
            selectedAction={selectedAction}
            onSelect={handleNextAction}
          />
        )}
        {nextActionStatus === 'saved' && (
          <p className="mt-2 text-xs text-green-300">Next action saved.</p>
        )}
      </div>
    );
  }

  if (status === 'exists') {
    return (
      <div className="relative">
        <span className={`${baseClasses} bg-blue-500/20 text-blue-400 cursor-default`}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          In Pipeline
        </span>
        {pipelineId && nextActionStatus !== 'saved' && (
          <NextActionPrompt
            status={nextActionStatus}
            selectedAction={selectedAction}
            onSelect={handleNextAction}
          />
        )}
        {nextActionStatus === 'saved' && (
          <p className="mt-2 text-xs text-green-300">Next action saved.</p>
        )}
      </div>
    );
  }

  if (status === 'saving') {
    return (
      <span className={`${baseClasses} bg-purple-500/20 text-purple-400 cursor-wait`}>
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Saving...
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span className={`${baseClasses} bg-red-500/20 text-red-400 cursor-default`}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
        Failed
      </span>
    );
  }

  return (
    <button
      onClick={handleSave}
      className={`${baseClasses} bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 hover:text-purple-300`}
      title="Save to BD Assist Pipeline"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      Track
    </button>
  );
}

function NextActionPrompt({
  status,
  selectedAction,
  onSelect,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error';
  selectedAction: string | null;
  onSelect: (
    nextAction: string,
    options?: { stage?: 'tracking' | 'pursuing'; notes?: string }
  ) => void;
}) {
  const actions = [
    {
      label: 'Track only',
      value: 'track_only',
      options: { stage: 'tracking' as const },
    },
    {
      label: 'Research agency',
      value: 'research_agency_incumbent',
      options: { stage: 'tracking' as const },
    },
    {
      label: 'Find partners',
      value: 'find_teaming_partners',
      options: { stage: 'pursuing' as const },
    },
    {
      label: 'Pursuit brief',
      value: 'request_pursuit_brief',
      options: { stage: 'pursuing' as const },
    },
    {
      label: 'Move to capture',
      value: 'move_to_capture',
      options: { stage: 'pursuing' as const },
    },
    {
      label: 'Ask GCG for help',
      value: 'white_glove_help',
      options: {
        stage: 'pursuing' as const,
        notes: 'Customer requested GovCon Giants help from MI next-action prompt.',
      },
    },
  ];

  return (
    <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-purple-500/30 bg-gray-950 p-3 shadow-2xl shadow-black/50">
      <p className="text-xs font-semibold uppercase tracking-wide text-purple-300">Next action</p>
      <p className="mt-1 text-xs leading-5 text-gray-400">
        What do you want to do with this opportunity?
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {actions.map((action) => {
          const isSelected = selectedAction === action.value;
          const isSaving = status === 'saving' && isSelected;

          return (
            <button
              key={action.value}
              type="button"
              disabled={status === 'saving'}
              onClick={() => onSelect(action.value, action.options)}
              className="rounded-md border border-gray-700 bg-gray-900 px-2 py-2 text-left text-xs font-medium text-gray-200 transition-colors hover:border-purple-500/70 hover:bg-purple-950/30 disabled:cursor-wait disabled:opacity-70"
            >
              {isSaving ? 'Saving...' : action.label}
            </button>
          );
        })}
      </div>
      {status === 'error' && (
        <p className="mt-2 text-xs text-red-300">Could not save. Try again.</p>
      )}
    </div>
  );
}

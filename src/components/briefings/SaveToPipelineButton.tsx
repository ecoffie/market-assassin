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
          externalUrl: opportunity.samLink,
          source: 'briefings_dashboard',
          stage: 'tracking',
        }),
      });

      const data = await response.json();

      if (data.success) {
        setStatus('saved');
      } else if (data.error === 'Already in pipeline') {
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

  const baseClasses = variant === 'small'
    ? 'text-xs px-2 py-1 rounded-md font-medium transition-colors flex items-center gap-1'
    : 'text-sm px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5';

  if (status === 'saved') {
    return (
      <span className={`${baseClasses} bg-green-500/20 text-green-400 cursor-default`}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Saved
      </span>
    );
  }

  if (status === 'exists') {
    return (
      <span className={`${baseClasses} bg-blue-500/20 text-blue-400 cursor-default`}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        In Pipeline
      </span>
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

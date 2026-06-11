'use client';

import { useState } from 'react';

const COLLAPSE_AT_CHARS = 280;

interface CollapsibleOpportunityDescriptionProps {
  text?: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onLoad?: () => void;
  /** True when SAM has a description URL but text is not loaded yet. */
  pendingRemote?: boolean;
  className?: string;
}

export default function CollapsibleOpportunityDescription({
  text,
  loading = false,
  error = null,
  onRetry,
  onLoad,
  pendingRemote = false,
  className = '',
}: CollapsibleOpportunityDescriptionProps) {
  const [expanded, setExpanded] = useState(false);
  const content = (text || '').trim();
  const isLong = content.length > COLLAPSE_AT_CHARS;
  const showCollapsed = isLong && !expanded;

  if (pendingRemote && !content && !loading && !error) {
    return (
      <div className={`rounded-lg border border-dashed border-gray-700 bg-gray-950/30 p-3 ${className}`}>
        <p className="text-xs text-gray-500 uppercase tracking-wide">SAM synopsis</p>
        <p className="mt-1 text-sm text-gray-400">
          Scope narrative from SAM.gov — collapsed by default so documents stay on top.
        </p>
        {onLoad && (
          <button
            type="button"
            onClick={onLoad}
            className="mt-2 text-xs font-medium text-purple-300 hover:text-purple-200"
          >
            Load synopsis from SAM.gov
          </button>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`rounded-lg border border-gray-800 bg-gray-950/40 p-3 ${className}`}>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">SAM synopsis</p>
        <p className="text-sm text-gray-500 flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          Loading from SAM.gov…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-lg border border-gray-800 bg-gray-950/40 p-3 ${className}`}>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">SAM synopsis</p>
        <p className="text-xs text-red-400">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-xs text-purple-300 hover:text-purple-200 underline"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!content) return null;

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-gray-500 text-xs uppercase tracking-wide">SAM synopsis</span>
        {isLong && (
          <span className="text-[10px] text-gray-600">
            {showCollapsed ? 'Preview — expand for full text' : `${content.length.toLocaleString()} chars`}
          </span>
        )}
      </div>
      <div
        className={`relative rounded-lg border border-gray-800 bg-gray-950/40 ${
          showCollapsed ? 'max-h-28 overflow-hidden' : ''
        }`}
      >
        <p className="text-gray-300 text-sm p-3 whitespace-pre-wrap leading-relaxed">{content}</p>
        {showCollapsed && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-gray-950 via-gray-950/90 to-transparent"
            aria-hidden
          />
        )}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-purple-300 hover:text-purple-200"
        >
          {expanded ? '▲ Collapse synopsis' : '▼ Expand full synopsis'}
        </button>
      )}
    </div>
  );
}

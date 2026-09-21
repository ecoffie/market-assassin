/**
 * NaicsBadge / NaicsBadgeList — inline display of NAICS codes with
 * descriptions pulled from the local cache (src/lib/codes/lookup).
 *
 * Two variants:
 *   <NaicsBadge code="541611" />
 *     → "541611" pill with description in tooltip
 *
 *   <NaicsBadgeList codes={['541611', '611430', '813410']} />
 *     → row of pills, each tooltipped, with optional inline description.
 *
 * Replaces hand-rolled NAICS displays scattered across the app. Tiny
 * surface area so it can drop into alerts, pipeline, vault, etc.
 */

'use client';

import { getNaics } from '@/lib/codes/lookup';

interface NaicsBadgeProps {
  code: string;
  /** Show description inline next to the code instead of just on hover */
  inline?: boolean;
  /** Override truncation length of inline description (default 50 chars) */
  inlineTruncate?: number;
  /** Tighter compact style (smaller padding/font) */
  size?: 'sm' | 'md';
  className?: string;
}

export function NaicsBadge({ code, inline, inlineTruncate = 50, size = 'md', className = '' }: NaicsBadgeProps) {
  const entry = getNaics(code);
  const title = entry?.title || '';
  const sizeClasses = size === 'sm'
    ? 'text-xs px-1.5 py-0.5'
    : 'text-xs px-2 py-1';

  if (inline && title) {
    const display = title.length > inlineTruncate ? title.slice(0, inlineTruncate) + '…' : title;
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded bg-slate-800 text-slate-300 ${sizeClasses} ${className}`}
        title={title.length > inlineTruncate ? title : undefined}
      >
        <span className="font-mono text-slate-400">{code}</span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-200">{display}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-block rounded bg-slate-800 text-slate-300 font-mono ${sizeClasses} ${className}`}
      title={title || code}
    >
      {code}
    </span>
  );
}

interface NaicsBadgeListProps {
  codes: (string | null | undefined)[];
  /** Max visible badges (default 6, '+N more' shown for overflow) */
  max?: number;
  inline?: boolean;
  inlineTruncate?: number;
  size?: 'sm' | 'md';
}

export function NaicsBadgeList({ codes, max = 6, inline, inlineTruncate = 50, size = 'md' }: NaicsBadgeListProps) {
  const clean = codes.filter((c): c is string => typeof c === 'string' && !!c.trim());
  if (clean.length === 0) return null;

  const visible = clean.slice(0, max);
  const overflow = clean.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {visible.map(code => (
        <NaicsBadge key={code} code={code} inline={inline} inlineTruncate={inlineTruncate} size={size} />
      ))}
      {overflow > 0 && (
        <span
          className={`inline-block rounded bg-slate-700 text-slate-400 ${size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-xs px-2 py-1'}`}
          title={clean.slice(max).join(', ')}
        >
          +{overflow} more
        </span>
      )}
    </div>
  );
}

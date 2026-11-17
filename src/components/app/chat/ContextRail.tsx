'use client';
import type { ReactNode } from 'react';
import { Target, X } from 'lucide-react';

/**
 * Building blocks for a chat's right-hand context rail ("what Mindy is looking at"), extracted from
 * Proposal Assist's Files rail (approved plan, step 5, 2026-11-16). The SELECTED OPPORTUNITY comes first;
 * other sections follow. Display only: nothing here reads documents or calls an endpoint. A Vault document
 * picker will be added once the strong-auth, owner-checked document read path exists.
 */

export interface SelectedOpportunity {
  title: string;
  agency?: string | null;
  deadline?: string | null;
  noticeId?: string | null;
}

/** One titled rail section with an optional header action and hint line. */
export function RailSection({ title, action, hint, children }: { title: string; action?: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div>
      {action ? (
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
          {action}
        </div>
      ) : (
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">{title}</h3>
      )}
      {hint && <p className="text-[11px] text-faint mb-2">{hint}</p>}
      {children}
    </div>
  );
}

/** A row in a rail list (a file, the Vault, a corpus), with an optional remove control. */
export function ContextItem({ icon, label, note, title, onRemove, removeLabel = 'Remove from context', tone = 'item' }: {
  icon?: ReactNode; label: ReactNode; note?: ReactNode; title?: string;
  onRemove?: () => void; removeLabel?: string; tone?: 'item' | 'source';
}) {
  if (tone === 'source') {
    return (
      <div className="flex items-center gap-2 rounded bg-surface/40 px-2 py-1.5 text-xs text-muted">
        {icon} {label} {note && <span className="text-[10px] text-slate-600">{note}</span>}
      </div>
    );
  }
  return (
    <div className="group flex items-center justify-between gap-2 rounded bg-surface/60 px-2 py-1.5 text-xs">
      <span className="inline-flex min-w-0 items-center gap-1 truncate text-ink-soft" title={title}>{icon} {label}</span>
      {onRemove && (
        <button onClick={onRemove} className="inline-flex shrink-0 items-center text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100" title={removeLabel} aria-label={removeLabel}>
          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

function shortDate(d?: string | null): string {
  if (!d) return '';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
}

/** The opportunity this conversation is about. Always the rail's first section when present. */
export function SelectedOpportunityCard({ opportunity, action, onRemove }: { opportunity: SelectedOpportunity; action?: ReactNode; onRemove?: () => void }) {
  const due = shortDate(opportunity.deadline);
  return (
    <RailSection title="Selected opportunity">
      <div data-testid="selected-opportunity" className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2">
        <div className="flex items-start gap-2">
          <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-300" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-snug text-white line-clamp-2" title={opportunity.title}>{opportunity.title || 'This opportunity'}</div>
            {(opportunity.agency || due) && (
              <div className="mt-0.5 text-[11px] text-faint truncate">
                {[opportunity.agency, due && `due ${due}`].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          {onRemove && (
            <button onClick={onRemove} className="shrink-0 text-faint hover:text-white" aria-label="Remove this opportunity from the conversation">
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </RailSection>
  );
}

/** The rail body: the selected opportunity first, then the surface's own sections. */
export default function ContextRail({ opportunity, opportunityAction, onRemoveOpportunity, children }: {
  opportunity?: SelectedOpportunity | null; opportunityAction?: ReactNode; onRemoveOpportunity?: () => void; children?: ReactNode;
}) {
  return (
    <>
      {opportunity && <SelectedOpportunityCard opportunity={opportunity} action={opportunityAction} onRemove={onRemoveOpportunity} />}
      {children}
    </>
  );
}

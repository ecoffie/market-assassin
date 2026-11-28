'use client';

/**
 * The card under an Ask Mindy answer that proposes going somewhere in the app ("Open My Documents"). It never
 * navigates by itself: leaving the chat mid-answer would hide the answer, so the customer clicks. The destination
 * keeps its own lock, decided by the same check the sidebar uses (nav-groups clickActionFor).
 */
import { ArrowRight, Lock } from 'lucide-react';
import { clickActionFor } from '@/components/app/nav-groups';
import type { AppPanel, AppTier } from '@/components/app/UnifiedSidebar';
import type { NavAction } from '@/lib/app/nav-destinations';

export function NavActionCard({
  action,
  tier,
  onPanelChange,
}: {
  action: NavAction;
  tier: AppTier;
  onPanelChange?: (panel: AppPanel, context?: Record<string, unknown>) => void;
}) {
  const { target } = action;
  if (!onPanelChange) return null;
  const access = clickActionFor(target.panel, { userTier: tier });
  if (access === 'upgrade') {
    return (
      <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-hairline bg-surface/60 px-3 py-2 text-[12px] text-ink-soft" data-testid="nav-action-locked">
        <Lock className="h-3.5 w-3.5" strokeWidth={2} /> {target.label} needs a paid plan.
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onPanelChange(target.panel, target.context ? { ...target.context } : undefined)}
      className="mt-2 inline-flex items-center gap-2 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-[12px] font-medium text-purple-200 hover:bg-purple-500/20"
      data-testid="nav-action"
      data-destination={action.destination}
    >
      Open {target.label} <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  );
}

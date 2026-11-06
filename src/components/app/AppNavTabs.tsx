'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { AppPanel, AppTier } from './UnifiedSidebar';
import { UpgradeModal } from './UpgradeModal';
import { useAppTracker } from './track';
import {
  type NavAccessContext,
  canAccessPanel,
  clickActionFor,
  groupForPanel,
  panelDef,
  visibleMembers,
} from './nav-groups';

/**
 * Tab bar across the top of the /app main area. Shows the active sidebar GROUP's pages as
 * tabs (nav-groups.ts) — only when that group has 2+ visible members.
 *
 * A tab click goes through the SAME `onPanelChange` the sidebar uses, so URL sync, analytics
 * and panelContext behave exactly as a sidebar click. Locked tabs keep the old per-panel
 * behaviour: free "data behind glass" preview where one exists, otherwise the upgrade modal.
 * Route-backed panels (Market Dashboard, KO Research Workspace) navigate to their route.
 *
 * Semantic token classes only (bg-surface / border-hairline / text-ink / text-muted …) — the
 * palette is themed centrally.
 */
export default function AppNavTabs({
  activePanel,
  onPanelChange,
  userTier,
  coachModeAllowed = false,
  canSeePrototypes = false,
  userEmail,
}: {
  activePanel: AppPanel;
  onPanelChange: (panel: AppPanel) => void;
  userTier: AppTier;
  coachModeAllowed?: boolean;
  canSeePrototypes?: boolean;
  userEmail?: string | null;
}) {
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);
  const track = useAppTracker(userEmail);
  const ctx: NavAccessContext = { userTier, coachModeAllowed, canSeePrototypes };

  const group = groupForPanel(activePanel);
  const members = group ? visibleMembers(group, ctx) : [];
  if (!group || members.length < 2) return null;

  const baseTab =
    'relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors';

  return (
    <>
      <nav
        aria-label={`${group.label} sections`}
        className="border-b border-hairline bg-ground-deep px-4 md:px-6"
      >
        <div role="tablist" className="flex items-end gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {members.map((m) => {
            const def = panelDef(m.panel);
            const isActive = activePanel === m.panel;
            const locked = !canAccessPanel(m.panel, ctx);
            const className = `${baseTab} ${
              isActive
                ? 'border-accent text-ink'
                : locked
                  ? 'border-transparent text-faint hover:text-muted'
                  : 'border-transparent text-muted hover:text-ink hover:border-hairline'
            }`;
            const content = (
              <>
                <span>{m.tab}</span>
                {def?.badge && (
                  <span className="px-1.5 py-0.5 text-[10px] leading-none rounded bg-surface text-accent">
                    {def.badge}
                  </span>
                )}
                {locked && <Lock className="w-3 h-3 shrink-0" strokeWidth={1.75} aria-label="Locked" />}
              </>
            );

            // Route-backed panel the user can open → a real link to that route.
            if (def?.href && !locked) {
              return (
                <Link
                  key={m.panel}
                  role="tab"
                  aria-selected={isActive}
                  data-tour={`nav-${m.panel}`}
                  href={def.href}
                  className={className}
                >
                  {content}
                </Link>
              );
            }

            return (
              <button
                key={m.panel}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-tour={`nav-${m.panel}`}
                title={def?.description}
                onClick={() => {
                  const action = clickActionFor(m.panel, ctx);
                  if (action === 'open') {
                    onPanelChange(m.panel);
                  } else if (action === 'free_preview') {
                    onPanelChange(m.panel);
                    track('link_click', 'sidebar', { action: 'free_preview_shown', feature: m.panel, tier: userTier, via: 'tab' });
                  } else {
                    setUpgradeFeature(m.panel);
                    track('link_click', 'sidebar', { action: 'upgrade_modal_shown', feature: m.panel, tier: userTier, via: 'tab' });
                  }
                }}
                className={className}
              >
                {content}
              </button>
            );
          })}
        </div>
      </nav>
      <UpgradeModal
        featureId={upgradeFeature}
        onClose={() => setUpgradeFeature(null)}
        onCtaClick={(plan) => track('link_click', 'sidebar', { action: 'upgrade_modal_cta_click', feature: upgradeFeature, plan, via: 'tab' })}
      />
    </>
  );
}

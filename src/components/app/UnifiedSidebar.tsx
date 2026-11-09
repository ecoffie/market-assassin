'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Map as MapIcon,
} from 'lucide-react';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import { UpgradeModal } from './UpgradeModal';
import { useAppTracker } from './track';
import { mapHomeLink } from '@/lib/maps/map-links';
import {
  NAV_GROUPS,
  type NavGroup,
  type NavAccessContext,
  clickActionFor,
  groupForPanel,
  groupSummary,
  isGroupLocked,
  isGroupVisible,
  panelDef,
  primaryMember,
  visibleMembers,
} from './nav-groups';

// Panel types for the unified MI platform
export type AppPanel =
  | 'chat'           // Mindy Chat - RAG-backed Q&A (v1, #117)
  | 'dashboard'      // AI Briefings - Daily/Weekly/Pursuit
  | 'my-market'      // Market Dossier — the one-shot assembled market
  | 'alerts'         // Daily Alerts - opportunity list
  | 'market-intel'   // /app/market-intel — full-bleed dashboard route (not a panel)
  | 'opportunity-map' // /opportunity-map — the map, a separate route (not a panel)
  | 'research'       // Market Research (Federal Market Assassin)
  | 'forecasts'      // 33,000+ upcoming procurements
  | 'recompetes'     // Expiring contracts
  | 'contractors'    // prime contractor database
  | 'decision-makers' // government contacts directory (federal_contacts)
  | 'pipeline'       // Track pursuits
  | 'contacts'       // Relationships
  | 'team'           // Team access and seats
  | 'settings'       // Unified account settings
  | 'vault'          // My Vault — persistent knowledge base (identity, past perf, capabilities, team, boilerplate)
  | 'library'        // My Library — searchable history of every AI output
  | 'knowledge-base' // Knowledge Base — searchable corpus Mindy Chat cites
  | 'coach'          // Coach Mode — manage multiple client businesses (org/consultant)
  | 'pricing'        // Pricing Intel — labor rates, GSA/SCA wages (Estimating section)
  | 'proposals'      // AI Proposal Assist (Estimating section)
  | 'target-list'    // My Target List — saved BD targets (Pipeline section, Slice 3 of TMR roadmap)
  | 'grants'         // Federal grants
  | 'partner-finder' // Semantic teaming-partner discovery over capability profiles
  | 'dibbs'          // DLA DIBBS small-buy RFQs (NSN/parts, not on SAM)
  | 'disa-watch'     // Vehicle Expiry Watch — DISA prototype (IDIQ/IDV expiry auto-notify)
  | 'osbp-smb'       // SMB Market Research — Navy OSBP prototype (certified small-biz sourcing)
  | 'micc-mrr';      // Market Research Report — ACC-Orlando prototype (auto-draft the MRR .docx)

// Tier definitions
export type AppTier = 'free' | 'pro' | 'team' | 'enterprise';

// The Opportunity Map — free for everyone, a real document navigation to the map route
// (served by a route handler, not a Next page, so never a client-side <Link> transition).
const OPPORTUNITY_MAP_LINK = {
  id: 'opportunity-map' as const,
  label: 'Opportunity Map',
  icon: MapIcon,
  description: 'Open, recompete and forecast on one map',
};

// Sidebar = one row per NAV GROUP (src/components/app/nav-groups.ts). Each group's old pages
// render as tabs across the top of the main area (AppNavTabs). History of the per-panel order
// (execution before discovery — Slack / Linear / Salesforce) is preserved in the group order.

interface UnifiedSidebarProps {
  activePanel: AppPanel;
  onPanelChange: (panel: AppPanel) => void;
  userTier: AppTier;
  /** Staff / grandfathered org members on Pro can use My Clients. */
  coachModeAllowed?: boolean;
  /** Internal team (govcongiants / getmindy / govconedu). Kept for any
   *  staff-only treatment; NO LONGER gates the prototype demo tabs. */
  isStaff?: boolean;
  /** On the MINDY_PROTOTYPE_EMAILS allowlist → may see the demo/case-study
   *  prototype tabs (Vehicle Expiry Watch, SMB Market Research, MRR). Defaults
   *  false so every account — incl. staff & demo accounts — gets the clean view. */
  canSeePrototypes?: boolean;
  userEmail?: string | null;
  currentWorkspaceId?: string | null;
  onWorkspaceChange?: (workspaceId: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  // Mobile drawer state. When isMobileOpen is true, the sidebar
  // slides in from the left over the content. When false, it's
  // hidden below md breakpoint. Desktop ignores this flag.
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function UnifiedSidebar({
  activePanel,
  onPanelChange,
  userTier,
  coachModeAllowed = false,
  isStaff = false,
  canSeePrototypes = false,
  userEmail,
  currentWorkspaceId,
  onWorkspaceChange,
  isCollapsed = false,
  onToggleCollapse,
  isMobileOpen = false,
  onMobileClose,
}: UnifiedSidebarProps) {
  // Bottom-of-sidebar account menu open state.
  // Free user clicked a Pro-locked feature → open the upgrade modal (highest-
  // intent conversion moment). Holds the clicked item id so the modal can name it.
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);
  const track = useAppTracker(userEmail);
  const router = useRouter();
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  // Collapsed-state tooltip rendered with position:fixed so the nav's
  // overflow-y-auto scroll clip can't eat it. Captured from the hovered
  // row's bounding rect on mouse-enter.
  const [tooltip, setTooltip] = useState<{ label: string; badge?: string; locked: boolean; top: number; left: number } | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function showTooltip(e: { currentTarget: HTMLElement }, label: string, badge: string | undefined, locked: boolean) {
    if (!isCollapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTooltip({ label, badge, locked, top: r.top + r.height / 2, left: r.right + 12 });
  }

  const navCtx: NavAccessContext = { userTier, coachModeAllowed, canSeePrototypes };
  const activeGroup = groupForPanel(activePanel);

  // A group row opens its first ACCESSIBLE member. When everything in the group is locked,
  // the first visible member gets the old per-panel locked behaviour: free users go to the
  // "data behind glass" preview where one exists, otherwise the upgrade modal opens.
  const handleGroupClick = (group: NavGroup) => {
    const member = primaryMember(group, navCtx);
    if (!member) return;
    const def = panelDef(member.panel);
    const action = clickActionFor(member.panel, navCtx);
    if (action === 'open') {
      if (def?.href) {
        router.push(def.href);
      } else {
        onPanelChange(member.panel);
      }
      // Auto-close the mobile drawer — the chosen panel should take focus.
      onMobileClose?.();
    } else if (action === 'free_preview') {
      onPanelChange(member.panel);
      onMobileClose?.();
      track('link_click', 'sidebar', { action: 'free_preview_shown', feature: member.panel, tier: userTier });
    } else {
      setUpgradeFeature(member.panel);
      track('link_click', 'sidebar', { action: 'upgrade_modal_shown', feature: member.panel, tier: userTier });
    }
  };

  const tierColors: Record<AppTier, string> = {
    free: 'text-gray-400',
    pro: 'text-emerald-400',
    team: 'text-blue-400',
    enterprise: 'text-purple-400',
  };

  const tierLabels: Record<AppTier, string> = {
    free: 'Free',
    pro: 'Pro',
    team: 'Team',
    enterprise: 'Enterprise',
  };

  return (
    <>
      {/* Mobile backdrop. Tap to close. Only when drawer is open. */}
      {isMobileOpen && (
        <div
          onClick={onMobileClose}
          className="md:hidden fixed inset-0 bg-black/60 z-40"
          aria-hidden="true"
        />
      )}
      <aside
        className={`
          bg-ground border-r border-surface flex flex-col
          h-screen h-dvh
          transition-transform duration-300 ease-in-out
          z-50
          fixed inset-y-0 left-0 w-64
          md:sticky md:top-0 md:translate-x-0
          ${isCollapsed ? 'md:w-16' : 'md:w-64'}
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
      {/* Header */}
      <div className="p-4 border-b border-surface">
        {isCollapsed ? (
          // Collapsed: the logo IS the expand control. Clicking it reopens the
          // sidebar — guarantees a reachable expand action in the narrow rail
          // (the old layout pushed the arrow off the 64px edge, leaving no way
          // to reopen). PanelLeftOpen hint shows on hover.
          <button
            onClick={onToggleCollapse}
            className="group relative w-full flex items-center justify-center hover:bg-surface rounded-lg py-1 transition-colors"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <MindyLogo size={32} />
            <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-hairline bg-ground px-2.5 py-1.5 text-xs font-medium text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
              Expand sidebar
            </span>
          </button>
        ) : (
          <div className="flex items-center justify-between">
            <Link href="/app" className="flex items-center gap-2">
              <MindyLogo size={32} />
              <div>
                <span className="font-semibold text-white text-sm">Mindy</span>
              </div>
            </Link>
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="p-1 hover:bg-surface rounded text-muted hover:text-white transition-colors"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                ←
              </button>
            )}
          </div>
        )}

        {/* Tier Badge */}
        {!isCollapsed && (
          <div className={`mt-3 text-xs ${tierColors[userTier]}`}>
            {tierLabels[userTier]} Plan
          </div>
        )}
      </div>

      {/* Workspace Switcher - only for team/enterprise tiers */}
      {(userTier === 'team' || userTier === 'enterprise') && userEmail && onWorkspaceChange && (
        <WorkspaceSwitcher
          email={userEmail}
          currentWorkspaceId={currentWorkspaceId || null}
          onWorkspaceChange={onWorkspaceChange}
          isCollapsed={isCollapsed}
        />
      )}

      {/* Navigation — ALWAYS overflow-y-auto so a long nav list scrolls and can
          never push the pinned Collapse footer off-screen. The collapsed-state
          hover tooltips would normally be clipped by this scroll container, so
          they render with position:FIXED (computed from the hovered icon's rect)
          — fixed elements escape a scrolling ancestor's clip. This gives us BOTH
          the footer AND the tooltips, instead of trading one for the other. */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <div className="space-y-1 px-2">
          {/* Opportunity Map — a real document navigation to the map route. */}
          {(() => {
            const MapItemIcon = OPPORTUNITY_MAP_LINK.icon;
            const isHovered = hoveredItem === OPPORTUNITY_MAP_LINK.id;
            return (
              <a
                data-tour={`nav-${OPPORTUNITY_MAP_LINK.id}`}
                href={mapHomeLink()}
                onClick={() => {
                  track('link_click', 'sidebar', { action: 'open_map', feature: OPPORTUNITY_MAP_LINK.id, tier: userTier });
                  onMobileClose?.();
                }}
                onMouseEnter={(e) => { setHoveredItem(OPPORTUNITY_MAP_LINK.id); showTooltip(e, OPPORTUNITY_MAP_LINK.label, undefined, false); }}
                onMouseLeave={() => { setHoveredItem(null); setTooltip(null); }}
                className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-ink-soft hover:bg-surface hover:text-white ${isCollapsed ? 'justify-center' : ''}`}
              >
                <MapItemIcon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                {!isCollapsed && (
                  <div className="flex-1 min-w-0 text-left">
                    <span className="text-sm font-medium">{OPPORTUNITY_MAP_LINK.label}</span>
                    {isHovered && (
                      <div className="text-xs text-faint mt-0.5 truncate">{OPPORTUNITY_MAP_LINK.description}</div>
                    )}
                  </div>
                )}
              </a>
            );
          })()}

          {NAV_GROUPS.filter((g) => isGroupVisible(g, navCtx)).map((group) => {
            const isActive = activeGroup?.id === group.id;
            const locked = isGroupLocked(group, navCtx);
            const isHovered = hoveredItem === group.id;
            const members = visibleMembers(group, navCtx);
            // A single-member group carries that panel's badge (e.g. Mindy Chat BETA).
            const badge = members.length === 1 ? panelDef(members[0].panel)?.badge : undefined;
            const summary = groupSummary(group, navCtx);
            const Icon = group.icon;
            return (
              <button
                key={group.id}
                // nav-group-<id> for the group row; a single-member group also keeps the old
                // per-panel hook (nav-research) the product tour spotlights. Multi-member
                // panels' nav-<panel> hooks now live on their TABS (AppNavTabs).
                data-tour={members.length === 1 ? `nav-${members[0].panel}` : `nav-group-${group.id}`}
                aria-current={isActive ? 'page' : undefined}
                title={!isCollapsed ? summary : undefined}
                onClick={() => handleGroupClick(group)}
                onMouseEnter={(e) => { setHoveredItem(group.id); showTooltip(e, group.label, badge, locked); }}
                onMouseLeave={() => { setHoveredItem(null); setTooltip(null); }}
                className={`
                  group relative
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                  transition-all duration-150
                  ${isActive
                    ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                    : !locked
                      ? 'text-ink-soft hover:bg-surface hover:text-white'
                      : 'text-faint hover:bg-purple-500/10 hover:text-purple-300 cursor-pointer'
                  }
                  ${isCollapsed ? 'justify-center' : ''}
                `}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                {!isCollapsed && (
                  <>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{group.label}</span>
                        {badge && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded">
                            {badge}
                          </span>
                        )}
                      </div>
                      {(isHovered || isActive) && summary && (
                        <div className="text-xs text-faint mt-0.5 truncate">{summary}</div>
                      )}
                    </div>
                    {locked && (
                      <Lock className="w-3 h-3 text-slate-600 shrink-0" strokeWidth={1.75} />
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Footer — shrink-0 so it never gets squeezed out by the scrolling nav;
          pb safe-area so the account menu clears the iOS home indicator. */}
      <div className="shrink-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-surface space-y-2">
        {!isCollapsed && userTier === 'free' && (
          <Link
            href="/market-intelligence"
            className="block w-full px-3 py-2 text-center text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
          >
            Upgrade to Pro
          </Link>
        )}
        {/* Settings and sign-out live in ONE place: the top-right account avatar (the same menu the
            map and every public page use). No sidebar Settings button, no bottom account menu
            (Eric, 2026-11-09: "one way to get to Settings"). */}
        {/* Collapse / expand control — pinned at the bottom of the sidebar
            (SaaS standard: Firecrawl, Gamma, Linear). The header arrow was
            easy to miss when collapsed, so surface an obvious, labeled toggle
            here that works in both states. */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className={`w-full flex items-center rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface hover:text-white transition-colors ${isCollapsed ? 'justify-center' : 'gap-2'}`}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed
              ? <PanelLeftOpen className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
              : <PanelLeftClose className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />}
            {!isCollapsed && <span>Collapse</span>}
          </button>
        )}
      </div>

      {/* Single fixed-position tooltip for the collapsed sidebar. position:fixed
          (vs absolute inside the scrolling nav) means the overflow-y-auto clip
          can't hide it — so we keep BOTH the scrollable nav (pinned Collapse
          footer) AND the hover labels. */}
      {isCollapsed && tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-md border border-hairline bg-ground px-2.5 py-1.5 text-xs font-medium text-white shadow-lg shadow-black/40"
          style={{ top: tooltip.top, left: tooltip.left }}
        >
          {tooltip.label}
          {tooltip.badge && <span className="ml-1.5 text-[10px] text-purple-300">{tooltip.badge}</span>}
          {tooltip.locked && <span className="ml-1.5 text-[10px] text-muted">🔒 Pro</span>}
        </div>
      )}
      </aside>

      {/* Free→paid upgrade modal — opens when a free user clicks a locked feature. */}
      <UpgradeModal
        featureId={upgradeFeature}
        onClose={() => setUpgradeFeature(null)}
        onCtaClick={(plan) => track('link_click', 'sidebar', { action: 'upgrade_modal_cta_click', feature: upgradeFeature, plan })}
      />
    </>
  );
}

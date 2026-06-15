'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  type LucideIcon,
  MessageSquare,
  LineChart,
  Bell,
  Compass,
  TrendingUp,
  Target,
  Users,
  UsersRound,
  DollarSign,
  FileText,
  Telescope,
  Clock,
  Banknote,
  Building2,
  Landmark,
  BookOpen,
  FolderKanban,
  Library,
  Settings,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  CircleUser,
  ChevronUp,
  RefreshCw,
  Search,
} from 'lucide-react';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import { UpgradeModal } from './UpgradeModal';
import { useAppTracker } from './track';

// Panel types for the unified MI platform
export type AppPanel =
  | 'chat'           // Mindy Chat - RAG-backed Q&A (v1, #117)
  | 'dashboard'      // AI Briefings - Daily/Weekly/Pursuit
  | 'alerts'         // Daily Alerts - opportunity list
  | 'market-intel'   // /app/market-intel — full-bleed dashboard route (not a panel)
  | 'research'       // Market Research (Federal Market Assassin)
  | 'forecasts'      // 7,700+ upcoming procurements
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
  | 'disa-watch'     // Vehicle Expiry Watch — DISA prototype (IDIQ/IDV expiry auto-notify)
  | 'osbp-smb'       // SMB Market Research — Navy OSBP prototype (certified small-biz sourcing)
  | 'micc-mrr';      // Market Research Report — ACC-Orlando prototype (auto-draft the MRR .docx)

// Tier definitions
export type AppTier = 'free' | 'pro' | 'team' | 'enterprise';

interface NavItem {
  id: AppPanel;
  label: string;
  // Lucide icon component (was emoji string until 2026-05-27). Rendered
  // inline as <item.icon ... />. The line-icon system reads as "real
  // SaaS" vs the vibe-coded-emoji-in-nav tell. Emoji is still fine in
  // user-generated content (chat bubbles, briefing insights), just not
  // in system chrome. Pattern: Slack / Notion / Vercel / Linear.
  icon: LucideIcon;
  description: string;
  tier: AppTier[];
  badge?: string;
  // When set, clicking this item navigates to a route instead of
  // switching the active panel. Used for full-bleed pages like
  // /app/market-intel that aren't part of the panel container.
  href?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// Sidebar order reorganized 2026-05-25 per Eric: pipeline/execution
// at the top, research at the bottom. The old "Intelligence → Research
// → Pipeline → Estimating → Account" order optimized for first-time
// onboarding (~5% of sessions). The new order optimizes for returning
// users (~95% of sessions) who land in the app to work pursuits, not
// to rediscover their market.
//
// Daily-use flow (top to bottom):
//   1. Intelligence — what's hot today (every session)
//   2. Pipeline — what I'm working on (daily/weekly)
//   3. Estimating — what should I bid (per-opp work)
//   4. Research — discovery / occasional (mostly first-time)
//   5. Account — settings
//
// Mirrors Slack (Inbox/Threads top), Linear (Inbox/Active top),
// Salesforce (My Opps/My Tasks top) — execution before discovery.
const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Intelligence',
    items: [
      {
        // Mindy Chat — flagship v2 entry, top of the sidebar per Eric's
        // call (decision logged 2026-05-27 in PRD-mindy-chat-v1.md).
        id: 'chat',
        label: 'Mindy Chat',
        icon: MessageSquare,
        description: 'Ask anything, cited sources',
        // Pro-only: Mindy Chat retrieves from the proprietary knowledge base, so it's
        // not given away on Free. Free users see it locked → upgrade prompt.
        tier: ['pro', 'team', 'enterprise'],
        badge: 'BETA',
      },
      {
        id: 'dashboard',
        label: "Today's Intel",
        icon: LineChart,
        description: 'AI-prioritized opportunities',
        tier: ['pro', 'team', 'enterprise'],
        badge: 'AI',
      },
      {
        id: 'alerts',
        label: 'Source Feed',
        icon: Bell,
        description: 'Raw SAM.gov matches',
        tier: ['free', 'pro', 'team', 'enterprise'],
      },
      {
        id: 'market-intel',
        label: 'Market Dashboard',
        icon: Compass,
        description: 'Charts, full SAM, CSV export',
        tier: ['free', 'pro', 'team', 'enterprise'],
        href: '/app/market-intel',
      },
    ],
  },
  {
    title: 'Pipeline',
    items: [
      {
        id: 'pipeline',
        label: 'My Pursuits',
        icon: TrendingUp,
        description: 'Track opportunities',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        // Slice 3 of the Target Market Research roadmap. Saved BD
        // targets sourced from the Market Research drawer. Sits with
        // Pipeline because it's the "what am I working on?" mental
        // mode — opps you're chasing + offices you're courting.
        id: 'target-list',
        label: 'My Target List',
        icon: Target,
        description: 'Saved offices to work',
        tier: ['pro', 'team', 'enterprise'],
      },
      // Relationships ("My Network") REMOVED from the sidebar (Eric: research
      // proved Gov Buyers = Decision Makers, Find Partners = Contractors — only
      // OSBP was distinct). Contacts now live INLINE under My Target List per
      // agency card. The panel still exists for any deep links.
    ],
  },
  {
    // Estimating = the "what should I bid?" mental mode. Sits right
    // after Pipeline so the daily flow is: Pursuits → Estimating →
    // submit. Research lives below since pricing happens on opps
    // you're already chasing, not discovering.
    title: 'Estimating',
    items: [
      {
        id: 'pricing',
        label: 'Pricing Intel',
        icon: DollarSign,
        description: 'Labor rates, GSA/SCA wages',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'proposals',
        label: 'Proposal Assist',
        icon: FileText,
        description: 'AI proposal help',
        tier: ['pro', 'team', 'enterprise'],
        badge: 'AI',
      },
    ],
  },
  {
    title: 'Research',
    items: [
      {
        id: 'research',
        label: 'Market Research',
        // Compass already used in Intelligence/market-intel — reuse here intentionally:
        // both are "navigate the market" surfaces, just different views.
        icon: Compass,
        description: 'Your market map',
        tier: ['free', 'pro', 'team', 'enterprise'],
      },
      {
        id: 'forecasts',
        label: 'Upcoming Buys',
        icon: Telescope,
        description: '7,700+ planned',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'recompetes',
        label: 'Expiring Contracts',
        icon: Clock,
        description: 'Recompete targets',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        // DISA prototype (Jun 2026): automate IDIQ/IDV expiry tracking +
        // incumbent notification (replaces their manual spreadsheet). Pro-tier
        // like its neighbors; it's a focused demo surface for the DISA meeting.
        id: 'disa-watch',
        label: 'Vehicle Expiry Watch',
        icon: Bell,
        description: 'Auto-notify on expiry',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        // Navy OSBP prototype (Jun 2026): find certified small/minority
        // businesses by NAICS + cert + state from SAM, exportable. Demo surface.
        id: 'osbp-smb',
        label: 'SMB Market Research',
        icon: Search,
        description: 'Certified small-biz sourcing',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        // ACC-Orlando prototype (Jun 2026): auto-draft the official Army MRR
        // (MAY 2026 template) data sections from real award data → .docx.
        id: 'micc-mrr',
        label: 'Market Research Report',
        icon: FileText,
        description: 'Auto-draft the Army MRR',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        // Moved from its own "Opportunities" section (May 21, 2026).
        // Per Command Center "Where Time Goes" data, Research +
        // Dashboard dominate user time and Grants barely registers.
        // A standalone "Opportunities" section containing only Grants
        // wasn't a meaningful category — it was a single-item parking
        // lot. Grants is intelligence about funding (same mental
        // category as Forecasts + Recompetes), so it lives here now.
        id: 'grants',
        label: 'Federal Grants',
        icon: Banknote,
        description: 'Grants.gov search',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'contractors',
        label: 'Contractors',
        icon: Building2,
        description: 'Prime contractor DB',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'decision-makers',
        label: 'Decision Makers',
        icon: Landmark,
        description: 'Gov contacts by agency',
        tier: ['pro', 'team', 'enterprise'],
      },
      // Knowledge Base intentionally NOT in the sidebar (Eric: it's reference,
      // surfaced via Mindy Chat citations — not a daily-use tab). The panel still
      // exists; chat "view source" links open it via onPanelChange. A "Sources"
      // link inside Mindy Chat is its entry point.
    ],
  },
  {
    title: 'Account',
    items: [
      {
        id: 'vault',
        label: 'My Vault',
        icon: FolderKanban,
        description: 'Your past perf, capabilities, team',
        tier: ['free', 'pro', 'team', 'enterprise'],
      },
      {
        id: 'library',
        label: 'My Library',
        icon: Library,
        description: 'Every AI draft, searchable',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        // Account-level team management (seats + roles) — moved here from
        // Pipeline (Eric 2026-06-05): Pipeline is the DEAL board; team admin is
        // account stuff, so it belongs with Vault / Library / Settings.
        id: 'team',
        label: 'Team Access',
        icon: UsersRound,
        description: 'Seats + roles',
        tier: ['team', 'enterprise'],
        badge: 'Teams',
      },
      {
        // Coach Mode — manage multiple client businesses (APEX counselor or solo
        // consultant). Each client = its own workspace; switch between them.
        id: 'coach',
        label: 'My Clients',
        icon: BookOpen,
        description: 'Manage multiple businesses',
        tier: ['team', 'enterprise'],
        badge: 'Teams',
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: Settings,
        description: 'Profile, NAICS, security',
        tier: ['free', 'pro', 'team', 'enterprise'],
      },
    ],
  },
];

interface UnifiedSidebarProps {
  activePanel: AppPanel;
  onPanelChange: (panel: AppPanel) => void;
  userTier: AppTier;
  /** Staff / grandfathered org members on Pro can use My Clients. */
  coachModeAllowed?: boolean;
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
  // Account actions — surfaced in a bottom-of-sidebar user menu (Slack/Linear/
  // Vercel convention) so they're reachable on MOBILE too (the header sign-out
  // was desktop-only / hidden md:, which stranded mobile users).
  onSignOut?: () => void;
  onSwitchAccount?: () => void;
}

export default function UnifiedSidebar({
  activePanel,
  onPanelChange,
  userTier,
  coachModeAllowed = false,
  userEmail,
  currentWorkspaceId,
  onWorkspaceChange,
  isCollapsed = false,
  onToggleCollapse,
  isMobileOpen = false,
  onMobileClose,
  onSignOut,
  onSwitchAccount,
}: UnifiedSidebarProps) {
  // Bottom-of-sidebar account menu open state.
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  // Free user clicked a Pro-locked feature → open the upgrade modal (highest-
  // intent conversion moment). Holds the clicked item id so the modal can name it.
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);
  const track = useAppTracker(userEmail);
  const [hoveredItem, setHoveredItem] = useState<AppPanel | null>(null);
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

  const hasAccess = (itemTier: AppTier[]) => {
    return itemTier.includes(userTier);
  };

  const canAccessItem = (item: NavItem) => {
    if (item.id === 'coach') {
      return hasAccess(item.tier) || coachModeAllowed;
    }
    return hasAccess(item.tier);
  };

  const getItemDisplay = (item: NavItem) => {
    if (userTier !== 'free') {
      const paidLabels: Partial<Record<AppPanel, { label: string; description: string }>> = {
        dashboard: {
          label: "Today's Intel",
          description: 'Best matches + next steps',
        },
        alerts: {
          label: 'Source Feed',
          description: 'Raw SAM.gov matches',
        },
        forecasts: {
          label: 'Upcoming Buys',
          description: 'Future procurement signals',
        },
        recompetes: {
          label: 'Expiring Contracts',
          description: 'Recompete opportunities',
        },
        pipeline: {
          label: 'My Pursuits',
          description: 'Tracked opportunities',
        },
        contacts: {
          label: 'Relationships',
          description: 'Buyers + partners',
        },
      };

      if (paidLabels[item.id]) return paidLabels[item.id]!;
    }

    return {
      label: item.label,
      description: item.description,
    };
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
          bg-slate-900 border-r border-slate-800 flex flex-col
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
      <div className="p-4 border-b border-slate-800">
        {isCollapsed ? (
          // Collapsed: the logo IS the expand control. Clicking it reopens the
          // sidebar — guarantees a reachable expand action in the narrow rail
          // (the old layout pushed the arrow off the 64px edge, leaving no way
          // to reopen). PanelLeftOpen hint shows on hover.
          <button
            onClick={onToggleCollapse}
            className="group relative w-full flex items-center justify-center hover:bg-slate-800 rounded-lg py-1 transition-colors"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <MindyLogo size={32} />
            <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
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
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
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
        {NAV_SECTIONS.map((section) => {
          // SaaS-standard ordering (Linear / Notion pattern): items the
          // current user can actually use come first, locked items after.
          // Prevents the "I land on Mindy and my #1 nav item is locked"
          // confusion that free users hit when Today's Intel sits above
          // Source Feed.
          const orderedItems = [...section.items].sort((a, b) => {
            const aAccess = canAccessItem(a) ? 0 : 1;
            const bAccess = canAccessItem(b) ? 0 : 1;
            return aAccess - bAccess;
          });
          return (
          <div key={section.title} className="mb-6">
            {!isCollapsed && (
              <div className="px-4 mb-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
                {section.title}
              </div>
            )}
            <div className="space-y-1 px-2">
              {orderedItems.map((item) => {
                const isActive = activePanel === item.id;
                const canAccess = canAccessItem(item);
                const isHovered = hoveredItem === item.id;
                const display = getItemDisplay(item);
                const sharedClassName = `
                  group relative
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                  transition-all duration-150
                  ${isActive
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : canAccess
                      ? 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      : 'text-slate-500 hover:bg-purple-500/10 hover:text-purple-300 cursor-pointer'
                  }
                  ${isCollapsed ? 'justify-center' : ''}
                `;
                const Icon = item.icon;
                const innerContent = (
                  <>
                    <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                    {!isCollapsed && (
                      <>
                        <div className="flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{display.label}</span>
                            {item.badge && (
                              <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded">
                                {item.badge}
                              </span>
                            )}
                          </div>
                          {(isHovered || isActive) && (
                            <div className="text-xs text-slate-500 mt-0.5">
                              {display.description}
                            </div>
                          )}
                        </div>
                        {!canAccess && (
                          <Lock className="w-3 h-3 text-slate-600 shrink-0" strokeWidth={1.75} />
                        )}
                      </>
                    )}
                    {/* Tooltip is rendered ONCE at the sidebar root with
                        position:fixed (see below) so the nav's scroll clip
                        can't eat it — not per-item here anymore. */}
                  </>
                );

                // Route-based items render as <Link>. Tier-gated routes
                // still respect canAccess by falling through to the
                // disabled <button> branch below.
                if (item.href && canAccess) {
                  return (
                    <Link
                      key={item.id}
                      data-tour={`nav-${item.id}`}
                      href={item.href}
                      onClick={() => onMobileClose?.()}
                      onMouseEnter={(e) => { setHoveredItem(item.id); showTooltip(e, display.label, item.badge, !canAccess); }}
                      onMouseLeave={() => { setHoveredItem(null); setTooltip(null); }}
                      className={sharedClassName}
                    >
                      {innerContent}
                    </Link>
                  );
                }

                return (
                  <button
                    key={item.id}
                    data-tour={`nav-${item.id}`}
                    onClick={() => {
                      if (canAccess) {
                        onPanelChange(item.id);
                        // Auto-close the mobile drawer when user taps
                        // a panel — they expect the chosen panel to
                        // take focus, not stare at the menu.
                        onMobileClose?.();
                      } else {
                        // Locked feature — open upgrade modal (Pro for most panels,
                        // Teams for My Clients).
                        setUpgradeFeature(item.id);
                        track('link_click', 'sidebar', { action: 'upgrade_modal_shown', feature: item.id, tier: userTier });
                      }
                    }}
                    onMouseEnter={(e) => { setHoveredItem(item.id); showTooltip(e, display.label, item.badge, !canAccess); }}
                    onMouseLeave={() => { setHoveredItem(null); setTooltip(null); }}
                    className={sharedClassName}
                  >
                    {innerContent}
                  </button>
                );
              })}
            </div>
          </div>
          );
        })}
      </nav>

      {/* Footer — shrink-0 so it never gets squeezed out by the scrolling nav;
          pb safe-area so the account menu clears the iOS home indicator. */}
      <div className="shrink-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-slate-800 space-y-2">
        {!isCollapsed && userTier === 'free' && (
          <Link
            href="/market-intelligence"
            className="block w-full px-3 py-2 text-center text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
          >
            Upgrade to Pro
          </Link>
        )}
        {/* Collapse / expand control — pinned at the bottom of the sidebar
            (SaaS standard: Firecrawl, Gamma, Linear). The header arrow was
            easy to miss when collapsed, so surface an obvious, labeled toggle
            here that works in both states. */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className={`w-full flex items-center rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors ${isCollapsed ? 'justify-center' : 'gap-2'}`}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed
              ? <PanelLeftOpen className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
              : <PanelLeftClose className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />}
            {!isCollapsed && <span>Collapse</span>}
          </button>
        )}
        {/* ACCOUNT MENU — bottom-of-sidebar user block (Slack/Linear/Vercel
            convention): avatar + email → up-menu with Settings, Switch Account,
            Sign out. Reachable on mobile via the hamburger drawer. */}
        {(onSignOut || onSwitchAccount) && (
          <div className="relative">
            {accountMenuOpen && (
              <>
                {/* click-away */}
                <div className="fixed inset-0 z-40" onClick={() => setAccountMenuOpen(false)} />
                <div className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl shadow-black/40">
                  <button
                    onClick={() => { onPanelChange('settings'); setAccountMenuOpen(false); onMobileClose?.(); }}
                    className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    <Settings className="w-4 h-4 shrink-0" strokeWidth={1.75} /> Settings
                  </button>
                  {onSwitchAccount && (
                    <button
                      onClick={() => { onSwitchAccount(); setAccountMenuOpen(false); onMobileClose?.(); }}
                      className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                    >
                      <RefreshCw className="w-4 h-4 shrink-0" strokeWidth={1.75} /> Switch account
                    </button>
                  )}
                  {onSignOut && (
                    <button
                      onClick={() => { onSignOut(); setAccountMenuOpen(false); onMobileClose?.(); }}
                      className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                    >
                      <LogOut className="w-4 h-4 shrink-0" strokeWidth={1.75} /> Sign out
                    </button>
                  )}
                </div>
              </>
            )}
            <button
              onClick={() => setAccountMenuOpen((v) => !v)}
              className={`w-full flex items-center rounded-lg px-2 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors ${isCollapsed ? 'justify-center' : 'gap-2'}`}
              title={userEmail || 'Account'}
              aria-label="Account menu"
            >
              <CircleUser className="w-[22px] h-[22px] shrink-0 text-slate-400" strokeWidth={1.5} />
              {!isCollapsed && (
                <>
                  <span className="flex-1 truncate text-left text-xs text-slate-300">{userEmail || 'Account'}</span>
                  <ChevronUp className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${accountMenuOpen ? '' : 'rotate-180'}`} strokeWidth={1.75} />
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Single fixed-position tooltip for the collapsed sidebar. position:fixed
          (vs absolute inside the scrolling nav) means the overflow-y-auto clip
          can't hide it — so we keep BOTH the scrollable nav (pinned Collapse
          footer) AND the hover labels. */}
      {isCollapsed && tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg shadow-black/40"
          style={{ top: tooltip.top, left: tooltip.left }}
        >
          {tooltip.label}
          {tooltip.badge && <span className="ml-1.5 text-[10px] text-purple-300">{tooltip.badge}</span>}
          {tooltip.locked && <span className="ml-1.5 text-[10px] text-slate-400">🔒 Pro</span>}
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

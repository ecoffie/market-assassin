'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import WorkspaceSwitcher from './WorkspaceSwitcher';

// Panel types for the unified MI platform
export type AppPanel =
  | 'dashboard'      // AI Briefings - Daily/Weekly/Pursuit
  | 'alerts'         // Daily Alerts - opportunity list
  | 'market-intel'   // /app/market-intel — full-bleed dashboard route (not a panel)
  | 'research'       // Market Research (Federal Market Assassin)
  | 'forecasts'      // 7,700+ upcoming procurements
  | 'recompetes'     // Expiring contracts
  | 'contractors'    // prime contractor database
  | 'pipeline'       // Track pursuits
  | 'contacts'       // Relationships
  | 'team'           // Team access and seats
  | 'settings'       // Unified account settings
  | 'vault'          // My Vault — persistent knowledge base (identity, past perf, capabilities, team, boilerplate)
  | 'library'        // My Library — searchable history of every AI output
  | 'pricing'        // Pricing Intel — labor rates, GSA/SCA wages (Estimating section)
  | 'proposals'      // AI Proposal Assist (Estimating section)
  | 'target-list'    // My Target List — saved BD targets (Pipeline section, Slice 3 of TMR roadmap)
  | 'grants';        // Federal grants

// Tier definitions
export type AppTier = 'free' | 'pro' | 'team' | 'enterprise';

interface NavItem {
  id: AppPanel;
  label: string;
  icon: string;
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
        id: 'dashboard',
        label: "Today's Intel",
        icon: '📊',
        description: 'AI-prioritized opportunities',
        tier: ['pro', 'team', 'enterprise'],
        badge: 'AI',
      },
      {
        id: 'alerts',
        label: 'Source Feed',
        icon: '🔔',
        description: 'Raw SAM.gov matches',
        tier: ['free', 'pro', 'team', 'enterprise'],
      },
      {
        id: 'market-intel',
        label: 'Market Dashboard',
        icon: '🧭',
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
        icon: '📈',
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
        icon: '🎯',
        description: 'Saved offices to work',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'contacts',
        label: 'My Network',
        icon: '🤝',
        description: 'Buyers + partners',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'team',
        label: 'Team Access',
        icon: '👥',
        description: 'Seats + roles',
        tier: ['team', 'enterprise'],
        badge: 'Teams',
      },
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
        icon: '💵',
        description: 'Labor rates, GSA/SCA wages',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'proposals',
        label: 'Proposal Assist',
        icon: '📝',
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
        icon: '🎯',
        description: 'Your market map',
        tier: ['free', 'pro', 'team', 'enterprise'],
      },
      {
        id: 'forecasts',
        label: 'Upcoming Buys',
        icon: '🔮',
        description: '7,700+ planned',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'recompetes',
        label: 'Expiring Contracts',
        icon: '⏰',
        description: 'Recompete targets',
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
        icon: '💰',
        description: 'Grants.gov search',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'contractors',
        label: 'Contractors',
        icon: '🏢',
        description: 'Prime contractor DB',
        tier: ['pro', 'team', 'enterprise'],
      },
    ],
  },
  {
    title: 'Account',
    items: [
      {
        id: 'vault',
        label: 'My Vault',
        icon: '🗂️',
        description: 'Your past perf, capabilities, team',
        tier: ['free', 'pro', 'team', 'enterprise'],
      },
      {
        id: 'library',
        label: 'My Library',
        icon: '📚',
        description: 'Every AI draft, searchable',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: '⚙️',
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
  userEmail?: string | null;
  currentWorkspaceId?: string | null;
  onWorkspaceChange?: (workspaceId: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function UnifiedSidebar({
  activePanel,
  onPanelChange,
  userTier,
  userEmail,
  currentWorkspaceId,
  onWorkspaceChange,
  isCollapsed = false,
  onToggleCollapse,
}: UnifiedSidebarProps) {
  const [hoveredItem, setHoveredItem] = useState<AppPanel | null>(null);

  const hasAccess = (itemTier: AppTier[]) => {
    return itemTier.includes(userTier);
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
    <aside
      className={`
        bg-slate-900 border-r border-slate-800 flex flex-col h-screen sticky top-0
        transition-all duration-300 ease-in-out
        ${isCollapsed ? 'w-16' : 'w-64'}
      `}
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between">
          {!isCollapsed && (
            <Link href="/app" className="flex items-center gap-2">
              <MindyLogo size={32} />
              <div>
                <span className="font-semibold text-white text-sm">Mindy</span>
              </div>
            </Link>
          )}
          {isCollapsed && (
            <MindyLogo size={32} className="mx-auto" />
          )}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
            >
              {isCollapsed ? '→' : '←'}
            </button>
          )}
        </div>

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

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {NAV_SECTIONS.map((section) => {
          // SaaS-standard ordering (Linear / Notion pattern): items the
          // current user can actually use come first, locked items after.
          // Prevents the "I land on Mindy and my #1 nav item is locked"
          // confusion that free users hit when Today's Intel sits above
          // Source Feed.
          const orderedItems = [...section.items].sort((a, b) => {
            const aAccess = hasAccess(a.tier) ? 0 : 1;
            const bAccess = hasAccess(b.tier) ? 0 : 1;
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
                const canAccess = hasAccess(item.tier);
                const isHovered = hoveredItem === item.id;
                const display = getItemDisplay(item);
                const sharedClassName = `
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                  transition-all duration-150
                  ${isActive
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : canAccess
                      ? 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      : 'text-slate-600 cursor-not-allowed opacity-50'
                  }
                  ${isCollapsed ? 'justify-center' : ''}
                `;
                const innerContent = (
                  <>
                    <span className="text-lg">{item.icon}</span>
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
                          <span className="text-xs text-slate-600">🔒</span>
                        )}
                      </>
                    )}
                  </>
                );

                // Route-based items render as <Link>. Tier-gated routes
                // still respect canAccess by falling through to the
                // disabled <button> branch below.
                if (item.href && canAccess) {
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      onMouseEnter={() => setHoveredItem(item.id)}
                      onMouseLeave={() => setHoveredItem(null)}
                      className={sharedClassName}
                      title={isCollapsed ? display.label : undefined}
                    >
                      {innerContent}
                    </Link>
                  );
                }

                return (
                  <button
                    key={item.id}
                    onClick={() => canAccess && onPanelChange(item.id)}
                    onMouseEnter={() => setHoveredItem(item.id)}
                    onMouseLeave={() => setHoveredItem(null)}
                    disabled={!canAccess}
                    className={sharedClassName}
                    title={isCollapsed ? display.label : undefined}
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

      {/* Footer */}
      <div className="p-4 border-t border-slate-800">
        {!isCollapsed && userTier === 'free' && (
          <Link
            href="/market-intelligence"
            className="block w-full px-3 py-2 text-center text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
          >
            Upgrade to Pro
          </Link>
        )}
      </div>
    </aside>
  );
}

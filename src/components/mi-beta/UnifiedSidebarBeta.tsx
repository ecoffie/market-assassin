'use client';

import { useState } from 'react';
import Link from 'next/link';

// Panel types for the unified MI platform
export type MIBetaPanel =
  | 'dashboard'      // AI Briefings - Daily/Weekly/Pursuit
  | 'alerts'         // Daily Alerts - opportunity list
  | 'research'       // Market Research (Federal Market Assassin)
  | 'forecasts'      // 7,700+ upcoming procurements
  | 'recompetes'     // Expiring contracts
  | 'contractors'    // prime contractor database
  | 'pipeline'       // Track pursuits
  | 'contacts'       // Relationships
  | 'team'           // Team access and seats
  | 'settings'       // Unified account settings
  | 'proposals'      // AI Proposal Assist
  | 'grants';        // Federal grants

// Tier definitions
export type MIBetaTier = 'free' | 'pro' | 'team' | 'enterprise';

interface NavItem {
  id: MIBetaPanel;
  label: string;
  icon: string;
  description: string;
  tier: MIBetaTier[];
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

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
        id: 'contractors',
        label: 'Contractors',
        icon: '🏢',
        description: 'Prime contractor DB',
        tier: ['pro', 'team', 'enterprise'],
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
    title: 'Opportunities',
    items: [
      {
        id: 'grants',
        label: 'Federal Grants',
        icon: '💰',
        description: 'Grants.gov search',
        tier: ['pro', 'team', 'enterprise'],
      },
    ],
  },
  {
    title: 'Account',
    items: [
      {
        id: 'settings',
        label: 'Unified Settings',
        icon: '⚙️',
        description: 'Profile, NAICS, security',
        tier: ['free', 'pro', 'team', 'enterprise'],
      },
    ],
  },
];

interface UnifiedSidebarBetaProps {
  activePanel: MIBetaPanel;
  onPanelChange: (panel: MIBetaPanel) => void;
  userTier: MIBetaTier;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function UnifiedSidebarBeta({
  activePanel,
  onPanelChange,
  userTier,
  isCollapsed = false,
  onToggleCollapse,
}: UnifiedSidebarBetaProps) {
  const [hoveredItem, setHoveredItem] = useState<MIBetaPanel | null>(null);

  const hasAccess = (itemTier: MIBetaTier[]) => {
    return itemTier.includes(userTier);
  };

  const getItemDisplay = (item: NavItem) => {
    if (userTier !== 'free') {
      const paidLabels: Partial<Record<MIBetaPanel, { label: string; description: string }>> = {
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

  const tierColors: Record<MIBetaTier, string> = {
    free: 'text-gray-400',
    pro: 'text-emerald-400',
    team: 'text-blue-400',
    enterprise: 'text-purple-400',
  };

  const tierLabels: Record<MIBetaTier, string> = {
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
            <Link href="/mi-beta" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
                <span className="text-white font-bold text-sm">MI</span>
              </div>
              <div>
                <span className="font-semibold text-white text-sm">Market Intel</span>
                <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">
                  BETA
                </span>
              </div>
            </Link>
          )}
          {isCollapsed && (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mx-auto">
              <span className="text-white font-bold text-sm">MI</span>
            </div>
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

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-6">
            {!isCollapsed && (
              <div className="px-4 mb-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
                {section.title}
              </div>
            )}
            <div className="space-y-1 px-2">
              {section.items.map((item) => {
                const isActive = activePanel === item.id;
                const canAccess = hasAccess(item.tier);
                const isHovered = hoveredItem === item.id;
                const display = getItemDisplay(item);

                return (
                  <button
                    key={item.id}
                    onClick={() => canAccess && onPanelChange(item.id)}
                    onMouseEnter={() => setHoveredItem(item.id)}
                    onMouseLeave={() => setHoveredItem(null)}
                    disabled={!canAccess}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                      transition-all duration-150
                      ${isActive
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : canAccess
                          ? 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          : 'text-slate-600 cursor-not-allowed opacity-50'
                      }
                      ${isCollapsed ? 'justify-center' : ''}
                    `}
                    title={isCollapsed ? display.label : undefined}
                  >
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
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-slate-800">
        {!isCollapsed ? (
          <div className="space-y-2">
            {userTier === 'free' && (
              <Link
                href="/market-intelligence"
                className="block w-full px-3 py-2 text-center text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
              >
                Upgrade to Pro
              </Link>
            )}
            <Link
              href="/briefings"
              className="block text-center text-xs text-slate-500 hover:text-slate-400 transition-colors"
            >
              ← Back to Production
            </Link>
          </div>
        ) : (
          <Link
            href="/briefings"
            className="block text-center text-slate-500 hover:text-slate-400"
            title="Back to Production"
          >
            ←
          </Link>
        )}
      </div>
    </aside>
  );
}

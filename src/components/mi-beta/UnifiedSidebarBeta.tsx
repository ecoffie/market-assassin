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
  | 'contractors'    // 3,500+ with contacts
  | 'pipeline'       // Track pursuits
  | 'contacts'       // CRM & relationships
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
        label: 'AI Briefings',
        icon: '📊',
        description: 'Daily + Weekly + Pursuit intel',
        tier: ['pro', 'team', 'enterprise'],
        badge: 'AI',
      },
      {
        id: 'alerts',
        label: 'Daily Alerts',
        icon: '🔔',
        description: 'Opportunity notifications',
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
        description: '10 strategic reports',
        tier: ['free', 'pro', 'team', 'enterprise'],
      },
      {
        id: 'forecasts',
        label: 'Forecasts',
        icon: '🔮',
        description: '7,700+ upcoming',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'recompetes',
        label: 'Recompetes',
        icon: '⏰',
        description: '12,000+ expiring',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'contractors',
        label: 'Contractors',
        icon: '🏢',
        description: '3,500+ with contacts',
        tier: ['pro', 'team', 'enterprise'],
      },
    ],
  },
  {
    title: 'Pipeline',
    items: [
      {
        id: 'pipeline',
        label: 'Pipeline Tracker',
        icon: '📈',
        description: 'Track pursuits',
        tier: ['pro', 'team', 'enterprise'],
      },
      {
        id: 'contacts',
        label: 'Teaming CRM',
        icon: '🤝',
        description: 'Partner relationships',
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
    title: 'Opportunities',
    items: [
      {
        id: 'grants',
        label: 'Federal Grants',
        icon: '💰',
        description: '$700B+ in grants',
        tier: ['pro', 'team', 'enterprise'],
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
                    title={isCollapsed ? item.label : undefined}
                  >
                    <span className="text-lg">{item.icon}</span>
                    {!isCollapsed && (
                      <>
                        <div className="flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{item.label}</span>
                            {item.badge && (
                              <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded">
                                {item.badge}
                              </span>
                            )}
                          </div>
                          {(isHovered || isActive) && (
                            <div className="text-xs text-slate-500 mt-0.5">
                              {item.description}
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

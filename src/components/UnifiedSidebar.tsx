'use client';

import { useState } from 'react';

// Panel types for the unified MI dashboard
// All navigation happens within /briefings - no separate routes
export type MIPanel =
  | 'dashboard'      // Daily briefings & intel
  | 'research'       // Market Research (Federal Market Assassin)
  | 'forecasts'      // 7,700+ upcoming procurements
  | 'recompetes'     // Expiring contracts
  | 'contractors'    // 3,500+ with contacts
  | 'pipeline'       // Track pursuits
  | 'contacts'       // CRM & relationships
  | 'content'        // Content Reaper
  | 'planner'        // Action Planner
  | 'sbir'           // SBIR/STTR
  | 'grants'         // Federal grants
  | 'proposals'      // Proposal Manager (Execution tier)
  | 'workbench';     // AI Workbench (Execution tier)

// Tier definitions for access control
// Free: MI Free ($0) - Limited search
// Tier 1: MI Pro ($149/mo) - Full intelligence
// Tier 2: MI + Execution ($316/mo) - Intelligence + CRM + AI proposals
// Tier 3: MI Team ($1,000/mo) - 5 seats, shared pipeline
// Tier 4: MI Enterprise ($2,500+/mo) - 15+ seats, API, white-label
export type MITier = 'free' | 'pro' | 'execution' | 'team' | 'enterprise';

interface NavItem {
  name: string;
  panel: MIPanel;
  icon: string;
  description?: string;
  tier: MITier; // Minimum tier required
  badge?: string; // Optional badge (e.g., "PRO", "NEW")
}

interface NavSection {
  title: string;
  tier: MITier; // Minimum tier for entire section
  items: NavItem[];
}

// Unified MI Platform Navigation
// Based on Atlassian pattern: Sidebar switches content panels, not routes
// Reference: https://www.atlassian.com/blog/design/designing-atlassians-new-navigation
//
// TIER STRUCTURE:
// - MI Free ($0): Limited opportunity search only
// - MI Pro ($149/mo): Full intelligence stack
// - MI + Execution ($316/mo): Intelligence + CRM + Proposals + AI Workbench
// - MI Team ($1,000/mo): 5 seats, shared pipeline
// - MI Enterprise ($2,500+/mo): 15+ seats, API, white-label
const navigation: NavSection[] = [
  {
    title: 'Intelligence',
    tier: 'pro',
    items: [
      {
        name: 'Dashboard',
        panel: 'dashboard',
        icon: '📊',
        description: 'Daily briefings & intel',
        tier: 'pro',
      },
      {
        name: 'Market Research',
        panel: 'research',
        icon: '🔍',
        description: 'Deep market intelligence',
        tier: 'pro',
      },
      {
        name: 'Forecasts',
        panel: 'forecasts',
        icon: '🔮',
        description: '7,700+ upcoming procurements',
        tier: 'pro',
      },
      {
        name: 'Recompetes',
        panel: 'recompetes',
        icon: '⏰',
        description: '12,000+ expiring contracts',
        tier: 'pro',
      },
      {
        name: 'Contractors',
        panel: 'contractors',
        icon: '🏢',
        description: '3,500+ with contacts',
        tier: 'pro',
      },
      {
        name: 'SBIR/STTR',
        panel: 'sbir',
        icon: '🔬',
        description: 'R&D funding opportunities',
        tier: 'pro',
      },
      {
        name: 'Grants',
        panel: 'grants',
        icon: '💰',
        description: 'Federal grant funding',
        tier: 'pro',
      },
    ],
  },
  {
    title: 'Execution',
    tier: 'execution',
    items: [
      {
        name: 'Pipeline',
        panel: 'pipeline',
        icon: '🎯',
        description: 'Track pursuits',
        tier: 'execution',
      },
      {
        name: 'Contacts',
        panel: 'contacts',
        icon: '👥',
        description: 'CRM & relationships',
        tier: 'execution',
      },
      {
        name: 'Proposals',
        panel: 'proposals',
        icon: '📝',
        description: 'AI-generated proposals',
        tier: 'execution',
        badge: 'NEW',
      },
      {
        name: 'AI Workbench',
        panel: 'workbench',
        icon: '🤖',
        description: 'Private AI agents',
        tier: 'execution',
        badge: 'NEW',
      },
    ],
  },
  {
    title: 'Tools',
    tier: 'pro',
    items: [
      {
        name: 'Content Reaper',
        panel: 'content',
        icon: '✍️',
        description: 'AI content generator',
        tier: 'pro',
      },
      {
        name: 'Action Planner',
        panel: 'planner',
        icon: '📋',
        description: '36-task roadmap',
        tier: 'pro',
      },
    ],
  },
];

// Tier display info
const tierInfo: Record<MITier, { name: string; price: string; color: string }> = {
  free: { name: 'MI Free', price: '$0', color: 'gray' },
  pro: { name: 'MI Pro', price: '$149/mo', color: 'emerald' },
  execution: { name: 'MI + Execution', price: '$316/mo', color: 'purple' },
  team: { name: 'MI Team', price: '$1,000/mo', color: 'blue' },
  enterprise: { name: 'MI Enterprise', price: '$2,500+/mo', color: 'amber' },
};

// Check if user has access to a feature based on their tier
function hasAccess(userTier: MITier, requiredTier: MITier): boolean {
  const tierOrder: MITier[] = ['free', 'pro', 'execution', 'team', 'enterprise'];
  return tierOrder.indexOf(userTier) >= tierOrder.indexOf(requiredTier);
}

interface UnifiedSidebarProps {
  activePanel: MIPanel;
  onPanelChange: (panel: MIPanel) => void;
  userTier?: MITier; // User's current subscription tier
}

export default function UnifiedSidebar({
  activePanel,
  onPanelChange,
  userTier = 'pro' // Default to pro for now
}: UnifiedSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const handlePanelClick = (panel: MIPanel, requiredTier: MITier) => {
    if (!hasAccess(userTier, requiredTier)) {
      // Could show upgrade modal here
      return;
    }
    onPanelChange(panel);
    setIsOpen(false); // Close mobile menu on selection
  };

  const currentTierInfo = tierInfo[userTier];

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-700 transition-colors"
        aria-label="Toggle navigation"
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-40 h-screen bg-gray-950 border-r border-gray-800 transition-all duration-300
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          ${isMinimized ? 'w-16' : 'w-64'}
        `}
      >
        {/* Logo / Brand with Tier */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-800">
          {!isMinimized && (
            <button
              onClick={() => handlePanelClick('dashboard', 'pro')}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-${currentTierInfo.color}-500 to-${currentTierInfo.color}-700 flex items-center justify-center`}>
                <span className="text-white font-bold text-sm">MI</span>
              </div>
              <div className="text-left">
                <span className="text-white font-semibold text-sm block">{currentTierInfo.name}</span>
                <p className="text-[10px] text-gray-500">{currentTierInfo.price}</p>
              </div>
            </button>
          )}
          {isMinimized && (
            <button
              onClick={() => handlePanelClick('dashboard', 'pro')}
              className="mx-auto hover:opacity-80 transition-opacity"
            >
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-${currentTierInfo.color}-500 to-${currentTierInfo.color}-700 flex items-center justify-center`}>
                <span className="text-white font-bold text-sm">MI</span>
              </div>
            </button>
          )}
          {/* Desktop minimize button */}
          {!isMinimized && (
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="hidden lg:block p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
              title="Collapse sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* Expand button when minimized */}
        {isMinimized && (
          <button
            onClick={() => setIsMinimized(false)}
            className="hidden lg:flex w-full justify-center p-2 text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            title="Expand sidebar"
          >
            <svg className="w-4 h-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2">
          {navigation.map((section, sectionIdx) => {
            const sectionLocked = !hasAccess(userTier, section.tier);

            return (
              <div key={section.title} className={sectionIdx > 0 ? 'mt-6' : ''}>
                {!isMinimized && (
                  <div className="flex items-center justify-between px-3 mb-2">
                    <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
                      {section.title}
                    </p>
                    {sectionLocked && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded font-medium">
                        {tierInfo[section.tier].name.replace('MI ', '').toUpperCase()}
                      </span>
                    )}
                  </div>
                )}
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const itemLocked = !hasAccess(userTier, item.tier);

                    return (
                      <button
                        key={item.panel}
                        onClick={() => handlePanelClick(item.panel, item.tier)}
                        disabled={itemLocked}
                        className={`
                          w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group relative text-left
                          ${itemLocked
                            ? 'opacity-50 cursor-not-allowed'
                            : activePanel === item.panel
                              ? 'bg-emerald-600/20 text-emerald-400'
                              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}
                        `}
                        title={isMinimized ? item.name : itemLocked ? `Requires ${tierInfo[item.tier].name}` : undefined}
                      >
                        <span className="text-lg shrink-0">{item.icon}</span>
                        {!isMinimized && (
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{item.name}</span>
                              {item.badge && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded font-medium">
                                  {item.badge}
                                </span>
                              )}
                              {itemLocked && (
                                <svg className="w-3 h-3 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                            {item.description && (
                              <p className="text-xs text-gray-500 truncate">{item.description}</p>
                            )}
                          </div>
                        )}
                        {activePanel === item.panel && !itemLocked && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-emerald-500 rounded-r" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Upgrade CTA for non-enterprise users */}
        {!isMinimized && userTier !== 'enterprise' && (
          <div className="p-4 border-t border-gray-800">
            <a
              href="/pricing"
              className="block px-3 py-2 bg-gradient-to-r from-purple-600/20 to-purple-500/10 border border-purple-500/30 rounded-lg hover:border-purple-500/50 transition-colors"
            >
              <p className="text-xs text-purple-400 font-medium">Upgrade Plan</p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                {userTier === 'pro' ? 'Add Execution tools →' : 'Unlock more features →'}
              </p>
            </a>
          </div>
        )}

        {/* Footer */}
        {!isMinimized && (
          <div className="p-4 border-t border-gray-800">
            <div className="px-3 py-2 bg-gradient-to-r from-emerald-900/30 to-emerald-800/20 rounded-lg">
              <p className="text-xs text-emerald-400 font-medium">GovCon Giants</p>
              <p className="text-xs text-gray-500 mt-0.5">
                <a href="mailto:service@govcongiants.com" className="hover:text-gray-300">
                  service@govcongiants.com
                </a>
              </p>
            </div>
          </div>
        )}
      </aside>

      {/* Spacer to push content right on desktop */}
      <div className={`hidden lg:block shrink-0 transition-all duration-300 ${isMinimized ? 'w-16' : 'w-64'}`} />
    </>
  );
}

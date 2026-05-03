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
  | 'grants';        // Federal grants

interface NavItem {
  name: string;
  panel: MIPanel;
  icon: string;
  description?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// Unified MI Platform Navigation
// Based on Atlassian pattern: Sidebar switches content panels, not routes
// Reference: https://www.atlassian.com/blog/design/designing-atlassians-new-navigation
const navigation: NavSection[] = [
  {
    title: 'Intelligence',
    items: [
      {
        name: 'Dashboard',
        panel: 'dashboard',
        icon: '📊',
        description: 'Daily briefings & intel',
      },
      {
        name: 'Market Research',
        panel: 'research',
        icon: '🔍',
        description: 'Deep market intelligence',
      },
      {
        name: 'Forecasts',
        panel: 'forecasts',
        icon: '🔮',
        description: '7,700+ upcoming procurements',
      },
      {
        name: 'Recompetes',
        panel: 'recompetes',
        icon: '⏰',
        description: 'Expiring contracts',
      },
      {
        name: 'Contractors',
        panel: 'contractors',
        icon: '🏢',
        description: '3,500+ with contacts',
      },
    ],
  },
  {
    title: 'Execution',
    items: [
      {
        name: 'Pipeline',
        panel: 'pipeline',
        icon: '🎯',
        description: 'Track pursuits',
      },
      {
        name: 'Contacts',
        panel: 'contacts',
        icon: '👥',
        description: 'CRM & relationships',
      },
    ],
  },
  {
    title: 'Tools',
    items: [
      {
        name: 'Content Reaper',
        panel: 'content',
        icon: '✍️',
        description: 'AI content generator',
      },
      {
        name: 'Action Planner',
        panel: 'planner',
        icon: '📋',
        description: '36-task roadmap',
      },
    ],
  },
];

interface UnifiedSidebarProps {
  activePanel: MIPanel;
  onPanelChange: (panel: MIPanel) => void;
}

export default function UnifiedSidebar({ activePanel, onPanelChange }: UnifiedSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const handlePanelClick = (panel: MIPanel) => {
    onPanelChange(panel);
    setIsOpen(false); // Close mobile menu on selection
  };

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
        {/* Logo / Brand */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-800">
          {!isMinimized && (
            <button
              onClick={() => handlePanelClick('dashboard')}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
                <span className="text-white font-bold text-sm">MI</span>
              </div>
              <div className="text-left">
                <span className="text-white font-semibold text-sm block">Market Intelligence</span>
                <p className="text-[10px] text-gray-500">$149/mo</p>
              </div>
            </button>
          )}
          {isMinimized && (
            <button
              onClick={() => handlePanelClick('dashboard')}
              className="mx-auto hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
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
          {navigation.map((section, sectionIdx) => (
            <div key={section.title} className={sectionIdx > 0 ? 'mt-6' : ''}>
              {!isMinimized && (
                <p className="px-3 mb-2 text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
                  {section.title}
                </p>
              )}
              <div className="space-y-1">
                {section.items.map((item) => (
                  <button
                    key={item.panel}
                    onClick={() => handlePanelClick(item.panel)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group relative text-left
                      ${activePanel === item.panel
                        ? 'bg-emerald-600/20 text-emerald-400'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}
                    `}
                    title={isMinimized ? item.name : undefined}
                  >
                    <span className="text-lg shrink-0">{item.icon}</span>
                    {!isMinimized && (
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm">{item.name}</span>
                        {item.description && (
                          <p className="text-xs text-gray-500 truncate">{item.description}</p>
                        )}
                      </div>
                    )}
                    {activePanel === item.panel && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-emerald-500 rounded-r" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

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

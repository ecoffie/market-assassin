'use client';

import { Suspense, useEffect } from 'react';
import type { MIPanel } from '@/components/UnifiedSidebar';
import { useMI } from '@/context/MIContext';
import {
  DashboardPanel,
  AlertsPanel,
  MarketResearchPanel,
  ForecastsPanel,
  RecompetesPanel,
  ContractorsPanel,
  GrantsPanel,
  PipelinePanel,
  ProposalsPanel,
  ContactsPanel,
  preloadPanels,
} from './index';

// Loading skeleton for panels
function PanelSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-6">
      {/* Header skeleton */}
      <div className="h-8 bg-gray-800 rounded w-1/3" />
      <div className="h-4 bg-gray-800 rounded w-2/3" />

      {/* Content skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-48 bg-gray-800 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// Error boundary fallback
function PanelError({ panelName }: { panelName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center p-6">
      <div className="text-4xl mb-4">⚠️</div>
      <h3 className="text-xl font-semibold text-white mb-2">
        Failed to load {panelName}
      </h3>
      <p className="text-gray-400 mb-4">
        Please try refreshing the page or contact support if the issue persists.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
      >
        Refresh Page
      </button>
    </div>
  );
}

// Map panel types to adjacent panels for preloading
const adjacentPanels: Record<MIPanel, MIPanel[]> = {
  dashboard: ['alerts', 'research', 'forecasts'],
  alerts: ['dashboard', 'research'],
  research: ['dashboard', 'alerts', 'forecasts'],
  forecasts: ['research', 'recompetes', 'contractors'],
  recompetes: ['forecasts', 'contractors', 'pipeline'],
  contractors: ['recompetes', 'contacts', 'pipeline'],
  pipeline: ['proposals', 'contacts', 'recompetes'],
  proposals: ['pipeline', 'contacts'],
  contacts: ['pipeline', 'proposals', 'contractors'],
  grants: ['forecasts', 'research'],
};

interface PanelContainerProps {
  // Optional email override (for backwards compatibility)
  email?: string;
}

export default function PanelContainer({ email: emailOverride }: PanelContainerProps) {
  const { activePanel, email: contextEmail } = useMI();
  const email = emailOverride || contextEmail || '';

  // Preload adjacent panels when active panel changes
  useEffect(() => {
    const adjacent = adjacentPanels[activePanel] || [];
    // Small delay to prioritize current panel
    const timer = setTimeout(() => {
      preloadPanels(adjacent as Parameters<typeof preloadPanels>[0]);
    }, 200);
    return () => clearTimeout(timer);
  }, [activePanel]);

  // Render the active panel
  const renderPanel = () => {
    switch (activePanel) {
      case 'dashboard':
        return <DashboardPanel email={email} />;
      case 'alerts':
        return <AlertsPanel email={email} />;
      case 'research':
        return <MarketResearchPanel email={email} />;
      case 'forecasts':
        return <ForecastsPanel email={email} />;
      case 'recompetes':
        return <RecompetesPanel email={email} />;
      case 'contractors':
        return <ContractorsPanel email={email} />;
      case 'grants':
        return <GrantsPanel email={email} />;
      case 'pipeline':
        return <PipelinePanel email={email} />;
      case 'contacts':
        return <ContactsPanel email={email} />;
      case 'proposals':
        return <ProposalsPanel email={email} />;
      default:
        return <DashboardPanel email={email} />;
    }
  };

  return (
    <Suspense fallback={<PanelSkeleton />}>
      {renderPanel()}
    </Suspense>
  );
}
